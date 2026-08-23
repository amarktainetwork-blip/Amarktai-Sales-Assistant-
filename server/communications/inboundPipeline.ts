import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  contactCommunicationSuppressions,
  crmContacts,
  inboundMessages,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { recordOperationalEvent } from "../observability/events";
import { normalizeCrmEmail, normalizeCrmPhone } from "../crm/identity";
import {
  classifyInboundMessage,
  type InboundClassification,
} from "./inboundReview";

export type InboundEnvelope = {
  externalMessageId: string;
  channel: "email" | "sms" | "chat" | "other";
  senderReference: string;
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
    subject: typeof nested.subject === "string" ? nested.subject : undefined,
    body,
    receivedAt: Number.isNaN(receivedAt.valueOf()) ? new Date() : receivedAt,
  };
}

export function inboundIdempotencyKey(
  organisationId: number,
  channel: InboundEnvelope["channel"],
  externalMessageId: string
) {
  return createHash("sha256")
    .update(`${organisationId}\0${channel}\0${externalMessageId.trim()}`)
    .digest("hex");
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
  envelope: InboundEnvelope
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
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
      and(eq(crmContacts.organisationId, organisationId), eq(field, sender))
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
  const match = await matchInboundContact(input.organisationId, {
    ...input.envelope,
    senderReference,
  });
  const contact = match.contact;
  const idempotencyKey = inboundIdempotencyKey(
    input.organisationId,
    input.envelope.channel,
    externalMessageId
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
        contactMatched: Boolean(contact),
        contactAmbiguous: match.ambiguous,
      },
      status: "classified",
      needsAction: shouldSurfaceInbound(classification),
      receivedAt: input.envelope.receivedAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        idempotencyKey,
        connectedSystemId:
          input.connectedSystemId ?? contact?.connectedSystemId ?? null,
        senderReference,
        contactExternalId: contact?.externalId ?? null,
        subject: input.envelope.subject?.trim().slice(0, 500) || null,
        body: input.envelope.body.trim().slice(0, 100_000),
        classification: {
          category: classification.category,
          reasons: classification.reasons,
          contactMatched: Boolean(contact),
          contactAmbiguous: match.ambiguous,
        },
        status: "classified",
        needsAction: shouldSurfaceInbound(classification),
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
