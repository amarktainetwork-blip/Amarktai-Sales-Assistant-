import { describe, expect, it } from "vitest";
import {
  automationPolicyFromPreset,
  mayAutoExecute,
  normalizeAutomationPolicy,
} from "./automationPolicy";

describe("organisation automation policy", () => {
  it("defaults to review mode with safe deterministic admin actions", () => {
    const policy = normalizeAutomationPolicy(undefined);
    expect(policy.mode).toBe("review");
    expect(policy.autoActionTypes).toContain("append_contact_note");
    expect(policy.requireReviewForCommunications).toBe(true);
    expect(policy.requireReviewForStageChanges).toBe(true);
  });
  it("only auto-executes explicit allowlisted actions in auto mode", () => {
    const policy = normalizeAutomationPolicy({
      mode: "auto_preapproved",
      autoActionTypes: [
        "append_contact_note",
        "send_email",
        "update_opportunity",
      ],
    });
    expect(mayAutoExecute(policy, "append_contact_note")).toBe(true);
    expect(mayAutoExecute(policy, "send_email")).toBe(false);
    expect(mayAutoExecute(policy, "update_opportunity")).toBe(false);
  });
  it("allows management to explicitly relax communication/stage review requirements", () => {
    const policy = normalizeAutomationPolicy({
      mode: "auto_preapproved",
      autoActionTypes: ["send_email", "update_opportunity"],
      requireReviewForCommunications: false,
      requireReviewForStageChanges: false,
    });
    expect(mayAutoExecute(policy, "send_email")).toBe(true);
    expect(mayAutoExecute(policy, "update_opportunity")).toBe(true);
  });

  it("provides conservative onboarding presets and never silently automates communications", () => {
    expect(automationPolicyFromPreset("assist_only")).toMatchObject({
      mode: "review",
      preset: "assist_only",
    });
    expect(automationPolicyFromPreset("balanced")).toMatchObject({
      mode: "auto_preapproved",
      actionModes: { send_email: "salesperson_approval" },
    });
    expect(automationPolicyFromPreset("automated")).toMatchObject({
      actionModes: {
        send_sms: "manager_approval",
        send_whatsapp: "manager_approval",
        update_opportunity: "manager_approval",
      },
    });
  });

  it("bounds schedules, retries and action volume", () => {
    const policy = normalizeAutomationPolicy({
      safety: { maximumActionsPerRun: 50_000, maximumRetries: 100 },
      schedule: { mode: "business_hours", days: [-1, 1, 9], startHour: 99 },
    });
    expect(policy.safety.maximumActionsPerRun).toBe(500);
    expect(policy.safety.maximumRetries).toBe(10);
    expect(policy.schedule).toMatchObject({
      mode: "business_hours",
      days: [1],
      startHour: 23,
    });
  });
});
