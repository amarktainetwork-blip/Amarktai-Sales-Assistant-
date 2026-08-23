import { markConnectionAuthenticationExpired } from "../connectedSystems";
import { recordBrowserOperationResult } from "./learnedOperations";

export type BrowserRuntimeFailureClassification =
  | "authentication"
  | "transient_transport"
  | "target_mismatch"
  | "ambiguous_target"
  | "selector_drift"
  | "postcondition_failure"
  | "execution_failure";

export function classifyBrowserRuntimeFailure(
  detail: string
): BrowserRuntimeFailureClassification {
  if (
    /REAUTHENTICATION_REQUIRED|AUTH(?:ENTICATION)?[_ ]?(?:EXPIRED|REQUIRED|FAILED)|\b401\b|login|session expired|username is not configured|password is not configured/i.test(
      detail
    )
  )
    return "authentication";
  if (/TARGET_MISMATCH/i.test(detail)) return "target_mismatch";
  if (/AMBIGUOUS_TARGET|TARGET_AMBIGUOUS/i.test(detail))
    return "ambiguous_target";
  if (/EXECUTION_UNVERIFIED|POSTCONDITION/i.test(detail))
    return "postcondition_failure";
  if (
    /TARGET_VERIFICATION_FAILED|selector|locator|element (?:missing|not found)|expected element|navigation drift|structure drift|detached|not visible/i.test(
      detail
    )
  )
    return "selector_drift";
  if (
    /timeout|timed out|ECONN|network|transport|websocket|CDP|fetch failed/i.test(
      detail
    )
  )
    return "transient_transport";
  return "execution_failure";
}

type FailureRecorder = typeof recordBrowserOperationResult;
type ReauthRecorder = typeof markConnectionAuthenticationExpired;

export async function recordLearnedRuntimeFailure(
  input: {
    organisationId: number;
    connectedSystemId: number;
    operationKey: string;
    version: number;
    correlationId: string;
    detail: string;
  },
  dependencies: {
    record?: FailureRecorder;
    markReauthentication?: ReauthRecorder;
  } = {}
) {
  const classification = classifyBrowserRuntimeFailure(input.detail);
  const record = dependencies.record || recordBrowserOperationResult;
  const result = await record({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    operationKey: input.operationKey,
    version: input.version,
    success: false,
    watchdog: true,
    error: `${classification}: deterministic browser operation failed.`,
    evidence: {
      correlationId: input.correlationId,
      failureClassification: classification,
    },
  });
  if (classification === "authentication") {
    const mark =
      dependencies.markReauthentication || markConnectionAuthenticationExpired;
    await mark({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      summary:
        "Browser CRM authentication expired during deterministic operation execution.",
    });
  }
  return { classification, status: result.status };
}
