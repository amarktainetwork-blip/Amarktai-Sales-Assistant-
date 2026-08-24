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
type CrmSystem = { provider: string; status: string };

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

export function onboardingSellingReadiness(input: {
  profileSaved: boolean;
  knowledgeConfirmed: boolean;
  readyNativeCrmCount: number;
  browserSystem?: CrmSystem;
  browserOperations?: BrowserOperation[];
}) {
  const browserConnectionVerified = input.browserSystem
    ? ["ready", "limited_permissions"].includes(input.browserSystem.status)
    : undefined;
  const crmVerified = input.browserSystem
    ? Boolean(browserConnectionVerified)
    : input.readyNativeCrmCount > 0;
  const coreGenieReady = input.browserSystem
    ? CORE_GENIE_TASKS.every(key =>
        browserOperationIsAvailable(input.browserOperations, key)
      )
    : true;

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
