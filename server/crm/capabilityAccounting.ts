import {
  BROWSER_CAPABILITY_REQUIREMENTS,
  BROWSER_OPERATION_CATALOGUE,
} from "../browserConnectors/operationContracts";
import { CORE_BROWSER_OPERATIONS } from "./commissioningReadiness";

export const REQUIRED_COMMISSIONED_OPERATIONS = Array.from(
  new Set([
    ...CORE_BROWSER_OPERATIONS,
    ...[
      "companies.read",
      "opportunities.read",
      "tasks.read",
      "activities.read",
      "notes.read",
      "owners.read",
      "pipelines.read",
    ].flatMap(capability => BROWSER_CAPABILITY_REQUIREMENTS[capability] ?? []),
  ])
);

export const CAPABILITY_ACCOUNTING_STATUSES = [
  "DISCOVERED",
  "LIVE_PROVEN",
  "NEEDS_SAFE_TEST",
  "NEEDS_REPAIR",
  "UNSUPPORTED",
  "NOT_AUTHORISED",
  "NOT_AVAILABLE_TO_ROLE",
] as const;
export type CapabilityAccountingStatus =
  (typeof CAPABILITY_ACCOUNTING_STATUSES)[number];

export function accountBrowserCapabilities(input: {
  operationStatuses: ReadonlyMap<string, string>;
  discoveredOperationKeys: readonly string[];
  allowedReadCapabilities: readonly string[];
  allowedWriteCapabilities: readonly string[];
}) {
  const discovered = new Set(input.discoveredOperationKeys);
  const standardKeys = new Set(
    BROWSER_OPERATION_CATALOGUE.map(operation => operation.key)
  );
  const operations = [
    ...BROWSER_OPERATION_CATALOGUE,
    ...Array.from(
      new Set([
        ...input.discoveredOperationKeys,
        ...Array.from(input.operationStatuses.keys()),
      ])
    )
      .filter(operationKey => !standardKeys.has(operationKey))
      .map(operationKey => ({
        key: operationKey,
        capability: undefined,
        mode: operationKey.startsWith("custom.write.")
          ? ("write" as const)
          : ("read" as const),
      })),
  ];

  const rows = operations.map(operation => {
    const learned = input.operationStatuses.get(operation.key);
    const allowed = operation.capability
      ? (operation.mode === "read"
          ? input.allowedReadCapabilities
          : input.allowedWriteCapabilities
        ).includes(operation.capability)
      : true;
    let status: CapabilityAccountingStatus;
    if (!allowed) status = "NOT_AUTHORISED";
    else if (learned === "LIVE_PROVEN") status = "LIVE_PROVEN";
    else if (["DEGRADED", "BLOCKED"].includes(learned || ""))
      status = "NEEDS_REPAIR";
    else if (learned === "TEST_READY") status = "NEEDS_SAFE_TEST";
    else if (learned || discovered.has(operation.key)) status = "DISCOVERED";
    else status = "UNSUPPORTED";
    return {
      operationKey: operation.key,
      capability: operation.capability || null,
      mode: operation.mode,
      status,
      reason:
        status === "UNSUPPORTED"
          ? "No deterministic operation definition was discovered for this CRM and role."
          : status === "NOT_AUTHORISED"
            ? "The connected system did not grant this capability."
            : null,
    };
  });

  const requiredReadOperations = new Set<string>(
    input.allowedReadCapabilities.flatMap(
      capability => BROWSER_CAPABILITY_REQUIREMENTS[capability] ?? []
    )
  );
  const criticalGaps = rows
    .filter(row => {
      if (row.mode !== "read" || row.status === "LIVE_PROVEN") return false;
      if (row.status === "NOT_AUTHORISED") return false;

      const required = requiredReadOperations.has(row.operationKey);
      const discoveredCustom =
        !standardKeys.has(row.operationKey) && discovered.has(row.operationKey);

      // Every requested read capability must have its production operation
      // LIVE_PROVEN before onboarding can finish. Custom discovered reads remain
      // blocking as well because they were explicitly learned for this CRM.
      return required || discoveredCustom;
    })
    .map(row => ({ operationKey: row.operationKey, status: row.status }));

  return { rows, criticalGaps, complete: criticalGaps.length === 0 };
}
