import { describe, expect, it } from "vitest";
import { FEATURE_ACCEPTANCE_NAMES, operationStatus } from "./featureAcceptance";

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
});
