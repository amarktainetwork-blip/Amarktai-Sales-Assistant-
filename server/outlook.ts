export type EmailPreviewInput = { to: string; subject: string; body: string; templateName?: string };

export function getOutlookReadiness() {
  const tenantConfigured = Boolean(process.env.OUTLOOK_TENANT_ID);
  const clientConfigured = Boolean(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET);
  const senderConfigured = Boolean(process.env.OUTLOOK_SENDER_EMAIL);
  return { ready: tenantConfigured && clientConfigured && senderConfigured, tenantConfigured, clientConfigured, senderConfigured, requiredVariables: ["OUTLOOK_TENANT_ID", "OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_SENDER_EMAIL"] };
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
