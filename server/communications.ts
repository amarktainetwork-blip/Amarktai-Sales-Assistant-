import type {
  AdapterConnection,
  AdapterEvidence,
  ConnectionSecretPayload,
  CrmAdapter,
} from "./crm/types";
import { and, eq, or } from "drizzle-orm";
import { contactCommunicationSuppressions } from "../drizzle/schema";
import { getDb } from "./db";

export type SalesChannel = "email" | "sms" | "whatsapp";

export type SalesMessage = {
  channel: SalesChannel;
  to: string;
  subject?: string;
  body: string;
  templateName?: string;
  contactExternalId?: string;
  opportunityExternalId?: string;
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
  return { ...message, to, body, subject };
}

async function assertNotSuppressed(
  organisationId: number,
  message: SalesMessage,
  destination: string
) {
  const db = await getDb();
  if (!db)
    throw new Error(
      "Database connection is unavailable; outbound suppression cannot be verified."
    );
  const channel = message.channel === "whatsapp" ? "chat" : message.channel;
  const senderReference =
    message.channel === "email"
      ? destination.toLowerCase()
      : destination.replace(/[^0-9+]/g, "").replace(/^00/, "+");
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
          eq(contactCommunicationSuppressions.organisationId, organisationId),
          eq(contactCommunicationSuppressions.channel, channel),
          identity
        )
      )
      .limit(1)
  )[0];
  if (suppressed)
    throw new Error(
      "OUTBOUND_SUPPRESSED: this contact or destination has an active inbound opt-out."
    );
}

/**
 * Client-facing communication always executes through the connected CRM.
 * Amarktai does not maintain a second SMS, WhatsApp or sales-email transport.
 * A channel is usable only when that CRM adapter exposes the action and, for
 * browser CRMs, the connection-specific operation is LIVE_PROVEN.
 */
export async function sendSalesMessage(input: {
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  message: SalesMessage;
  correlationId: string;
}): Promise<AdapterEvidence> {
  const message = validateSalesMessage(input.message);
  await assertNotSuppressed(
    input.connection.organisationId,
    message,
    message.to
  );

  const native =
    message.channel === "email"
      ? input.adapter.sendEmail
      : message.channel === "sms"
        ? input.adapter.sendSms
        : input.adapter.sendWhatsApp;

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
    correlationId: input.correlationId,
  });
}

export function getSalesCommunicationsReadiness() {
  return {
    mode: "crm_native_per_connection" as const,
    deploymentMessagingGatewayRequired: false,
    detail:
      "Client email, SMS, WhatsApp and other communication actions are capability truth on each connected CRM, not deployment-level integrations.",
  };
}
