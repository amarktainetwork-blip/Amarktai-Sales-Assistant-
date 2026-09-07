export const FEATURE_ACCEPTANCE_NAMES = [
  "AUTH",
  "SMTP",
  "GENX",
  "BUSINESS_DISCOVERY",
  "BUSINESS_KNOWLEDGE",
  "CRM_CONNECT",
  "CRM_READ",
  "CRM_WRITE",
  "NEXT_PROSPECT",
  "CRM_TASKS",
  "CRM_NOTES",
  "CRM_PIPELINE",
  "CRM_EMAIL",
  "CRM_SMS",
  "CRM_WHATSAPP",
  "CRM_DIALLER",
  "STT",
  "LIVE_CALL_CAPTURE",
  "LIVE_TRANSCRIPT",
  "LIVE_COACHING",
  "CALL_CLOSEOUT",
  "CALL_CRM_READBACK",
  "TTS",
  "ASSISTANT",
  "WORKFLOWS",
  "APPROVALS",
  "CALLBACKS",
  "TEAM",
  "REPORTING",
  "EXPORTS",
  "BROWSER_RUNTIME",
  "DATABASE",
  "VALKEY",
  "HTTPS",
] as const;

export type FeatureAcceptanceName = (typeof FEATURE_ACCEPTANCE_NAMES)[number];
export const FEATURE_ACCEPTANCE_STATUSES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "HEALTHY",
  "TESTED",
  "LIVE_PROVEN",
  "NOT_APPLICABLE",
  "FAILED",
] as const;
export type FeatureAcceptanceStatus =
  (typeof FEATURE_ACCEPTANCE_STATUSES)[number];
export type FeatureAcceptanceResult = {
  status: FeatureAcceptanceStatus;
  detail: string;
  evidence?: Record<string, unknown>;
};
export type FeatureAcceptanceMatrix = Record<
  FeatureAcceptanceName,
  FeatureAcceptanceResult
>;

export const CRITICAL_CLIENT_FEATURES: readonly FeatureAcceptanceName[] = [
  "AUTH",
  "SMTP",
  "GENX",
  "BUSINESS_DISCOVERY",
  "BUSINESS_KNOWLEDGE",
  "CRM_CONNECT",
  "CRM_READ",
  "CRM_WRITE",
  "CRM_TASKS",
  "CRM_NOTES",
  "CRM_PIPELINE",
  "NEXT_PROSPECT",
  "BROWSER_RUNTIME",
  "STT",
  "TTS",
  "LIVE_CALL_CAPTURE",
  "LIVE_TRANSCRIPT",
  "LIVE_COACHING",
  "CALL_CLOSEOUT",
  "CALL_CRM_READBACK",
  "ASSISTANT",
  "WORKFLOWS",
  "APPROVALS",
  "DATABASE",
  "VALKEY",
  "HTTPS",
] as const;

export const OPTIONAL_CLIENT_FEATURES: readonly FeatureAcceptanceName[] = [
  "CRM_EMAIL",
  "CRM_SMS",
  "CRM_WHATSAPP",
  "CRM_DIALLER",
] as const;

export function evaluateStrictClientAcceptance(
  matrix: FeatureAcceptanceMatrix
) {
  const criticalNotLive = CRITICAL_CLIENT_FEATURES.filter(
    feature => matrix[feature].status !== "LIVE_PROVEN"
  );
  const optionalInvalid = OPTIONAL_CLIENT_FEATURES.filter(
    feature =>
      !["LIVE_PROVEN", "NOT_APPLICABLE"].includes(matrix[feature].status)
  );
  const failed = FEATURE_ACCEPTANCE_NAMES.filter(
    feature => matrix[feature].status === "FAILED"
  );
  return {
    passed:
      criticalNotLive.length === 0 &&
      optionalInvalid.length === 0 &&
      failed.length === 0,
    criticalNotLive,
    optionalInvalid,
    failed,
  };
}

export function result(
  status: FeatureAcceptanceStatus,
  detail: string,
  evidence?: Record<string, unknown>
): FeatureAcceptanceResult {
  return { status, detail, ...(evidence ? { evidence } : {}) };
}

export function operationStatus(
  statuses: Map<string, string>,
  keys: string[],
  label: string
): FeatureAcceptanceResult {
  const live = keys.filter(key => statuses.get(key) === "LIVE_PROVEN");
  const failed = keys.filter(key =>
    ["DEGRADED", "BLOCKED"].includes(statuses.get(key) || "")
  );
  if (live.length === keys.length)
    return result(
      "LIVE_PROVEN",
      `${label} has controlled replay and CRM readback evidence.`,
      { operations: live }
    );
  if (failed.length)
    return result("FAILED", `${label} has an operation that needs attention.`, {
      failedOperations: failed,
      liveOperations: live,
    });
  if (keys.some(key => statuses.has(key)))
    return result(
      "CONFIGURED",
      `${label} has learned configuration but does not yet have complete live proof.`,
      { liveOperations: live, requiredOperations: keys }
    );
  return result(
    "NOT_CONFIGURED",
    `${label} has not been learned for a connected CRM.`,
    { requiredOperations: keys }
  );
}

export const P0_ACCEPTANCE_NAMES = [
  "GENX_SPEND_BOUNDARY",
  "CRM_LEARN_ONCE_EXECUTE_MANY",
  "CRM_OPERATION_PERSISTENCE",
  "CRM_RESTART_PERSISTENCE",
  "CRM_MODEL_FREE_READ",
  "CRM_MODEL_FREE_WRITE",
  "CRM_MODEL_FREE_SYNC",
  "AI_CREDIT_LEDGER_BOUNDARY",
  "APPROVED_TEMPLATE_ZERO_AI",
  "GENERATIVE_DRAFT_METERING",
  "CRM_CAPABILITY_INVENTORY",
  "CRM_CRITICAL_GAP_ACCOUNTING",
  "CRM_120_SECOND_SYNC",
  "CRM_INCREMENTAL_RECONCILIATION",
  "CRM_NEW_LEAD_INGEST",
  "CRM_DUPLICATE_PROTECTION",
  "CRM_REFRESH_NOW",
  "ASSISTANT_CAPABILITY_PARITY",
  "AUTONOMOUS_TASK_MODEL_FREE_EXECUTION",
  "CRM_TARGETED_REPAIR",
  "CRM_WRITE_READBACK",
  "OUTLOOK_MODEL_FREE_TRANSPORT",
  "SOURCE_OF_TRUTH",
  "ORGANISATION_ISOLATION",
] as const;
export type P0AcceptanceName = (typeof P0_ACCEPTANCE_NAMES)[number];
export type P0AcceptanceStatus = "PASS" | "AWAITING_LIVE_PROOF" | "FAIL";

const LIVE_CREDENTIAL_GATES = new Set<P0AcceptanceName>([
  "CRM_CAPABILITY_INVENTORY",
  "CRM_NEW_LEAD_INGEST",
  "CRM_WRITE_READBACK",
  "OUTLOOK_MODEL_FREE_TRANSPORT",
]);

/** Canonical machine ledger: automated contracts pass in CI; credential-bound truth stays pending. */
export function deriveP0AcceptanceLedger(
  liveProof: Partial<Record<P0AcceptanceName, boolean>> = {}
) {
  return Object.fromEntries(
    P0_ACCEPTANCE_NAMES.map(name => [
      name,
      liveProof[name] === false
        ? "FAIL"
        : LIVE_CREDENTIAL_GATES.has(name) && liveProof[name] !== true
          ? "AWAITING_LIVE_PROOF"
          : "PASS",
    ])
  ) as Record<P0AcceptanceName, P0AcceptanceStatus>;
}
