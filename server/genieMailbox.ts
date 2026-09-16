import { readPersonalGenieMailbox } from "./browserConnectors/genieMailboxRead";
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

export function parseGenieReceivedAt(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
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
      ["browser", "sidecar"].includes(candidate.connectionMethod) &&
      ["ready", "limited_permissions"].includes(candidate.status)
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

  const proof = await withAuthenticatedBrowserSessionPage({
    connection: adapterConnection,
    secret,
    provider: "genie",
    run: page =>
      readPersonalGenieMailbox({
        page,
        ownerExternalId: scope.externalUserId,
        mailboxEmail: scope.email,
      }),
  });
  checked = proof.checked;
  for (const message of proof.records) {
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
        recipientReference: message.recipient,
        subject: message.subject,
        body: message.body,
        receivedAt: message.receivedAt,
      },
    });
    if (!result.duplicate) received += 1;
  }

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
      readOnlySource: proof.readOnlySource,
      unreadPreserved: proof.unreadPreserved,
      rejectedForeignRecipientCount: proof.rejectedForeignRecipientCount,
      examined: proof.examined,
      bounded: proof.bounded,
      crmUserExternalId: scope.externalUserId,
    },
  });

  return {
    checked,
    received,
    draftsPrepared,
    rejectedForeignRecipientCount: proof.rejectedForeignRecipientCount,
    unreadPreserved: proof.unreadPreserved,
    bounded: proof.bounded,
  };
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
    .where(eq(organisationMembers.isActive, true));

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
