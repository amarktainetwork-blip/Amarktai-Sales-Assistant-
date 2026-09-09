from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return updated


path = Path("server/crm/automaticCommissioning.ts")
text = path.read_text()

text = replace_once(
    text,
    'import { accountBrowserCapabilities } from "./capabilityAccounting";',
    'import { accountBrowserCapabilities } from "./capabilityAccounting";\nimport { coreBrowserCommissioningReady } from "./commissioningReadiness";\nexport { coreBrowserCommissioningReady };',
    "canonical readiness import",
)

text = regex_once(
    text,
    r'const AUTOMATIC_CORE_BROWSER_OPERATIONS = \[.*?\n\}\n\nexport const COMMISSIONING_STATES',
    'export const COMMISSIONING_STATES',
    "remove duplicate readiness",
)

text = replace_once(
    text,
    '''export function operationEligibleForCommissioningTest(input: {
  status: string;
  definitionMode: unknown;
  requestedMode: BrowserOperationMode;
}) {
  if (input.definitionMode !== input.requestedMode) return false;
  return input.requestedMode === "read"
    ? ["TEST_READY", "LIVE_PROVEN"].includes(input.status)
    : input.status === "TEST_READY";
}
''',
    '''export function operationEligibleForCommissioningTest(input: {
  status: string;
  definitionMode: unknown;
  requestedMode: BrowserOperationMode;
}) {
  if (input.definitionMode !== input.requestedMode) return false;
  return input.requestedMode === "read"
    ? ["TEST_READY", "LIVE_PROVEN", "DEGRADED", "BLOCKED"].includes(
        input.status
      )
    : input.status === "TEST_READY";
}

export function isTransientBrowserControlError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return /CRM_VIEWER_(?:HUMAN|AGENT)_CONTROL_ACTIVE/.test(detail);
}
''',
    "retryable reads",
)

text = replace_once(
    text,
    'const activeJobs = new Set<number>();\n\n',
    '',
    "remove process local job lock",
)

text = regex_once(
    text,
    r'function scheduleAutomaticCommissioning\(jobId: number\) \{.*?\n\}\n\nexport async function startAutomaticCommissioning',
    '''function scheduleAutomaticCommissioning(jobId: number) {
  // The database lease is the only commissioning ownership source of truth.
  // Competing schedulers are safe because advanceAutomaticCommissioning
  // atomically claims an expired/null lease before any browser work begins.
  setImmediate(() => {
    void advanceAutomaticCommissioning(jobId).catch(error =>
      console.error("[crm-commissioning] background step failed", {
        jobId,
        detail: error instanceof Error ? error.message : String(error),
      })
    );
  });
}

export async function startAutomaticCommissioning''',
    "database lease scheduler",
)

text = replace_once(
    text,
    '  const failedOperationKeys: string[] = [];\n  let repairGenxCalls = 0;',
    '  const failedOperationKeys: string[] = [];\n  let transientControlBlocked = false;\n  let repairGenxCalls = 0;',
    "transient control flag",
)

text = replace_once(
    text,
    '''    } catch (error) {
      failedOperationKeys.push(operation.operationKey);
      failures[operation.operationKey] = safeText(
        error instanceof Error ? error.message : String(error),
        500
      );
    }
''',
    '''    } catch (error) {
      const detail = safeText(
        error instanceof Error ? error.message : String(error),
        500
      );
      failures[operation.operationKey] = detail;
      if (isTransientBrowserControlError(error)) {
        transientControlBlocked = true;
      } else {
        failedOperationKeys.push(operation.operationKey);
      }
    }
''',
    "control collisions are not selector drift",
)

text = replace_once(
    text,
    '    repairGenxCalls,\n    modelUsedDuringVerification: false as const,',
    '    repairGenxCalls,\n    transientControlBlocked,\n    modelUsedDuringVerification: false as const,',
    "return transient control flag",
)

text = replace_once(
    text,
    '      if (!safeReadCommissioningPassed(result))',
    '''      if (result.transientControlBlocked) {
        await updateJob(job.id, {
          status: "queued",
          optionalFailures: result.failures,
          leaseExpiresAt: new Date(Date.now() + 15_000),
          lastError: null,
          progress: {
            ...progress,
            humanStatus: "Waiting for secure CRM control",
            browserControl: "retrying",
          },
        });
        return;
      }
      if (!safeReadCommissioningPassed(result))''',
    "queue control retry",
)

text = replace_once(
    text,
    '''      const hasWrites = matrix.operations.some(
        operation =>
          operation.mode === "write" && operation.status === "TEST_READY"
      );''',
    '''      const hasWrites =
        system.allowedWriteCapabilities.length > 0 &&
        matrix.operations.some(
          operation =>
            operation.mode === "write" && operation.status === "TEST_READY"
        );''',
    "authorised writes only",
)

text = replace_once(
    text,
    '''        genieDiscoveryTargets = knownPack.needsDiscovery;
        progress.placeholderOperationsRejected = knownPack.needsDiscovery;''',
    '''        const authorisedReadTargets = BROWSER_OPERATION_CATALOGUE.filter(
          operation =>
            operation.mode === "read" &&
            (!operation.capability ||
              system.allowedReadCapabilities.includes(operation.capability))
        ).map(operation => operation.key);
        genieDiscoveryTargets = Array.from(
          new Set([
            ...knownPack.needsDiscovery,
            ...authorisedReadTargets.filter(
              operationKey => !knownPack.installed.includes(operationKey)
            ),
          ])
        );
        progress.placeholderOperationsRejected = knownPack.needsDiscovery;''',
    "authorised read discovery",
)

text = replace_once(
    text,
    '''        initialSyncReady = true;
        progress.initialSync = initialSync;''',
    '''        if (
          initialSync.modelUsed !== false ||
          Number(initialSync.providerCallCount || 0) !== 0
        )
          throw new Error(
            "CRM_INITIAL_SYNC_MODEL_BOUNDARY_VIOLATION: routine CRM sync must remain model-free."
          );
        initialSyncReady = true;
        progress.initialSync = initialSync;''',
    "model-free sync proof",
)

text = replace_once(
    text,
    '''    const detail = safeText(
      error instanceof Error ? error.message : String(error),
      2_000
    );
    await updateJob(job.id, {
      status: "needs_attention",''',
    '''    const detail = safeText(
      error instanceof Error ? error.message : String(error),
      2_000
    );
    if (isTransientBrowserControlError(error)) {
      await updateJob(job.id, {
        status: "queued",
        lastError: null,
        leaseExpiresAt: new Date(Date.now() + 15_000),
        progress: {
          ...(job.progress || {}),
          humanStatus: "Waiting for secure CRM control",
          browserControl: "retrying",
        },
      });
      return;
    }
    await updateJob(job.id, {
      status: "needs_attention",''',
    "outer control recovery",
)

path.write_text(text)

sync_path = Path("server/crm/sync.ts")
sync = sync_path.read_text()
sync = replace_once(
    sync,
    '''  const resources = [
    ["companies", adapter.syncCompanies, upsertCompanies],
    ["contacts", adapter.syncContacts, upsertContacts],
    ["opportunities", adapter.syncOpportunities, upsertOpportunities],
    ["tasks", adapter.syncTasks, upsertTasks],
    ["activities", adapter.syncActivities, upsertActivities],
  ] as const;
  for (const [resourceType, sync, persist] of resources) {''',
    '''  const resources = [
    ["companies", "companies.read", adapter.syncCompanies, upsertCompanies],
    ["contacts", "contacts.read", adapter.syncContacts, upsertContacts],
    [
      "opportunities",
      "opportunities.read",
      adapter.syncOpportunities,
      upsertOpportunities,
    ],
    ["tasks", "tasks.read", adapter.syncTasks, upsertTasks],
    ["activities", "activities.read", adapter.syncActivities, upsertActivities],
  ] as const;
  for (const [resourceType, capability, sync, persist] of resources) {
    if (!connection.allowedReadCapabilities.includes(capability)) {
      summary[resourceType] = 0;
      continue;
    }''',
    "authorised sync resources",
)
sync_path.write_text(sync)

test_path = Path("server/crm/automaticCommissioning.test.ts")
test = test_path.read_text()
test = replace_once(
    test,
    '  inferBrowserOperationCandidates,\n  nextCommissioningState,',
    '  inferBrowserOperationCandidates,\n  isTransientBrowserControlError,\n  nextCommissioningState,',
    "test transient import",
)
test = replace_once(
    test,
    '''    expect(
      operationEligibleForCommissioningTest({
        status: "LIVE_PROVEN",
        definitionMode: "write",
        requestedMode: "write",
      })
    ).toBe(false);''',
    '''    expect(
      operationEligibleForCommissioningTest({
        status: "LIVE_PROVEN",
        definitionMode: "write",
        requestedMode: "write",
      })
    ).toBe(false);
    for (const status of ["BLOCKED", "DEGRADED"])
      expect(
        operationEligibleForCommissioningTest({
          status,
          definitionMode: "read",
          requestedMode: "read",
        })
      ).toBe(true);
    expect(
      isTransientBrowserControlError(
        new Error("CRM_VIEWER_HUMAN_CONTROL_ACTIVE: viewer owns the page")
      )
    ).toBe(true);
    expect(isTransientBrowserControlError(new Error("selector drift"))).toBe(
      false
    );''',
    "retry test",
)
test = replace_once(
    test,
    '''  it("keeps an optional failure from blocking the proven core selling loop", () => {
    const statuses = new Map([
      ["contact.search", "LIVE_PROVEN"],
      ["contact.read", "LIVE_PROVEN"],
      ["task.list", "LIVE_PROVEN"],
      ["note.create", "LIVE_PROVEN"],
      ["task.create_callback", "LIVE_PROVEN"],
      ["opportunity.read", "LIVE_PROVEN"],
      ["opportunity.update", "LIVE_PROVEN"],
      ["whatsapp.send", "DEGRADED"],
    ]);
    expect(coreBrowserCommissioningReady(statuses)).toBe(true);
  });''',
    '''  it("requires only the proven safe contact read loop for read-only onboarding", () => {
    const statuses = new Map([
      ["contact.search", "LIVE_PROVEN"],
      ["contact.read", "LIVE_PROVEN"],
      ["contact.sync", "LIVE_PROVEN"],
      ["note.create", "NOT_LEARNED"],
      ["opportunity.update", "NOT_LEARNED"],
    ]);
    expect(coreBrowserCommissioningReady(statuses)).toBe(true);
  });''',
    "core readiness test",
)
test_path.write_text(test)
