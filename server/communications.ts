import { sendEmail as sendSmtpEmail } from "./smtp";
import type { AdapterConnection, AdapterEvidence, ConnectionSecretPayload, CrmAdapter } from "./crm/types";

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

function webhookConfig(channel: Exclude<SalesChannel, "email">) {
  const prefix = channel === "sms" ? "SMS" : "WHATSAPP";
  const url = process.env[`${prefix}_WEBHOOK_URL`]?.trim();
  const token = process.env[`${prefix}_WEBHOOK_TOKEN`]?.trim();
  return { url, token };
}

function assertDestination(channel: SalesChannel, destination: string) {
  const value = destination.trim();
  if (!value) throw new Error(`A ${channel} destination is required.`);
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("The outbound email address is invalid.");
  if (channel !== "email" && !/^\+?[0-9][0-9 ()-]{5,30}$/.test(value)) throw new Error(`The outbound ${channel} number is invalid.`);
  return value;
}

async function webhookSend(channel: Exclude<SalesChannel, "email">, message: SalesMessage, correlationId: string) {
  const config = webhookConfig(channel);
  if (!config.url) throw new Error(`${channel.toUpperCase()} delivery is not configured. Set ${channel === "sms" ? "SMS" : "WHATSAPP"}_WEBHOOK_URL or configure a CRM-native channel action.`);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": correlationId };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(config.url, { method: "POST", headers, body: JSON.stringify({ to: assertDestination(channel, message.to), body: message.body, templateName: message.templateName, contactExternalId: message.contactExternalId, opportunityExternalId: message.opportunityExternalId, correlationId }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${channel.toUpperCase()} provider ${response.status}: ${text.slice(0, 600)}`);
  let providerResult: unknown = text;
  try { providerResult = text ? JSON.parse(text) : {}; } catch { /* retain text */ }
  return { delivered: true, provider: "webhook", result: providerResult };
}

async function recordCommunication(adapter: CrmAdapter, connection: AdapterConnection, secret: ConnectionSecretPayload, message: SalesMessage, correlationId: string) {
  try {
    const evidence = await adapter.createActivity({ connection, secret, correlationId: `${correlationId}:log`, activity: {
      subject: `${message.channel.toUpperCase()} sent by Amarktai`,
      title: `${message.channel.toUpperCase()} sent by Amarktai`,
      body: message.body,
      description: message.body,
      channel: message.channel,
      contactExternalId: message.contactExternalId,
      opportunityExternalId: message.opportunityExternalId,
      occurredAt: new Date().toISOString(),
      status: "Completed",
    } });
    return { logged: true, evidence };
  } catch (error) {
    return { logged: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Send through a CRM-native channel when the adapter provides one. Otherwise
 * use Amarktai's configured SMTP/generic messaging gateway and then log the
 * completed communication back to the CRM. A successful external send is not
 * retried merely because CRM logging failed, preventing duplicate messages.
 */
export async function sendSalesMessage(input: {
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  message: SalesMessage;
  correlationId: string;
}): Promise<AdapterEvidence> {
  const to = assertDestination(input.message.channel, input.message.to);
  const message = { ...input.message, to };
  const native = message.channel === "email" ? input.adapter.sendEmail : message.channel === "sms" ? input.adapter.sendSms : input.adapter.sendWhatsApp;
  if (native) return native({ connection: input.connection, secret: input.secret, to, subject: message.subject, body: message.body, contactExternalId: message.contactExternalId, opportunityExternalId: message.opportunityExternalId, templateName: message.templateName, correlationId: input.correlationId });

  let delivery: Record<string, unknown>;
  if (message.channel === "email") {
    if (!message.subject?.trim()) throw new Error("Outbound sales email requires a subject.");
    await sendSmtpEmail({ to, subject: message.subject.trim(), text: message.body, html: `<main style="font-family:Arial,sans-serif;white-space:pre-wrap">${message.body.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] || c)}</main>` });
    delivery = { delivered: true, provider: "smtp" };
  } else {
    delivery = await webhookSend(message.channel, message, input.correlationId) as unknown as Record<string, unknown>;
  }
  const crmLog = await recordCommunication(input.adapter, input.connection, input.secret, message, input.correlationId);
  return { operation: `send_${message.channel}`, correlationId: input.correlationId, completedAt: new Date().toISOString(), providerResult: { delivery, crmLog } };
}

export function getSalesCommunicationsReadiness() {
  return {
    email: Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM),
    sms: Boolean(process.env.SMS_WEBHOOK_URL),
    whatsapp: Boolean(process.env.WHATSAPP_WEBHOOK_URL),
  };
}
