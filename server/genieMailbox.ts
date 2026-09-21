import { isRetryableGenieMailboxRead } from "./genieMailboxRetry";
import { readPersonalGenieMailbox } from "./browserConnectors/genieMailboxRead";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import {
  inboundMessages,
  organisationMembers,
  organisations,
  salesWorkItems,
} from "../drizzle/schema";
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
import { completeNewLeadWorkAfterVerifiedContact } from "./salesWork";
import { withAuthenticatedBrowserSessionPage } from "./browserConnectors/browserCrmAdapter";

const MAX_GENIE_MAILBOXES_PER_CYCLE = 50;
const MAX_CONVERSATIONS_PER_SYNC = 20;

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

export function exactGenieMailboxIdentity(input: {
  appEmail: string | null | undefined;
  mappingEmail: string | null | undefined;
}) {
  const app = normalizeEmail(input.appEmail);
  const mapping = normalizeEmail(input.mappingEmail);
  return Boolean(app && app === mapping);
}

export function parseGenieReceivedAt(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}


export function genieInboundConversationId(
  classification: unknown
): string | undefined {
  if (!classification || typeof classification !== "object" || Array.isArray(classification))
    return undefined;
  const value = (classification as Record<string, unknown>).conversationExternalId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function genieInboundRecipient(
  classification: unknown
): string | undefined {
  if (!classification || typeof classification !== "object" || Array.isArray(classification))
    return undefined;
  const value = (classification as Record<string, unknown>).recipientReference;
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

export function outboundGenieReplyMatchesInbound(
  inbound: {
    contactExternalId: string | null;
    receivedAt: Date;
    classification: unknown;
  },
  evidence: {
    contactExternalId: string;
    conversationExternalId: string;
    sentAt: Date;
  }
) {
  return (
    inbound.contactExternalId === evidence.contactExternalId &&
    inbound.receivedAt.valueOf() <= evidence.sentAt.valueOf() &&
    genieInboundConversationId(inbound.classification) ===
      evidence.conversationExternalId
  );
}

async function reconcileGenieOutboundReplies(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  outboundEvidence: Array<{
    externalMessageId: string;
    channel: "email" | "sms" | "chat";
    contactExternalId: string;
    conversationExternalId: string;
    sentAt: Date;
  }>;
}) {
  if (!input.outboundEvidence.length) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  let handled = 0;
  for (const evidence of input.outboundEvidence) {
    const candidates = await db
      .select({
        id: inboundMessages.id,
        externalMessageId: inboundMessages.externalMessageId,
        contactExternalId: inboundMessages.contactExternalId,
        receivedAt: inboundMessages.receivedAt,
        classification: inboundMessages.classification,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.mailboxUserId, input.userId),
          eq(inboundMessages.connectedSystemId, input.connectedSystemId),
          eq(inboundMessages.needsAction, true),
          eq(inboundMessages.contactExternalId, evidence.contactExternalId),
          lte(inboundMessages.receivedAt, evidence.sentAt)
        )
      );
    const matched = candidates.filter(row =>
      outboundGenieReplyMatchesInbound(row, evidence)
    );
    if (!matched.length) continue;
    const ids = matched.map(row => row.id);
    const externalIds = matched.map(row => row.externalMessageId);
    await db
      .update(inboundMessages)
      .set({ status: "archived", needsAction: false })
      .where(inArray(inboundMessages.id, ids));
    await db
      .update(salesWorkItems)
      .set({
        status: "completed",
        completedAt: evidence.sentAt,
        freshness: "current",
        syncedAt: new Date(),
      })
      .where(
        and(
          eq(salesWorkItems.organisationId, input.organisationId),
          eq(salesWorkItems.connectedSystemId, input.connectedSystemId),
          eq(salesWorkItems.salespersonUserId, input.userId),
          eq(salesWorkItems.sourceType, "inbound_message"),
          inArray(salesWorkItems.sourceExternalId, externalIds),
          inArray(salesWorkItems.status, [
            "open",
            "in_progress",
            "snoozed",
            "blocked",
          ])
        )
      );
    await completeNewLeadWorkAfterVerifiedContact({
      userId: input.userId,
      organisationId: input.organisationId,
      contactExternalId: evidence.contactExternalId,
      reason: "verified_outbound_reply",
    }).catch(() => 0);
    handled += matched.length;
  }
  return handled;
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
    !exactGenieMailboxIdentity({
      appEmail: scope.email,
      mappingEmail: secret.crmUserEmail,
    })
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

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const actionableEmailRows = await db
    .select({
      id: inboundMessages.id,
      externalMessageId: inboundMessages.externalMessageId,
      classification: inboundMessages.classification,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.organisationId, input.organisationId),
        eq(inboundMessages.mailboxUserId, input.userId),
        eq(inboundMessages.connectedSystemId, system.id),
        eq(inboundMessages.channel, "email"),
        eq(inboundMessages.needsAction, true)
      )
    )
    .limit(500);
  const foreignRecipientRows = actionableEmailRows.filter(row => {
    const recipient = genieInboundRecipient(row.classification);
    return Boolean(recipient && recipient !== scope.email!.trim().toLowerCase());
  });
  if (foreignRecipientRows.length) {
    const ids = foreignRecipientRows.map(row => row.id);
    const externalIds = foreignRecipientRows.map(row => row.externalMessageId);
    await db
      .update(inboundMessages)
      .set({ needsAction: false, status: "archived" })
      .where(inArray(inboundMessages.id, ids));
    await db
      .update(salesWorkItems)
      .set({
        status: "completed",
        completedAt: new Date(),
        freshness: "current",
        syncedAt: new Date(),
      })
      .where(
        and(
          eq(salesWorkItems.organisationId, input.organisationId),
          eq(salesWorkItems.connectedSystemId, system.id),
          eq(salesWorkItems.salespersonUserId, input.userId),
          eq(salesWorkItems.sourceType, "inbound_message"),
          inArray(salesWorkItems.sourceExternalId, externalIds),
          inArray(salesWorkItems.status, [
            "open",
            "in_progress",
            "snoozed",
            "blocked",
          ])
        )
      );
  }

  const latest = (
    await db
      .select({ receivedAt: inboundMessages.receivedAt })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.mailboxUserId, input.userId),
          eq(inboundMessages.connectedSystemId, system.id)
        )
      )
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(1)
  )[0];
  const oldestActionable = (
    await db
      .select({ receivedAt: inboundMessages.receivedAt })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.mailboxUserId, input.userId),
          eq(inboundMessages.connectedSystemId, system.id),
          eq(inboundMessages.needsAction, true)
        )
      )
      .orderBy(asc(inboundMessages.receivedAt))
      .limit(1)
  )[0];
  const legacyActionable = (
    await db
      .select({
        id: inboundMessages.id,
        externalMessageId: inboundMessages.externalMessageId,
        channel: inboundMessages.channel,
        contactExternalId: inboundMessages.contactExternalId,
        receivedAt: inboundMessages.receivedAt,
        classification: inboundMessages.classification,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.mailboxUserId, input.userId),
          eq(inboundMessages.connectedSystemId, system.id),
          eq(inboundMessages.needsAction, true)
        )
      )
      .orderBy(asc(inboundMessages.receivedAt))
      .limit(60)
  )
    .filter(
      row =>
        !genieInboundConversationId(row.classification) &&
        Boolean(row.contactExternalId) &&
        ["email", "sms", "chat"].includes(row.channel)
    )
    .slice(0, 20);
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60_000;
  const oneDayAgo = now - 24 * 60 * 60_000;
  const latestOverlap = latest?.receivedAt
    ? latest.receivedAt.getTime() - 6 * 60 * 60_000
    : sevenDaysAgo;
  const actionableOverlap = oldestActionable?.receivedAt
    ? oldestActionable.receivedAt.getTime() - 6 * 60 * 60_000
    : oneDayAgo;
  // Revisit unresolved inbound work for up to seven days so a reply made
  // directly in Genie can retire the matching Today item after the fact.
  const since = new Date(
    Math.max(
      sevenDaysAgo,
      Math.min(oneDayAgo, latestOverlap, actionableOverlap)
    )
  );

  const proof = await withAuthenticatedBrowserSessionPage({
    connection: adapterConnection,
    secret,
    provider: "genie",
    run: page =>
      readPersonalGenieMailbox({
        page,
        ownerExternalId: scope.externalUserId,
        mailboxEmail: scope.email,
        since,
        unresolved: legacyActionable.map(row => ({
          externalMessageId: row.externalMessageId,
          channel: row.channel as "email" | "sms" | "chat",
          contactExternalId: row.contactExternalId!,
          receivedAt: row.receivedAt,
        })),
      }),
  });
  checked = proof.checked;
  for (const link of proof.legacyConversationLinks) {
    const row = legacyActionable.find(
      candidate => candidate.externalMessageId === link.inboundExternalMessageId
    );
    if (!row) continue;
    const classification =
      row.classification &&
      typeof row.classification === "object" &&
      !Array.isArray(row.classification)
        ? (row.classification as Record<string, unknown>)
        : {};
    await db
      .update(inboundMessages)
      .set({
        classification: {
          ...classification,
          conversationExternalId: link.conversationExternalId,
        },
      })
      .where(
        and(
          eq(inboundMessages.id, row.id),
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.mailboxUserId, input.userId),
          eq(inboundMessages.connectedSystemId, system.id)
        )
      );
  }
  for (const message of proof.records) {
    const result = await ingestInboundMessage({
      organisationId: input.organisationId,
      mailboxUserId: input.userId,
      connectedSystemId: system.id,
      envelope: {
        externalMessageId: message.externalMessageId,
        channel: message.channel,
        sourceChannel: message.channel === "chat" ? "whatsapp" : undefined,
        senderReference: message.sender,
        recipientReference: message.recipient,
        contactExternalId: message.contactExternalId,
        conversationExternalId: message.conversationExternalId,
        subject: message.subject,
        body: message.body,
        receivedAt: message.receivedAt,
      },
    });
    if (!result.duplicate) received += 1;
  }
  const handledReplies = await reconcileGenieOutboundReplies({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: system.id,
    outboundEvidence: proof.outboundEvidence,
  });

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
      handledReplies,
      outboundEvidence: proof.outboundEvidence.length,
      legacyConversationLinks: proof.legacyConversationLinks.length,
      legacyActionableChecked: legacyActionable.length,
      draftsPrepared,
      contentRetained: false,
      exactEmailIsolation: true,
      readOnlySource: proof.readOnlySource,
      unreadPreserved: proof.unreadPreserved,
      rejectedForeignRecipientCount:
        proof.rejectedForeignRecipientCount + foreignRecipientRows.length,
      rejectedForeignOwnerCount: proof.rejectedForeignOwnerCount,
      examined: proof.examined,
      bounded: proof.bounded,
      sourceSince: since.toISOString(),
      crmUserExternalId: scope.externalUserId,
    },
  });

  return {
    checked,
    received,
    handledReplies,
    draftsPrepared,
    rejectedForeignRecipientCount:
      proof.rejectedForeignRecipientCount + foreignRecipientRows.length,
    rejectedForeignOwnerCount: proof.rejectedForeignOwnerCount,
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
  let deferred = 0;
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
      if (isRetryableGenieMailboxRead(error)) {
        deferred += 1;
        console.info(
          JSON.stringify({
            event: "personal_genie_mailbox_retry_deferred",
            userId: row.userId,
            organisationId: row.organisationId,
            readOnlySource: true,
          })
        );
        continue;
      }
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
    deferred,
    failed,
    received,
    draftsPrepared,
    boundedAt: MAX_GENIE_MAILBOXES_PER_CYCLE,
  };
}
