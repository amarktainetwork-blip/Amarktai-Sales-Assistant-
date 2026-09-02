import { createHash } from "node:crypto";
import type {
  AdapterConnection,
  AdapterEvidence,
  ConnectionSecretPayload,
  CrmAdapter,
} from "./crm/types";
import { and, eq, or } from "drizzle-orm";
import { contactCommunicationSuppressions } from "../drizzle/schema";
import { getDb } from "./db";
import { getClientActionConfiguration } from "./clientActionConfiguration";
import {
  findConfiguredTemplate,
  resolveConfiguredSender,
} from "./communicationContent";

export type SalesChannel = "email" | "sms" | "whatsapp";

export type SalesMessage = {
  channel: SalesChannel;
  to: string;
  subject?: string;
  body: string;
  templateName?: string;
  contactExternalId?: string;
  opportunityExternalId?: string;
  senderIdentity?: string;
  idempotencyKey?: string;
};

function assertDestination(channel: SalesChannel, destination: string) {
  const value = destination.trim();
  if (!value) throw new Error(`A ${channel} destination is required.`);
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error("The outbound email address is invalid.");
  if (channel !== "email" && !/^\+?[0-9][0-9 ()-]{5,30}$/.test(value))
    throw new Error(`The outbound ${channel} number is invalid.`);
  return value;
}

export function validateSalesMessage<T extends SalesMessage>(message: T): T {
  const to = assertDestination(message.channel, message.to);
  const body = message.body.trim();
  if (!body)
    throw new Error(
      "TEMPLATE_CONTENT_REQUIRED: outbound communication body cannot be blank."
    );
  const subject = message.subject?.trim();
  if (message.channel === "email" && !subject)
    throw new Error("Outbound sales email requires a subject.");
  const senderIdentity = message.senderIdentity?.trim();
  if (message.channel !== "email" && !senderIdentity)
    throw new Error(
      `SENDER_NOT_COMMISSIONED: an exact approved ${message.channel.toUpperCase()} sender identity is required.`
    );
  return { ...message, to, body, subject, senderIdentity };
}

function suppressionIdentity(message: SalesMessage, destination: string) {
  const channel = message.channel === "whatsapp" ? "chat" : message.channel;
  const senderReference =
    message.channel === "email"
      ? destination.toLowerCase()
      : destination.replace(/[^0-9+]/g, "").replace(/^00/, "+");
  return { channel, senderReference };
}

/** Fail closed when suppression/opt-out state cannot be checked. */
export async function getOutboundSuppressionStatus(input: {
  organisationId: number;
  message: SalesMessage;
}) {
  // Suppression verification is about the target. Sender commissioning is
  // checked separately because drafts may need suppression truth before a
  // sender is resolved.
  const destination = assertDestination(input.message.channel, input.message.to);
  const message = { ...input.message, to: destination };
  const db = await getDb();
  if (!db)
    throw new Error(
      "Database connection is unavailable; outbound suppression cannot be verified."
    );
  const { channel, senderReference } = suppressionIdentity(message, message.to);
  const identity = message.contactExternalId
    ? or(
        eq(contactCommunicationSuppressions.senderReference, senderReference),
        eq(
          contactCommunicationSuppressions.contactExternalId,
          message.contactExternalId
        )
      )
    : eq(contactCommunicationSuppressions.senderReference, senderReference);
  const suppressed = (
    await db
      .select({ id: contactCommunicationSuppressions.id })
      .from(contactCommunicationSuppressions)
      .where(
        and(
          eq(contactCommunicationSuppressions.organisationId, input.organisationId),
          eq(contactCommunicationSuppressions.channel, channel),
          identity
        )
      )
      .limit(1)
  )[0];
  return {
    verified: true as const,
    suppressed: Boolean(suppressed),
    channel: message.channel,
    destination: message.to,
    contactExternalId: message.contactExternalId,
  };
}

async function assertNotSuppressed(
  organisationId: number,
  message: SalesMessage
) {
  const status = await getOutboundSuppressionStatus({
    organisationId,
    message,
  });
  if (status.suppressed)
    throw new Error(
      "OUTBOUND_SUPPRESSED: this contact or destination has an active inbound opt-out."
    );
}

function stableOutboundKey(message: SalesMessage) {
  return `crm-message:${createHash("sha256")
    .update(
      [
        message.channel,
        message.to.trim().toLowerCase(),
        message.templateName || "custom",
        message.subject || "",
        message.body.trim(),
      ].join("\0")
    )
    .digest("hex")
    .slice(0, 36)}`;
}

async function resolveExecutionSender(
  organisationId: number,
  message: SalesMessage
) {
  if (message.channel === "email" || message.senderIdentity?.trim())
    return message.senderIdentity?.trim();
  const configuration = await getClientActionConfiguration({ organisationId });
  const template = message.templateName
    ? findConfiguredTemplate({
        configuration,
        channel: message.channel,
        templateKey: message.templateName,
      }) ||
      Object.values(configuration.templates).find(
        item =>
          item.channel === message.channel &&
          item.templateName.toLowerCase() === message.templateName!.toLowerCase()
      )
    : undefined;
  return resolveConfiguredSender({
    configuration,
    channel: message.channel,
    template,
  });
}

/**
 * SMS and WhatsApp execute only through the exact commissioned CRM capability.
 * Sales email has a different execution owner: it must use the salesperson's
 * personally connected delegated Microsoft mailbox and is deliberately rejected
 * here so an old/incorrect CRM route can never silently send it.
 */
export async function sendSalesMessage(input: {
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  message: SalesMessage;
  correlationId: string;
}): Promise<AdapterEvidence> {
  if (input.message.channel === "email")
    throw new Error(
      "EMAIL_EXECUTION_OWNER_INVALID: salesperson email must execute through the user's delegated Microsoft mailbox."
    );
  const senderIdentity = await resolveExecutionSender(
    input.connection.organisationId,
    input.message
  );
  const message = validateSalesMessage({
    ...input.message,
    senderIdentity,
    idempotencyKey: input.message.idempotencyKey || stableOutboundKey(input.message),
  });
  await assertNotSuppressed(input.connection.organisationId, message);

  const native =
    message.channel === "sms" ? input.adapter.sendSms : input.adapter.sendWhatsApp;

  if (!native)
    throw new Error(
      `CRM_ACTION_NOT_AVAILABLE: the connected CRM has no verified '${message.channel}' send function. Configure or Teach Amarktai that CRM function instead of adding a separate messaging gateway.`
    );

  return native({
    connection: input.connection,
    secret: input.secret,
    to: message.to,
    subject: message.subject,
    body: message.body,
    contactExternalId: message.contactExternalId,
    opportunityExternalId: message.opportunityExternalId,
    templateName: message.templateName,
    senderIdentity: message.senderIdentity,
    idempotencyKey: message.idempotencyKey,
    correlationId: input.correlationId,
  });
}

export function getSalesCommunicationsReadiness() {
  return {
    emailMode: "personal_microsoft_delegated" as const,
    crmMessagingMode: "crm_native_per_connection" as const,
    deploymentMessagingGatewayRequired: false,
    detail:
      "Sales email executes through each salesperson's delegated Microsoft mailbox. SMS and WhatsApp remain exact capability truth on each connected CRM, including the commissioned sender identity and a stable outbound idempotency key.",
  };
}
