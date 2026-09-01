import { delegatedMailboxReadiness } from "./delegatedMailbox";

export type EmailPreviewInput = {
  to: string;
  subject: string;
  body: string;
  templateName?: string;
};
export type CalendarEventInput = {
  subject: string;
  body: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  timezone?: string;
  reviewReference: string;
};

const LEGACY_OUTLOOK_DISABLED =
  "Legacy application-level Outlook execution is disabled. Use the salesperson's per-user delegated Microsoft connection.";

/**
 * Backwards-compatible deployment readiness name for older dashboards.
 * This no longer checks or enables an organisation-wide sender mailbox.
 */
export function getOutlookReadiness() {
  const delegated = delegatedMailboxReadiness();
  return {
    ready: delegated.ready,
    providerState: delegated.ready
      ? "DELEGATED_OAUTH_AVAILABLE"
      : "NOT_CONFIGURED",
    tenantConfigured: Boolean(delegated.tenantId),
    clientConfigured: Boolean(delegated.clientId && delegated.clientSecret),
    senderConfigured: false,
    delegated: true,
    requiredVariables: [
      "OUTLOOK_DELEGATED_TENANT_ID",
      "OUTLOOK_DELEGATED_CLIENT_ID",
      "OUTLOOK_DELEGATED_CLIENT_SECRET",
      "OUTLOOK_DELEGATED_REDIRECT_URI or PUBLIC_APP_URL",
    ],
  };
}

export function validateEmailPreview(input: EmailPreviewInput) {
  const issues: string[] = [];
  if (!input.to.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to))
    issues.push("A valid recipient email is required.");
  if (!input.subject.trim())
    issues.push(
      "A subject line is required; saved-template emails may never be sent blank."
    );
  if (!input.body.trim()) issues.push("Email content is required.");
  if (!input.templateName?.trim())
    issues.push(
      "The approved saved template name must be recorded before sending."
    );
  return { valid: issues.length === 0, issues };
}

/** @deprecated Shared application credentials are deliberately disabled. */
export async function createOutlookApplicationToken(): Promise<never> {
  throw new Error(LEGACY_OUTLOOK_DISABLED);
}

/** @deprecated Inbound mail is read through each user's delegated mailbox sync. */
export async function readOutlookInboundMessage(_messageId: string): Promise<never> {
  throw new Error(LEGACY_OUTLOOK_DISABLED);
}

/** @deprecated Approved email is sent through sendDelegatedOutlookMail(). */
export async function sendOutlookMail(
  input: EmailPreviewInput & { reviewReference: string }
): Promise<never> {
  const preview = validateEmailPreview(input);
  if (!preview.valid) throw new Error(preview.issues.join(" "));
  if (!input.reviewReference.trim())
    throw new Error(
      "An approved review reference is required before sending email."
    );
  throw new Error(LEGACY_OUTLOOK_DISABLED);
}

/** @deprecated Approved invites use createDelegatedOutlookCalendarEvent(). */
export async function createOutlookCalendarEvent(
  input: CalendarEventInput
): Promise<never> {
  if (!input.reviewReference.trim())
    throw new Error(
      "An approved review reference is required before creating a calendar event."
    );
  throw new Error(LEGACY_OUTLOOK_DISABLED);
}
