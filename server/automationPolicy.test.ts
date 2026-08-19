import { describe, expect, it } from "vitest";
import { mayAutoExecute, normalizeAutomationPolicy } from "./automationPolicy";

describe("organisation automation policy", () => {
  it("defaults to review mode with safe deterministic admin actions", () => {
    const policy = normalizeAutomationPolicy(undefined);
    expect(policy.mode).toBe("review");
    expect(policy.autoActionTypes).toContain("append_contact_note");
    expect(policy.requireReviewForCommunications).toBe(true);
    expect(policy.requireReviewForStageChanges).toBe(true);
  });
  it("only auto-executes explicit allowlisted actions in auto mode", () => {
    const policy = normalizeAutomationPolicy({ mode: "auto_preapproved", autoActionTypes: ["append_contact_note", "send_email", "update_opportunity"] });
    expect(mayAutoExecute(policy, "append_contact_note")).toBe(true);
    expect(mayAutoExecute(policy, "send_email")).toBe(false);
    expect(mayAutoExecute(policy, "update_opportunity")).toBe(false);
  });
  it("allows management to explicitly relax communication/stage review requirements", () => {
    const policy = normalizeAutomationPolicy({ mode: "auto_preapproved", autoActionTypes: ["send_email", "update_opportunity"], requireReviewForCommunications: false, requireReviewForStageChanges: false });
    expect(mayAutoExecute(policy, "send_email")).toBe(true);
    expect(mayAutoExecute(policy, "update_opportunity")).toBe(true);
  });
});
