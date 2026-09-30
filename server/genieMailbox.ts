import { isRetryableGenieMailboxRead } from "./genieMailboxRetry";
import { readPersonalGenieMailbox } from "./browserConnectors/genieMailboxRead";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import {
  assistantReminders,
  inboundMessages,
  organisationMembers,
  organisations,
  salesActivityEvents,
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

export function isDeferrableGenieInboundScopeError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === "INBOUND_CONTACT_SCOPE_REQUIRED"
  );
}

export function shouldTargetGenieActionableBackfill(input: {
  channel: string;
  contactExternalId: string | null;
}) {
  return (
    Boolean(input.contactExternalId) &&
    ["email", "sms", "chat"].includes(input.channel)
  );
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
    externalMessageId?: string;
    contactExternalId: string | null;
    receivedAt: Date;
    classification: unknown;
  },
  evidence: {
    contactExternalId: string;
    conversationExternalId: string;
    sentAt: Date;
    inboundExternalMessageId?: string;
    verifiedAfterInboundByThreadOrder?: boolean;
  }
) {
  const sameContact =
    inbound.contactExternalId === evidence.contactExternalId;
  const sameConversation =
    genieInboundConversationId(inbound.classification) ===
    evidence.conversationExternalId;
  if (
    evidence.verifiedAfterInboundByThreadOrder === true ||
    evidence.inboundExternalMessageId
  ) {
    return (
      sameContact &&
      sameConversation &&
      evidence.verifiedAfterInboundByThreadOrder === true &&
      Boolean(
        evidence.inboundExternalMessageId &&
          inbound.externalMessageId === evidence.inboundExternalMessageId
      )
    );
  }
  return (
    sameContact &&
    sameConversation &&
    inbound.receivedAt.valueOf() <= evidence.sentAt.valueOf()
  );
}

export function inboundReminderMessageId(
  sourceReference: string | null | undefined
) {
  const match = /^inbound:(\d+):commitment$/.exec(sourceReference?.trim() || "");
  if (!match) return undefined;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

async function reconcileHandledInboundReminders(input: {
  userId: number;
  organisationId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const reminders = await db
    .select({
      id: assistantReminders.id,
      sourceReference: assistantReminders.sourceReference,
    })
    .from(assistantReminders)
    .where(
      and(
        eq(assistantReminders.organisationId, input.organisationId),
        eq(assistantReminders.userId, input.userId),
        eq(assistantReminders.source, "inbound"),
        inArray(assistantReminders.status, ["open", "snoozed"])
      )
    )
    .limit(200);
  const reminderMessageIds = reminders
    .map(reminder => ({
      reminderId: reminder.id,
      messageId: inboundReminderMessageId(reminder.sourceReference),
    }))
    .filter(
      (row): row is { reminderId: number; messageId: number } =>
        Boolean(row.messageId)
    );
  if (!reminderMessageIds.length) return 0;
  const messages = await db
    .select({
      id: inboundMessages.id,
      status: inboundMessages.status,
      needsAction: inboundMessages.needsAction,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.organisationId, input.organisationId),
        eq(inboundMessages.mailboxUserId, input.userId),
        inArray(
          inboundMessages.id,
          reminderMessageIds.map(row => row.messageId)
        )
      )
    );
  const handledMessageIds = new Set(
    messages
      .filter(message => !message.needsAction || message.status === "archived")
      .map(message => message.id)
  );
  const reminderIds = reminderMessageIds
    .filter(row => handledMessageIds.has(row.messageId))
    .map(row => row.reminderId);
  if (!reminderIds.length) return 0;
  await db
    .update(assistantReminders)
    .set({
      status: "completed",
      completedAt: new Date(),
      snoozedUntil: null,
    })
    .where(inArray(assistantReminders.id, reminderIds));
  return reminderIds.length;
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
    inboundExternalMessageId?: string;
    verifiedAfterInboundByThreadOrder?: boolean;
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
          eq(inboundMessages.contactExternalId, evidence.contactExternalId)
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
  let deferredMissingContactScope = 0;

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  // A received inbound message cannot legitimately be hours in the future.
  // Normalize persisted bad source clocks here as well as at parse time so
  // previously-ingested rows cannot poison Today ordering or freshness.
  const mailboxObservedAt = new Date();
  const futureCutoff = new Date(mailboxObservedAt.getTime() + 5 * 60_000);
  const futureInboundRows = await db
    .select({
      id: inboundMessages.id,
      externalMessageId: inboundMessages.externalMessageId,
      idempotencyKey: inboundMessages.idempotencyKey,
      receivedAt: inboundMessages.receivedAt,
      classification: inboundMessages.classification,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.organisationId, input.organisationId),
        eq(inboundMessages.mailboxUserId, input.userId),
        eq(inboundMessages.connectedSystemId, system.id),
        gt(inboundMessages.receivedAt, futureCutoff)
      )
    )
    .orderBy(asc(inboundMessages.receivedAt))
    .limit(100);
  if (futureInboundRows.length) {
    const maxFutureSkewMs = Math.max(
      ...futureInboundRows.map(row =>
        Math.max(0, row.receivedAt.getTime() - mailboxObservedAt.getTime())
      )
    );
    for (const row of futureInboundRows) {
      const classification =
        row.classification &&
        typeof row.classification === "object" &&
        !Array.isArray(row.classification)
          ? (row.classification as Record<string, unknown>)
          : {};
      await db
        .update(inboundMessages)
        .set({
          receivedAt: mailboxObservedAt,
          classification: {
            ...classification,
            timestampNormalization: {
              reason: "future_source_time",
              originalReceivedAt: row.receivedAt.toISOString(),
              normalizedAt: mailboxObservedAt.toISOString(),
            },
          },
        })
        .where(eq(inboundMessages.id, row.id));
      await db
        .update(salesWorkItems)
        .set({
          dueAt: mailboxObservedAt,
          sourceUpdatedAt: mailboxObservedAt,
          syncedAt: mailboxObservedAt,
        })
        .where(
          and(
            eq(salesWorkItems.organisationId, input.organisationId),
            eq(salesWorkItems.connectedSystemId, system.id),
            eq(salesWorkItems.salespersonUserId, input.userId),
            eq(salesWorkItems.sourceType, "inbound_message"),
            eq(salesWorkItems.sourceExternalId, row.externalMessageId)
          )
        );
      if (row.idempotencyKey) {
        await db
          .update(salesActivityEvents)
          .set({ occurredAt: mailboxObservedAt })
          .where(
            and(
              eq(salesActivityEvents.organisationId, input.organisationId),
              eq(salesActivityEvents.connectedSystemId, system.id),
              eq(salesActivityEvents.salespersonUserId, input.userId),
              eq(salesActivityEvents.source, "inbound_message"),
              eq(
                salesActivityEvents.externalId,
                `reply:${row.idempotencyKey}`
              )
            )
          );
      }
    }
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "personal_genie_mailbox_timestamp_normalized",
      entityType: "connected_system",
      entityId: String(system.id),
      summary:
        "Impossible future Genie mailbox timestamps were normalized to the current observation time.",
      metadata: {
        count: futureInboundRows.length,
        maxFutureSkewMs,
        normalizedAt: mailboxObservedAt.toISOString(),
      },
    });
  }

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
  const actionableBackfill = (
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
    .filter(row =>
      shouldTargetGenieActionableBackfill({
        channel: row.channel,
        contactExternalId: row.contactExternalId,
      })
    )
    .slice(0, 20);
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60_000;
  // The fast mailbox lane only needs a small overlap behind the newest message.
  // Older actionable items are reconciled explicitly by actionableBackfill,
  // so they must not force every 30-second live scan to crawl hours of history.
  const latestReceivedAt = latest?.receivedAt
    ? Math.min(latest.receivedAt.getTime(), now)
    : oneDayAgo;
  const latestOverlap = latestReceivedAt - 2 * 60_000;
  const since = new Date(Math.max(oneDayAgo, latestOverlap));

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
        unresolved: actionableBackfill.map(row => ({
          externalMessageId: row.externalMessageId,
          channel: row.channel as "email" | "sms" | "chat",
          contactExternalId: row.contactExternalId!,
          receivedAt: row.receivedAt,
        })),
      }),
  });
  checked = proof.checked;
  for (const link of proof.legacyConversationLinks) {
    const row = actionableBackfill.find(
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
    try {
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
    } catch (error) {
      // The live Genie contact was already owner-verified by the mailbox reader.
      // If our local owner-scoped contact cache has not caught up yet, defer only
      // that message. Do not abort retirement/reconciliation for every other
      // message in the user's mailbox.
      if (!isDeferrableGenieInboundScopeError(error)) throw error;
      deferredMissingContactScope += 1;
    }
  }
  const handledReplies = await reconcileGenieOutboundReplies({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: system.id,
    outboundEvidence: proof.outboundEvidence,
  });
  const handledReminders = await reconcileHandledInboundReminders({
    userId: input.userId,
    organisationId: input.organisationId,
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
      handledReminders,
      outboundEvidence: proof.outboundEvidence.length,
      legacyConversationLinks: proof.legacyConversationLinks.length,
      legacyActionableChecked: actionableBackfill.length,
      legacyEmailDetailReads: proof.legacyEmailDetailReads,
      legacyEmailDetailReadBudgetExhausted:
        proof.legacyEmailDetailReadBudgetExhausted,
      draftsPrepared,
      contentRetained: false,
      exactEmailIsolation: true,
      readOnlySource: proof.readOnlySource,
      unreadPreserved: proof.unreadPreserved,
      rejectedForeignRecipientCount:
        proof.rejectedForeignRecipientCount + foreignRecipientRows.length,
      rejectedForeignOwnerCount: proof.rejectedForeignOwnerCount,
      deferredMissingContactScope,
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
    handledReminders,
    draftsPrepared,
    rejectedForeignRecipientCount:
      proof.rejectedForeignRecipientCount + foreignRecipientRows.length,
    rejectedForeignOwnerCount: proof.rejectedForeignOwnerCount,
    deferredMissingContactScope,
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
