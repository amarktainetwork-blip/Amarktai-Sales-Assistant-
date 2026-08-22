import { sendEmail as sendSmtpEmail, getSmtpReadiness } from "./smtp";
import { getOutlookReadiness, sendOutlookMail } from "./outlook";
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": correlationId };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  try {
    const response = await fetch(config.url, { method: "POST", headers, signal: controller.signal, body: JSON.stringify({ to: assertDestination(channel, message.to), body: message.body, templateName: message.templateName, contactExternalId: message.contactExternalId, opportunityExternalId: message.opportunityExternalId, correlationId }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${channel.toUpperCase()} provider returned ${response.status}.`);
    let providerResult: unknown = text;
    try { providerResult = text ? JSON.parse(text) : {}; } catch { /* retain text */ }
    return { delivered: true, provider: "webhook", result: providerResult };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`${channel.toUpperCase()} delivery timed out.`);
    throw error;
  } finally { clearTimeout(timer); }
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

function emailProvider() {
  const requested = process.env.OUTBOUND_EMAIL_PROVIDER?.trim().toLowerCase() || "auto";
  if (!["auto", "outlook", "smtp"].includes(requested)) throw new Error("OUTBOUND_EMAIL_PROVIDER must be auto, outlook, or smtp.");
  if (requested === "outlook") {
    if (!getOutlookReadiness().ready) throw new Error("Outlook is selected for outbound sales email but Microsoft Graph is not configured.");
    return "outlook" as const;
  }
  if (requested === "smtp") {
    if (!getSmtpReadiness().ready) throw new Error("SMTP is selected for outbound sales email but SMTP is not configured.");
    return "smtp" as const;
  }
  return getOutlookReadiness().ready ? "outlook" as const : "smtp" as const;
}

/**
 * Send through a CRM-native channel when the adapter provides one. Otherwise
 * use the configured Microsoft 365/SMTP/generic messaging gateway and then log
 * the completed communication back to the CRM. A successful external send is
 * never retried merely because CRM logging failed, preventing duplicates.
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
    const provider = emailProvider();
    if (provider === "outlook") {
      await sendOutlookMail({ to, subject: message.subject.trim(), body: message.body, templateName: message.templateName?.trim() || "Amarktai approved sales email", reviewReference: input.correlationId });
      delivery = { delivered: true, provider: "outlook" };
    } else {
      await sendSmtpEmail({ to, subject: message.subject.trim(), text: message.body, html: `<main style="font-family:Arial,sans-serif;white-space:pre-wrap">${message.body.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] || c)}</main>` });
      delivery = { delivered: true, provider: "smtp" };
    }
  } else {
    delivery = await webhookSend(message.channel, message, input.correlationId) as unknown as Record<string, unknown>;
  }
  const crmLog = await recordCommunication(input.adapter, input.connection, input.secret, message, input.correlationId);
  return { operation: `send_${message.channel}`, correlationId: input.correlationId, completedAt: new Date().toISOString(), providerResult: { delivery, crmLog } };
}

export function getSalesCommunicationsReadiness() {
  const outlook = getOutlookReadiness().ready;
  const smtp = getSmtpReadiness().ready;
  return {
    email: outlook || smtp,
    emailProvider: outlook ? "outlook" : smtp ? "smtp" : "not_configured",
    sms: Boolean(process.env.SMS_WEBHOOK_URL),
    whatsapp: Boolean(process.env.WHATSAPP_WEBHOOK_URL),
  };
}
