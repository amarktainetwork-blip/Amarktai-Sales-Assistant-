import { eq } from "drizzle-orm";
import { organisationMembers, organisations } from "../drizzle/schema";
import {
  getConnectedSystemForUser,
  listConnectedSystemsForUser,
  loadUserConnectionSecret,
  toAdapterConnection,
  verifiedUserCrmScope,
} from "./connectedSystems";
import { ingestInboundMessage } from "./communications/inboundPipeline";
import { getDb, recordAudit } from "./db";
import { memberOnboardingFor } from "./organisation";
import { withAuthenticatedBrowserSessionPage } from "./browserConnectors/browserCrmAdapter";

const MAX_GENIE_MAILBOXES_PER_CYCLE = 50;
const MAX_CONVERSATIONS_PER_SYNC = 20;

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

export function exactGenieMailboxIdentity(input: {
  appEmail: string | null | undefined;
  mappingEmail: string | null | undefined;
  recipientEmail: string | null | undefined;
}) {
  const app = normalizeEmail(input.appEmail);
  const mapping = normalizeEmail(input.mappingEmail);
  const recipient = normalizeEmail(input.recipientEmail);
  return Boolean(app && app === mapping && mapping === recipient);
}

type GenieEmailRecord = {
  emailId: string;
  sender: string;
  recipient: string;
  subject?: string;
  body: string;
  contactExternalId?: string;
};

async function readCurrentConversationEmails(
  page: Parameters<
    Parameters<typeof withAuthenticatedBrowserSessionPage>[0]["run"]
  >[0],
  input: {
    mappedEmail: string;
    contactExternalId?: string;
  }
): Promise<GenieEmailRecord[]> {
  const roots = page.locator(
    '#conv-email-message-view [datatestid="EMAIL_DETAILS"][isinbound="true"]'
  );
  const count = Math.min(await roots.count(), 20);
  const records: GenieEmailRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const root = roots.nth(index);
    const emailId = (
      (await root
        .locator("[data-email-id]")
        .first()
        .getAttribute("data-email-id")
        .catch(() => null)) || ""
    ).trim();
    if (!emailId) continue;

    await root.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(100);

    if (!/^[A-Za-z0-9_-]{1,180}$/.test(emailId)) continue;
    const currentMail = root.locator("#mail-card-" + emailId).first();
    if (!(await currentMail.count())) continue;

    if (!(await currentMail.locator("iframe[srcdoc]").count())) {
      await currentMail.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(100);
    }

    const parsed = await currentMail
      .evaluate(element => {
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const senderCandidates = Array.from(element.querySelectorAll("span"))
          .map(node => (node.textContent || "").trim())
          .filter(value =>
            /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)
          );
        const sender = senderCandidates[0] || "";
        const toMatch = text.match(
          /\bTo:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
        );
        const recipient = toMatch?.[1] || "";
        const iframe = element.querySelector(
          "iframe[srcdoc]"
        ) as HTMLIFrameElement | null;
        const srcdoc = iframe?.getAttribute("srcdoc") || "";
        let body = "";
        if (srcdoc) {
          const doc = new DOMParser().parseFromString(srcdoc, "text/html");
          doc
            .querySelectorAll("script,style,noscript")
            .forEach(node => node.remove());
          body = (doc.body?.textContent || "")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        }
        return { sender, recipient, body };
      })
      .catch(() => ({ sender: "", recipient: "", body: "" }));

    const sender = normalizeEmail(parsed.sender);
    const recipient = normalizeEmail(parsed.recipient);
    if (
      !sender ||
      !recipient ||
      !parsed.body ||
      sender === normalizeEmail(input.mappedEmail)
    )
      continue;
    if (
      !exactGenieMailboxIdentity({
        appEmail: input.mappedEmail,
        mappingEmail: input.mappedEmail,
        recipientEmail: recipient,
      })
    )
      continue;

    const subject = (
      (await root
        .locator("#conv-mail-thread-header")
        .first()
        .textContent()
        .catch(() => "")) || ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    records.push({
      emailId,
      sender,
      recipient,
      subject: subject || undefined,
      body: parsed.body,
      contactExternalId: input.contactExternalId,
    });
  }

  return records;
}

async function navigateToGenieConversations(
  page: Parameters<
    Parameters<typeof withAuthenticatedBrowserSessionPage>[0]["run"]
  >[0]
) {
  if (!/\/conversations\//.test(page.url())) {
    const conversations = page.locator("#sb_conversations").first();
    await conversations.waitFor({ state: "visible", timeout: 15_000 });
    await Promise.all([
      page.waitForURL(/\/conversations\//, { timeout: 15_000 }),
      conversations.click(),
    ]);
  }
  await page.waitForTimeout(500);
  const unread = page.locator('button[aria-label^="Unread"]').first();
  if (await unread.count()) {
    await unread.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.locator("#conversations-list").waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

export async function syncGenieMailboxForUser(input: {
  userId: number;
  organisationId: number;
}) {
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const system = systems.find(
    candidate =>
      candidate.provider === "genie" &&
      ["browser", "sidecar"].includes(candidate.connectionMethod)
  );
  if (!system)
    return {
      checked: 0,
      received: 0,
      draftsPrepared: 0,
      skipped: "GENIE_NOT_CONNECTED",
    };

  const scope = await verifiedUserCrmScope({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: system.id,
  });
  if (!scope?.email)
    return {
      checked: 0,
      received: 0,
      draftsPrepared: 0,
      skipped: "EXACT_CRM_EMAIL_MAPPING_REQUIRED",
    };

  const secret = await loadUserConnectionSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: system.id,
    secretKind: "browser",
  });
  if (
    !secret?.browserSession ||
    secret.browserUserId !== input.userId ||
    !secret.crmUserExternalId ||
    normalizeEmail(secret.crmUserEmail) !== normalizeEmail(scope.email)
  )
    return {
      checked: 0,
      received: 0,
      draftsPrepared: 0,
      skipped: "PERSONAL_GENIE_SESSION_REQUIRED",
    };

  const connection = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    system.id
  );
  const adapterConnection = toAdapterConnection(connection);

  let checked = 0;
  let received = 0;
  let draftsPrepared = 0;

  await withAuthenticatedBrowserSessionPage({
    connection: adapterConnection,
    secret,
    provider: "genie",
    run: async page => {
      await navigateToGenieConversations(page);
      const cards = page.locator(
        "#conversations-list [data-conversation-id][contactid]"
      );
      const count = Math.min(await cards.count(), MAX_CONVERSATIONS_PER_SYNC);
      checked = count;

      for (let index = 0; index < count; index += 1) {
        const card = page
          .locator("#conversations-list [data-conversation-id][contactid]")
          .nth(index);
        const contactExternalId =
          (await card.getAttribute("contactid").catch(() => null)) || undefined;
        await card.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(180);

        const messages = await readCurrentConversationEmails(page, {
          mappedEmail: scope.email,
          contactExternalId,
        });
        for (const message of messages) {
          if (
            !exactGenieMailboxIdentity({
              appEmail: scope.email,
              mappingEmail: secret.crmUserEmail,
              recipientEmail: message.recipient,
            })
          )
            continue;
          const result = await ingestInboundMessage({
            organisationId: input.organisationId,
            mailboxUserId: input.userId,
            connectedSystemId: system.id,
            envelope: {
              externalMessageId: message.emailId,
              channel: "email",
              senderReference: message.sender,
              subject: message.subject,
              body: message.body,
              receivedAt: new Date(),
            },
          });
          if (!result.duplicate) received += 1;
        }
      }
    },
  });

  if (received > 0)
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "personal_genie_mailbox_synced",
      entityType: "connected_system",
      entityId: String(system.id),
      summary:
        "Incoming Genie email was synchronized for the mapped salesperson.",
      metadata: {
        checkedConversations: checked,
        received,
        draftsPrepared,
        contentRetained: false,
        exactEmailIsolation: true,
        crmUserExternalId: scope.externalUserId,
      },
    });

  return { checked, received, draftsPrepared };
}

export async function syncReadyGenieMailboxes() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const rows = await db
    .select({
      userId: organisationMembers.userId,
      organisationId: organisationMembers.organisationId,
      settings: organisations.settings,
    })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisationMembers.organisationId, organisations.id)
    )
    .where(eq(organisationMembers.isActive, true))
    .limit(MAX_GENIE_MAILBOXES_PER_CYCLE * 4);

  const selected = rows
    .filter(
      row =>
        memberOnboardingFor(row.settings ?? {}, row.userId).emailSource ===
        "genie"
    )
    .slice(0, MAX_GENIE_MAILBOXES_PER_CYCLE);

  let synced = 0;
  let failed = 0;
  let received = 0;
  let draftsPrepared = 0;

  for (const row of selected) {
    try {
      const result = await syncGenieMailboxForUser({
        userId: row.userId,
        organisationId: row.organisationId,
      });
      if ("skipped" in result) continue;
      synced += 1;
      received += result.received;
      draftsPrepared += result.draftsPrepared;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "personal_genie_mailbox_sync_failed",
          userId: row.userId,
          organisationId: row.organisationId,
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
    }
  }

  return {
    checked: selected.length,
    synced,
    failed,
    received,
    draftsPrepared,
    boundedAt: MAX_GENIE_MAILBOXES_PER_CYCLE,
  };
}
