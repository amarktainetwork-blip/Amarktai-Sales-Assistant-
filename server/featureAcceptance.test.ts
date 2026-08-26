import { describe, expect, it } from "vitest";
import { CRITICAL_CLIENT_FEATURES, evaluateStrictClientAcceptance, FEATURE_ACCEPTANCE_NAMES, operationStatus, result, type FeatureAcceptanceMatrix } from "./featureAcceptance";

describe("client feature acceptance truth", () => {
  it("contains every required product feature exactly once", () => {
    expect(new Set(FEATURE_ACCEPTANCE_NAMES).size).toBe(34);
    expect(FEATURE_ACCEPTANCE_NAMES).toContain("CALL_CRM_READBACK");
    expect(FEATURE_ACCEPTANCE_NAMES).toContain("HTTPS");
  });

  it("never promotes configured browser operations to live proof", () => {
    const configured = operationStatus(new Map([["email.send", "TEST_READY"]]), ["email.send"], "CRM email");
    expect(configured.status).toBe("CONFIGURED");
    const live = operationStatus(new Map([["email.send", "LIVE_PROVEN"]]), ["email.send"], "CRM email");
    expect(live.status).toBe("LIVE_PROVEN");
  });

  it("requires LIVE_PROVEN for every critical client feature", () => {
    const matrix = Object.fromEntries(FEATURE_ACCEPTANCE_NAMES.map(name => [name, result("LIVE_PROVEN", "proof")])) as FeatureAcceptanceMatrix;
    for (const critical of CRITICAL_CLIENT_FEATURES) {
      const candidate = { ...matrix, [critical]: result("TESTED", "tests only") };
      expect(evaluateStrictClientAcceptance(candidate).passed, critical).toBe(false);
    }
    expect(evaluateStrictClientAcceptance(matrix).passed).toBe(true);
  });

  it("allows optional CRM functions only when live-proven or truthfully not applicable", () => {
    const matrix = Object.fromEntries(FEATURE_ACCEPTANCE_NAMES.map(name => [name, result("LIVE_PROVEN", "proof")])) as FeatureAcceptanceMatrix;
    matrix.CRM_SMS = result("NOT_APPLICABLE", "connected account does not expose SMS");
    expect(evaluateStrictClientAcceptance(matrix).passed).toBe(true);
    matrix.CRM_SMS = result("TESTED", "tests only");
    expect(evaluateStrictClientAcceptance(matrix).passed).toBe(false);
  });
});
