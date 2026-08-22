export type EmailPreviewInput = { to: string; subject: string; body: string; templateName?: string };
export type CalendarEventInput = { subject: string; body: string; startIso: string; endIso: string; attendees: string[]; timezone?: string; reviewReference: string };

export function getOutlookReadiness() {
  const tenantConfigured = Boolean(process.env.OUTLOOK_TENANT_ID);
  const clientConfigured = Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET);
  const senderConfigured = Boolean(process.env.OUTLOOK_SENDER_EMAIL);
  const configured = tenantConfigured && clientConfigured && senderConfigured;
  return { ready: configured, providerState: configured ? "INSTALLATION_CREDENTIALS_PRESENT_UNVERIFIED" : "NOT_CONFIGURED", tenantConfigured, clientConfigured, senderConfigured, requiredVariables: ["OUTLOOK_TENANT_ID", "OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_SENDER_EMAIL"] };
}

export function validateEmailPreview(input: EmailPreviewInput) {
  const issues: string[] = [];
  if (!input.to.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) issues.push("A valid recipient email is required.");
  if (!input.subject.trim()) issues.push("A subject line is required; saved-template emails may never be sent blank.");
  if (!input.body.trim()) issues.push("Email content is required.");
  if (!input.templateName?.trim()) issues.push("The approved saved template name must be recorded before sending.");
  return { valid: issues.length === 0, issues };
}

export async function createOutlookApplicationToken() {
  const readiness = getOutlookReadiness();
  if (!readiness.ready) throw new Error("Outlook is not fully configured. Add the tenant ID, client ID, client secret, and approved sender email at deployment.");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.OUTLOOK_CLIENT_ID!, client_secret: process.env.OUTLOOK_CLIENT_SECRET!, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }) });
  if (!response.ok) throw new Error(`Microsoft identity token request failed with ${response.status}.`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Microsoft identity response did not include an access token.");
  return payload.access_token;
}

function graphSenderEndpoint(path: string) {
  const sender = process.env.OUTLOOK_SENDER_EMAIL;
  if (!sender) throw new Error("Outlook sender email is not configured.");
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}${path}`;
}

async function graphPost(path: string, body: Record<string, unknown>) {
  const token = await createOutlookApplicationToken();
  const response = await fetch(graphSenderEndpoint(path), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Microsoft Graph request failed with ${response.status}.`);
  if (response.status === 202 || response.status === 204) return null;
  return response.json().catch(() => null);
}

/** Invoke only after the application’s review/action boundary has approved a communication. */
export async function sendOutlookMail(input: EmailPreviewInput & { reviewReference: string }) {
  const preview = validateEmailPreview(input);
  if (!preview.valid) throw new Error(preview.issues.join(" "));
  if (!input.reviewReference.trim()) throw new Error("An approved review reference is required before sending email.");
  await graphPost("/sendMail", { message: { subject: input.subject.trim(), body: { contentType: "HTML", content: input.body }, toRecipients: [{ emailAddress: { address: input.to.trim() } }], internetMessageHeaders: [{ name: "X-Amarktai-Review-Reference", value: input.reviewReference.trim().slice(0, 180) }] }, saveToSentItems: true });
  return { sent: true as const };
}

/** Invoke only after the application’s review/action boundary has approved a calendar operation. */
export async function createOutlookCalendarEvent(input: CalendarEventInput) {
  if (!input.reviewReference.trim()) throw new Error("An approved review reference is required before creating a calendar event.");
  const start = new Date(input.startIso); const end = new Date(input.endIso);
  if (!input.subject.trim() || !input.body.trim() || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("A subject, body, and valid start/end time are required for a calendar event.");
  const attendees = input.attendees.map(email => email.trim()).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!attendees.length) throw new Error("At least one valid attendee email is required.");
  const timezone = input.timezone?.trim() || "UTC";
  const result = await graphPost("/events", { subject: input.subject.trim(), body: { contentType: "HTML", content: input.body }, start: { dateTime: start.toISOString().replace("Z", ""), timeZone: timezone }, end: { dateTime: end.toISOString().replace("Z", ""), timeZone: timezone }, attendees: attendees.map(address => ({ emailAddress: { address }, type: "required" })), transactionId: input.reviewReference.trim().slice(0, 180) });
  return { created: true as const, eventId: typeof result === "object" && result && "id" in result && typeof result.id === "string" ? result.id : undefined };
}
