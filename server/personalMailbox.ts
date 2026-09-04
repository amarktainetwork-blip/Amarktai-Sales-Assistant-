import { personalMailboxProviderAvailability } from "./personalMailboxRuntime";

export type PersonalMailboxEmailPreview = {
  to: string;
  subject: string;
  body: string;
  templateName?: string;
};

/** Deployment-level connection paths only. User connection truth comes from getPersonalMailboxStatus(). */
export function getPersonalMailboxReadiness() {
  const providers = personalMailboxProviderAvailability();
  return {
    ready: providers.some(provider => provider.configured),
    providers,
    requiresUserConsent: true,
    connectionModels: Array.from(
      new Set(providers.map(provider => provider.connectionModel))
    ),
    requiredVariables: {
      microsoft: [
        "OUTLOOK_DELEGATED_TENANT_ID",
        "OUTLOOK_DELEGATED_CLIENT_ID",
        "OUTLOOK_DELEGATED_CLIENT_SECRET",
        "OUTLOOK_DELEGATED_REDIRECT_URI or APP_PUBLIC_URL",
      ],
      google: [
        "GOOGLE_MAILBOX_CLIENT_ID",
        "GOOGLE_MAILBOX_CLIENT_SECRET",
        "GOOGLE_MAILBOX_REDIRECT_URI or APP_PUBLIC_URL",
      ],
      smtp: ["configured by each salesperson and verified before storage"],
    },
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
