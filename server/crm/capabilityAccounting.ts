import { BROWSER_OPERATION_CATALOGUE } from "../browserConnectors/operationContracts";
import { CORE_BROWSER_OPERATIONS } from "./commissioningReadiness";

export const REQUIRED_COMMISSIONED_OPERATIONS = [
  ...CORE_BROWSER_OPERATIONS,
  "contact.sync",
  "company.sync",
  "task.sync",
  "opportunity.sync",
  "activity.sync",
  "pipeline.list",
] as const;

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
  const criticalGaps = rows
    .filter(
      row =>
        ((REQUIRED_COMMISSIONED_OPERATIONS as readonly string[]).includes(
          row.operationKey
        ) ||
          (!standardKeys.has(row.operationKey) &&
            discovered.has(row.operationKey))) &&
        row.status !== "LIVE_PROVEN"
    )
    .map(row => ({ operationKey: row.operationKey, status: row.status }));
  return { rows, criticalGaps, complete: criticalGaps.length === 0 };
}
