import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  contactCommunicationSuppressions,
  crmContacts,
  externalUserMappings,
  inboundMessages,
  salesActivityEvents,
  salesWorkItems,
  organisations,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { recordOperationalEvent } from "../observability/events";
import { normalizeCrmEmail, normalizeCrmPhone } from "../crm/identity";
import {
  classifyInboundMessage,
  type InboundClassification,
} from "./inboundReview";
import {
  parseDeterministicReminder,
  persistConfirmedCommitment,
} from "../memory";
import { evaluateStoredAutomationPolicy } from "../automationPolicyEvaluator";
import { completeNewLeadWorkAfterVerifiedContact } from "../salesWork";

export type InboundEnvelope = {
  externalMessageId: string;
  channel: "email" | "sms" | "chat" | "other";
  senderReference: string;
  recipientReference?: string;
  contactExternalId?: string;
  conversationExternalId?: string;
  sourceChannel?: "whatsapp";
  subject?: string;
  body: string;
  receivedAt: Date;
};

export function parseInboundWebhookEnvelope(
  value: unknown
): InboundEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const source = value as Record<string, unknown>;
  const nested =
    source.message &&
    typeof source.message === "object" &&
    !Array.isArray(source.message)
      ? (source.message as Record<string, unknown>)
      : source;
  const externalMessageId = String(
    nested.externalMessageId || nested.messageId || nested.id || ""
  ).trim();
  const senderReference = String(
    nested.senderReference || nested.from || nested.sender || ""
  ).trim();
  const body = String(
    nested.body || nested.text || nested.content || ""
  ).trim();
  if (!externalMessageId || !senderReference || !body) return undefined;
  const channel = ["email", "sms", "chat", "other"].includes(
    String(nested.channel)
  )
    ? (String(nested.channel) as InboundEnvelope["channel"])
    : "other";
  const receivedAt = new Date(
    String(nested.receivedAt || nested.createdAt || Date.now())
  );
  return {
    externalMessageId,
    channel,
    senderReference,
    contactExternalId:
      typeof (nested.contactExternalId || nested.contactId) === "string"
        ? String(nested.contactExternalId || nested.contactId).trim() ||
          undefined
        : undefined,
    subject: typeof nested.subject === "string" ? nested.subject : undefined,
    body,
    receivedAt: Number.isNaN(receivedAt.valueOf()) ? new Date() : receivedAt,
  };
}

export function inboundIdempotencyKey(
  organisationId: number,
  channel: InboundEnvelope["channel"],
  externalMessageId: string,
  mailboxUserId?: number
) {
  const material = mailboxUserId
    ? `${organisationId}\0mailbox:${mailboxUserId}\0${channel}\0${externalMessageId.trim()}`
    : `${organisationId}\0${channel}\0${externalMessageId.trim()}`;
  return createHash("sha256").update(material).digest("hex");
}

function normalizedSender(channel: InboundEnvelope["channel"], value: string) {
  return channel === "email"
    ? normalizeCrmEmail(value) || ""
    : normalizeCrmPhone(value) || "";
}

export function shouldSurfaceInbound(classification: InboundClassification) {
  return classification.category !== "information";
}

export function mayPrepareInboundReply(
  classification: InboundClassification,
  suppressed: boolean
) {
  return (
    !suppressed &&
    classification.category !== "unsubscribe" &&
    classification.category !== "information"
  );
}

export async function matchInboundContact(
  organisationId: number,
  envelope: InboundEnvelope,
  scope?: { connectedSystemId?: number | null; mailboxUserId?: number | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  let ownerExternalId: string | undefined;
  if (scope?.mailboxUserId != null && scope.connectedSystemId) {
    const owners = await db
      .select({ externalUserId: externalUserMappings.externalUserId })
      .from(externalUserMappings)
      .where(
        and(
          eq(externalUserMappings.organisationId, organisationId),
          eq(externalUserMappings.connectedSystemId, scope.connectedSystemId),
          eq(externalUserMappings.userId, scope.mailboxUserId),
          eq(externalUserMappings.isActive, true)
        )
      )
      .limit(2);
    if (owners.length !== 1) throw new Error("INBOUND_OWNER_SCOPE_REQUIRED");
    ownerExternalId = owners[0].externalUserId;
  }
  if (envelope.contactExternalId && scope?.connectedSystemId) {
    const exact = await db
      .select()
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.organisationId, organisationId),
          eq(crmContacts.connectedSystemId, scope.connectedSystemId),
          eq(crmContacts.externalId, envelope.contactExternalId),
          ownerExternalId
            ? eq(crmContacts.ownerExternalId, ownerExternalId)
            : undefined
        )
      )
      .limit(2);
    return {
      contact: exact.length === 1 ? exact[0] : undefined,
      ambiguous: exact.length > 1,
    };
  }

  const sender = normalizedSender(envelope.channel, envelope.senderReference);
  if (!sender) return { contact: undefined, ambiguous: false };
  const field =
    envelope.channel === "email"
      ? crmContacts.normalizedEmail
      : crmContacts.normalizedPhone;
  const matches = await db
    .select()
    .from(crmContacts)
    .where(
      and(
        eq(crmContacts.organisationId, organisationId),
        eq(field, sender),
        scope?.connectedSystemId
          ? eq(crmContacts.connectedSystemId, scope.connectedSystemId)
          : undefined,
        ownerExternalId
          ? eq(crmContacts.ownerExternalId, ownerExternalId)
          : undefined
      )
    )
    .limit(2);
  return {
    contact: matches.length === 1 ? matches[0] : undefined,
    ambiguous: matches.length > 1,
  };
}

/** Idempotent, tenant-scoped deterministic message ingestion and opt-out handling. */
export async function ingestInboundMessage(input: {
  organisationId: number;
  mailboxUserId?: number | null;
  connectedSystemId?: number | null;
  envelope: InboundEnvelope;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const externalMessageId = input.envelope.externalMessageId
    .trim()
    .slice(0, 220);
  const senderReference = normalizedSender(
    input.envelope.channel,
    input.envelope.senderReference
  ).slice(0, 320);
  if (!externalMessageId || !senderReference || !input.envelope.body.trim())
    throw new Error(
      "Inbound messages require an external ID, sender, and body."
    );
  const classification = classifyInboundMessage({
    subject: input.envelope.subject,
    body: input.envelope.body,
  });
  const match = await matchInboundContact(
    input.organisationId,
    {
      ...input.envelope,
      senderReference,
    },
    {
      connectedSystemId: input.connectedSystemId,
      mailboxUserId: input.mailboxUserId,
    }
  );
  const contact = match.contact;
  if (
    input.mailboxUserId != null &&
    input.envelope.contactExternalId &&
    !contact
  )
    throw new Error("INBOUND_CONTACT_SCOPE_REQUIRED");
  const idempotencyKey = inboundIdempotencyKey(
    input.organisationId,
    input.envelope.channel,
    externalMessageId,
    input.mailboxUserId ?? undefined
  );
  const existing = (
    await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.idempotencyKey, idempotencyKey))
      .limit(1)
  )[0];
  await db
    .insert(inboundMessages)
    .values({
      organisationId: input.organisationId,
      mailboxUserId: input.mailboxUserId ?? null,
      connectedSystemId:
        input.connectedSystemId ?? contact?.connectedSystemId ?? null,
      externalMessageId,
      idempotencyKey,
      channel: input.envelope.channel,
      senderReference,
      contactExternalId: contact?.externalId ?? null,
      subject: input.envelope.subject?.trim().slice(0, 500) || null,
      body: input.envelope.body.trim().slice(0, 100_000),
      classification: {
        category: classification.category,
        reasons: classification.reasons,
        sourceChannel: input.envelope.sourceChannel || input.envelope.channel,
        contactMatched: Boolean(contact),
        contactAmbiguous: match.ambiguous,
        ...(input.envelope.recipientReference
          ? { recipientReference: input.envelope.recipientReference }
          : {}),
        ...(input.envelope.conversationExternalId
          ? { conversationExternalId: input.envelope.conversationExternalId }
          : {}),
      },
      status: "classified",
      needsAction: shouldSurfaceInbound(classification),
      receivedAt: input.envelope.receivedAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        idempotencyKey,
        mailboxUserId: input.mailboxUserId ?? null,
        connectedSystemId:
          input.connectedSystemId ?? contact?.connectedSystemId ?? null,
        senderReference,
        contactExternalId: contact?.externalId ?? null,
        subject: input.envelope.subject?.trim().slice(0, 500) || null,
        body: input.envelope.body.trim().slice(0, 100_000),
        classification: {
          category: classification.category,
          reasons: classification.reasons,
          sourceChannel: input.envelope.sourceChannel || input.envelope.channel,
          contactMatched: Boolean(contact),
          contactAmbiguous: match.ambiguous,
          ...(input.envelope.recipientReference
            ? { recipientReference: input.envelope.recipientReference }
            : {}),
          ...(input.envelope.conversationExternalId
            ? { conversationExternalId: input.envelope.conversationExternalId }
            : {}),
        },
        status: existing?.status === "archived" ? "archived" : "classified",
        needsAction:
          existing?.status === "archived"
            ? false
            : shouldSurfaceInbound(classification),
        receivedAt: input.envelope.receivedAt,
      },
    });
  const message = (
    await db
      .select()
      .from(inboundMessages)
      .where(eq(inboundMessages.idempotencyKey, idempotencyKey))
      .limit(1)
  )[0];
  if (!message) throw new Error("Inbound message could not be persisted.");
  if (!existing && contact) {
    await db
      .insert(salesActivityEvents)
      .values({
        organisationId: input.organisationId,
        connectedSystemId:
          input.connectedSystemId ?? contact.connectedSystemId ?? null,
        salespersonUserId: input.mailboxUserId ?? null,
        externalOwnerId: contact.ownerExternalId ?? null,
        contactExternalId: contact.externalId,
        eventType: "customer_reply",
        source: "inbound_message",
        occurredAt: input.envelope.receivedAt,
        externalId: `reply:${idempotencyKey}`,
        metadata: {
          channel: input.envelope.channel,
          sourceChannel:
            input.envelope.sourceChannel || input.envelope.channel,
          category: classification.category,
          needsAction: shouldSurfaceInbound(classification),
          inboundMessageId: message.id,
        },
      })
      .onDuplicateKeyUpdate({
        set: {
          occurredAt: input.envelope.receivedAt,
          metadata: {
            channel: input.envelope.channel,
            sourceChannel:
              input.envelope.sourceChannel || input.envelope.channel,
            category: classification.category,
            needsAction: shouldSurfaceInbound(classification),
            inboundMessageId: message.id,
          },
        },
      });
  }
  const policyOrganisation = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  const policyContext = {
    actionType: "reply_to_inbound",
    monitorKey: "inbound_mail",
    triggerKey: "inbound_email",
    userId: input.mailboxUserId,
    channel: input.envelope.channel,
    attributes: { category: classification.category },
    now: input.envelope.receivedAt,
    manual: false,
  } as const;
  const triggerPolicy = evaluateStoredAutomationPolicy(
    (policyOrganisation?.settings as Record<string, unknown>)?.automationPolicy,
    {
      ...policyContext,
      phase: "trigger",
    }
  );
  const workPolicy = triggerPolicy.allowedToCreate
    ? evaluateStoredAutomationPolicy(
        (policyOrganisation?.settings as Record<string, unknown>)
          ?.automationPolicy,
        { ...policyContext, phase: "work" }
      )
    : triggerPolicy;
  const workStatus =
    existing?.status === "archived"
      ? ("completed" as const)
      : !shouldSurfaceInbound(classification)
        ? ("completed" as const)
        : ["OUTSIDE_SCHEDULE", "QUIET_HOURS"].includes(workPolicy.outcome)
          ? ("snoozed" as const)
          : workPolicy.allowedToCreate
            ? ("open" as const)
            : ("blocked" as const);
  await db
    .insert(salesWorkItems)
    .values({
      organisationId: input.organisationId,
      salespersonUserId: input.mailboxUserId ?? null,
      connectedSystemId:
        input.connectedSystemId ?? contact?.connectedSystemId ?? null,
      sourceKey: `mailbox:inbound:${message.id}`,
      sourceType: "inbound_message",
      sourceExternalId: externalMessageId,
      contactExternalId: contact?.externalId ?? null,
      type:
        classification.category === "meeting_request"
          ? "APPOINTMENT"
          : "REPLY_REQUIRED",
      priority:
        classification.category === "sale_intent"
          ? 110
          : classification.category === "objection"
            ? 105
            : 95,
      dueAt: input.envelope.receivedAt,
      reason:
        classification.category === "sale_intent"
          ? "A customer appears ready to proceed or needs payment/enrolment help."
          : classification.category === "meeting_request"
            ? "A customer sent a meeting request."
            : "An inbound customer message needs a reply.",
      status: workStatus,
      recommendedNextAction:
        "Review the customer and mailbox context, then prepare a governed reply.",
      automationEligibility: workPolicy.mayExecute
        ? "automatic"
        : workPolicy.allowedToCreate
          ? "propose"
          : "disabled",
      approvalRequirement: workPolicy.approvalMode,
      freshness: "current",
      sourceUpdatedAt: input.envelope.receivedAt,
      syncedAt: new Date(),
      metadata: {
        channel: input.envelope.channel,
        category: classification.category,
        sourceChannel: input.envelope.sourceChannel || input.envelope.channel,
        contactMatched: Boolean(contact),
        contactAmbiguous: match.ambiguous,
        ...(input.envelope.recipientReference
          ? { recipientReference: input.envelope.recipientReference }
          : {}),
        ...(input.envelope.conversationExternalId
          ? { conversationExternalId: input.envelope.conversationExternalId }
          : {}),
        automationPolicyOutcome: workPolicy.outcome,
        monitorKey: "inbound_mail",
        triggerKey: "inbound_email",
      },
    })
    .onDuplicateKeyUpdate({
      set: {
        salespersonUserId: input.mailboxUserId ?? null,
        contactExternalId: contact?.externalId ?? null,
        type:
          classification.category === "meeting_request"
            ? "APPOINTMENT"
            : "REPLY_REQUIRED",
        priority:
          classification.category === "sale_intent"
            ? 110
            : classification.category === "objection"
              ? 105
              : 95,
        dueAt: input.envelope.receivedAt,
        reason:
          classification.category === "sale_intent"
            ? "A customer appears ready to proceed or needs payment/enrolment help."
            : classification.category === "meeting_request"
              ? "A customer sent a meeting request."
              : "An inbound customer message needs a reply.",
        status: workStatus,
        freshness: "current",
        syncedAt: new Date(),
        metadata: {
          channel: input.envelope.channel,
          category: classification.category,
          sourceChannel: input.envelope.sourceChannel || input.envelope.channel,
          contactMatched: Boolean(contact),
          contactAmbiguous: match.ambiguous,
          ...(input.envelope.recipientReference
            ? { recipientReference: input.envelope.recipientReference }
            : {}),
          automationPolicyOutcome: workPolicy.outcome,
          monitorKey: "inbound_mail",
          triggerKey: "inbound_email",
        },
      },
    });
  if (contact?.externalId && input.mailboxUserId != null)
    await completeNewLeadWorkAfterVerifiedContact({
      userId: input.mailboxUserId,
      organisationId: input.organisationId,
      contactExternalId: contact.externalId,
      reason: "verified_inbound_reply",
    });
  if (classification.category === "unsubscribe")
    await db
      .insert(contactCommunicationSuppressions)
      .values({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId ?? null,
        channel: input.envelope.channel,
        senderReference,
        contactExternalId: contact?.externalId ?? null,
        reason: "deterministic_inbound_unsubscribe",
        sourceMessageId: message.id,
      })
      .onDuplicateKeyUpdate({
        set: {
          contactExternalId: contact?.externalId ?? null,
          reason: "deterministic_inbound_unsubscribe",
          sourceMessageId: message.id,
        },
      });
  if (
    classification.category === "meeting_request" &&
    contact?.ownerExternalId &&
    contact.connectedSystemId
  ) {
    const owner = (
      await db
        .select({ userId: externalUserMappings.userId })
        .from(externalUserMappings)
        .where(
          and(
            eq(externalUserMappings.organisationId, input.organisationId),
            eq(
              externalUserMappings.connectedSystemId,
              contact.connectedSystemId
            ),
            eq(externalUserMappings.externalUserId, contact.ownerExternalId),
            eq(externalUserMappings.isActive, true)
          )
        )
        .limit(1)
    )[0];
    if (owner?.userId != null) {
      const organisation = (
        await db
          .select({ timezone: organisations.timezone })
          .from(organisations)
          .where(eq(organisations.id, input.organisationId))
          .limit(1)
      )[0];
      const timezone = organisation?.timezone || "UTC";
      try {
        const parsed = parseDeterministicReminder(
          `Remind me ${input.envelope.body}`,
          input.envelope.receivedAt,
          timezone
        );
        if (parsed)
          await persistConfirmedCommitment({
            userId: owner.userId,
            organisationId: input.organisationId,
            title: parsed.title,
            dueAt: parsed.dueAt,
            timezone,
            source: "inbound",
            sourceReference: `inbound:${message.id}:commitment`,
            contactExternalId: contact.externalId,
          });
      } catch {
        // Ambiguous inbound dates remain reviewable messages; no inferred schedule is stored.
      }
    }
  }
  await recordOperationalEvent({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    category: "inbound_message",
    eventKey: "inbound_message_classified",
    summary: `Inbound ${input.envelope.channel} was classified as ${classification.category}.`,
    detail: {
      inboundMessageId: message.id,
      category: classification.category,
      contactMatched: Boolean(contact),
      contactAmbiguous: match.ambiguous,
      needsAction: shouldSurfaceInbound(classification),
      replyEligible: mayPrepareInboundReply(
        classification,
        classification.category === "unsubscribe"
      ),
    },
  });
  return {
    id: message.id,
    duplicate: Boolean(existing),
    classification,
    contactExternalId: contact?.externalId,
    needsAction: shouldSurfaceInbound(classification),
    replyEligible: mayPrepareInboundReply(
      classification,
      classification.category === "unsubscribe"
    ),
  };
}
