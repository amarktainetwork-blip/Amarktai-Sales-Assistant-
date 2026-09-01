import { delegatedMailboxReadiness } from "./delegatedMailbox";

export type PersonalMailboxEmailPreview = {
  to: string;
  subject: string;
  body: string;
  templateName?: string;
};

/** Safe deployment-level availability. A user is connected only after OAuth consent. */
export function getPersonalMailboxReadiness() {
  const microsoft = delegatedMailboxReadiness();
  return {
    ready: microsoft.ready,
    provider: "microsoft" as const,
    connectionModel: "per_user_delegated_oauth" as const,
    requiresUserConsent: true,
    requiredVariables: [
      "OUTLOOK_DELEGATED_TENANT_ID",
      "OUTLOOK_DELEGATED_CLIENT_ID",
      "OUTLOOK_DELEGATED_CLIENT_SECRET",
      "OUTLOOK_DELEGATED_REDIRECT_URI or APP_PUBLIC_URL",
    ],
  };
}

export function validatePersonalMailboxEmailPreview(
  input: PersonalMailboxEmailPreview
) {
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
