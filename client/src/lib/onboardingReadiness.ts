export const CORE_GENIE_TASKS = [
  "contact.search",
  "contact.read",
  "task.list",
  "note.create",
  "task.create_callback",
  "opportunity.read",
  "opportunity.update",
] as const;

type BrowserOperation = { key: string; status: string };
type CrmSystem = {
  provider: string;
  status: string;
  verifiedCapabilities?: string[];
};

export const CRM_CAPABILITY_PRESENTATION = [
  { label: "Contacts", keys: ["contact.search", "contact.read"], core: true },
  { label: "Customer details", keys: ["contact.read"], core: true },
  { label: "Companies", keys: ["company.read"], core: false },
  { label: "Tasks", keys: ["task.list"], core: true },
  { label: "Notes", keys: ["note.create"], core: true },
  { label: "Callbacks", keys: ["task.create_callback"], core: true },
  { label: "Opportunities", keys: ["opportunity.read", "opportunity.update"], core: true },
  { label: "Email", keys: ["email.send"], core: false },
  { label: "SMS", keys: ["sms.send"], core: false },
  { label: "WhatsApp", keys: ["whatsapp.send"], core: false },
  { label: "Calling", keys: ["dialler.launch"], core: false },
  { label: "Appointments", keys: ["appointment.book"], core: false },
  { label: "Quotes", keys: ["quote.create"], core: false },
] as const;

const NATIVE_CORE_CAPABILITY_GROUPS = [
  ["contacts.read"],
  ["tasks.read"],
  ["tasks.write"],
  ["notes.write", "activities.write"],
  ["opportunities.read"],
] as const;

export function browserOperationIsAvailable(
  operations: BrowserOperation[] | undefined,
  key: string
) {
  return Boolean(
    operations?.some(
      operation => operation.key === key && operation.status === "LIVE_PROVEN"
    )
  );
}

export type HumanCapabilityStatus =
  | "Checking"
  | "Ready"
  | "Needs setup"
  | "Unavailable"
  | "Failed";

export function humanBrowserCapabilityStatus(
  operations: BrowserOperation[] | undefined,
  keys: readonly string[]
): HumanCapabilityStatus {
  if (!operations) return "Checking";
  const selected = keys
    .map(key => operations.find(operation => operation.key === key))
    .filter((operation): operation is BrowserOperation => Boolean(operation));
  if (!selected.length) return "Unavailable";
  if (selected.some(operation => ["BLOCKED", "DEGRADED"].includes(operation.status)))
    return "Failed";
  if (selected.every(operation => operation.status === "LIVE_PROVEN"))
    return "Ready";
  return "Needs setup";
}

const friendlyOperationNames: Record<string, string> = {
  "email.send": "Email",
  "sms.send": "SMS",
  "whatsapp.send": "WhatsApp",
  "dialler.launch": "Calling",
  "appointment.book": "Appointments",
  "quote.create": "Quotes",
};

export function humanizeCrmFailure(detail: string) {
  if (detail.includes("GENIE_LOGIN_FORM_NOT_READY"))
    return "Genie opened, but its sign-in form was still loading. Retry setup once; Amarktai will wait for the form before signing in.";
  if (detail.includes("GENIE_LOGIN_CALIBRATION_REQUIRED"))
    return "We reached your CRM but couldn't confidently identify its sign-in form.";
  if (detail.includes("GENIE_CREDENTIALS_REQUIRED"))
    return "Your secure CRM sign-in details are missing. Add them and try again.";
  if (detail.includes("GENIE_AUTH_HOST_APPROVAL_REQUIRED"))
    return "Your CRM uses another secure sign-in service. A workspace manager needs to approve it.";
  if (detail.includes("GENIE_AUTH_REDIRECT_PRIVATE_BLOCKED"))
    return "The CRM attempted to use an unsafe private-network sign-in destination, so setup was stopped.";
  if (detail.includes("GENIE_INTERACTIVE_AUTH_REQUIRED"))
    return "Your CRM requires an approved interactive sign-in step before setup can continue.";
  if (detail.includes("GENIE_AUTHENTICATION_FAILED"))
    return "The CRM did not accept the saved sign-in details. Check them and try again.";
  if (detail.includes("OPERATION_NOT_")) {
    const operation = Object.keys(friendlyOperationNames).find(key =>
      detail.includes(key)
    );
    return `${operation ? friendlyOperationNames[operation] : "This CRM function"} still needs to be tested.`;
  }
  return "Amarktai couldn't finish checking this CRM. No unverified function was enabled.";
}

export function nativeCoreReady(system: CrmSystem) {
  if (!["ready", "limited_permissions"].includes(system.status)) return false;
  const verified = new Set(system.verifiedCapabilities || []);
  return NATIVE_CORE_CAPABILITY_GROUPS.every(group =>
    group.some(capability => verified.has(capability))
  );
}

export function onboardingSellingReadiness(input: {
  profileSaved: boolean;
  knowledgeConfirmed: boolean;
  nativeSystems?: CrmSystem[];
  browserSystem?: CrmSystem;
  browserOperations?: BrowserOperation[];
}) {
  const browserConnectionVerified = input.browserSystem
    ? ["ready", "limited_permissions"].includes(input.browserSystem.status)
    : undefined;
  const nativeConnectionVerified = Boolean(
    input.nativeSystems?.some(system =>
      ["ready", "limited_permissions"].includes(system.status)
    )
  );
  const nativeSellingCoreReady = Boolean(
    input.nativeSystems?.some(nativeCoreReady)
  );
  const crmVerified = input.browserSystem
    ? Boolean(browserConnectionVerified)
    : nativeConnectionVerified;
  const coreGenieReady = input.browserSystem
    ? CORE_GENIE_TASKS.every(key =>
        browserOperationIsAvailable(input.browserOperations, key)
      )
    : nativeSellingCoreReady;

  return {
    crmVerified,
    coreGenieReady,
    canStartSelling:
      input.profileSaved &&
      input.knowledgeConfirmed &&
      crmVerified &&
      coreGenieReady,
  };
}