import { describe, expect, it } from "vitest";
import {
  automationPolicyFromPreset,
  mayAutoExecute,
  normalizeAutomationPolicy,
} from "./automationPolicy";
import {
  automationDeduplicationSignature,
  automationDeduplicationWindowMinutes,
  evaluateAutomationPolicy,
} from "./automationPolicyEvaluator";

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

  it.each([
    [
      "disabled action",
      { actionModes: { append_contact_note: "disabled" } },
      {},
      "DISABLED",
    ],
    ["monitor", { monitorKeys: ["callbacks"] }, {}, "ACTION_NOT_ALLOWED"],
    ["trigger", { triggerKeys: ["callback_due"] }, {}, "ACTION_NOT_ALLOWED"],
    [
      "salesperson scope",
      { scope: { userIds: [99], pipelineIds: [], leadSources: [] } },
      {},
      "OUT_OF_SCOPE",
    ],
    [
      "pipeline scope",
      { scope: { userIds: [], pipelineIds: ["renewals"], leadSources: [] } },
      {},
      "OUT_OF_SCOPE",
    ],
    [
      "lead-source scope",
      { scope: { userIds: [], pipelineIds: [], leadSources: ["referral"] } },
      {},
      "OUT_OF_SCOPE",
    ],
    [
      "conditions",
      { conditions: { stage: ["qualified"] } },
      {},
      "OUT_OF_SCOPE",
    ],
    [
      "schedule day",
      { schedule: { mode: "continuous", timezone: "UTC", days: [1] } },
      {},
      "OUTSIDE_SCHEDULE",
    ],
    [
      "business hours",
      {
        schedule: {
          mode: "business_hours",
          timezone: "UTC",
          days: [0],
          startHour: 8,
          endHour: 17,
        },
      },
      {},
      "OUTSIDE_SCHEDULE",
    ],
    ["quiet hours", { safety: { quietHoursEnabled: true } }, {}, "QUIET_HOURS"],
    [
      "action allowlist",
      { safety: { allowedActionKeys: ["schedule_callback"] } },
      {},
      "ACTION_NOT_ALLOWED",
    ],
    [
      "channel allowlist",
      { safety: { allowedChannels: ["sms"] } },
      {},
      "CHANNEL_NOT_ALLOWED",
    ],
    [
      "template allowlist",
      { safety: { allowedTemplateIds: ["approved-template"] } },
      { actionType: "send_email" },
      "TEMPLATE_NOT_ALLOWED",
    ],
    ["action limit", {}, { actionsInRun: 25 }, "ACTION_LIMIT_REACHED"],
    ["deduplication", {}, { duplicate: true }, "DEDUPLICATED"],
    ["retry limit", {}, { retryCount: 3 }, "ACTION_NOT_ALLOWED"],
  ])(
    "prevents execution outside the %s restriction",
    (_label, policyPatch, contextPatch, outcome) => {
      const base = normalizeAutomationPolicy({
        preset: "automated",
        mode: "auto_preapproved",
        autoActionTypes: ["append_contact_note"],
        actionModes: { append_contact_note: "automatic" },
        requireReviewForCommunications: false,
        requireReviewForStageChanges: false,
        monitorKeys: ["new_leads"],
        triggerKeys: ["new_lead"],
        schedule: { mode: "continuous", timezone: "UTC", days: [0] },
        safety: {
          maximumActionsPerRun: 25,
          deduplicationWindowMinutes: 1440,
          maximumRetries: 2,
          quietHoursEnabled: false,
          allowedActionKeys: [],
          allowedChannels: [],
          allowedTemplateIds: [],
        },
      });
      const patch = policyPatch as Partial<typeof base>;
      const policy = {
        ...base,
        ...patch,
        safety: { ...base.safety, ...(patch.safety || {}) },
      };
      const result = evaluateAutomationPolicy(policy, {
        phase: "execution",
        actionType: "append_contact_note",
        monitorKey: "new_leads",
        triggerKey: "new_lead",
        userId: 7,
        pipelineId: "sales",
        leadSource: "website",
        channel: "email",
        templateId: "followup",
        attributes: { stage: "new" },
        now: new Date("2026-09-06T22:00:00.000Z"),
        ...contextPatch,
      });
      expect(result.outcome).toBe(outcome);
      expect(result.mayExecute).toBe(false);
    }
  );

  it("requires the configured approver before execution", () => {
    const salesperson = normalizeAutomationPolicy({
      preset: "automated",
      actionModes: { append_contact_note: "salesperson_approval" },
      schedule: { mode: "continuous", days: [0] },
      safety: { quietHoursEnabled: false },
    });
    expect(
      evaluateAutomationPolicy(salesperson, {
        phase: "execution",
        actionType: "append_contact_note",
        now: new Date("2026-09-06T12:00:00.000Z"),
      }).outcome
    ).toBe("SALESPERSON_APPROVAL_REQUIRED");
    const manager = normalizeAutomationPolicy({
      ...salesperson,
      actionModes: { append_contact_note: "manager_approval" },
    });
    expect(
      evaluateAutomationPolicy(manager, {
        phase: "execution",
        actionType: "append_contact_note",
        approvalSatisfied: true,
        now: new Date("2026-09-06T12:00:00.000Z"),
      }).outcome
    ).toBe("MANAGER_APPROVAL_REQUIRED");
  });

  it("uses the configured bounded deduplication window and stable action identity", () => {
    expect(
      automationDeduplicationWindowMinutes({
        safety: { deduplicationWindowMinutes: 30 },
      })
    ).toBe(30);
    expect(
      automationDeduplicationSignature({
        actionType: "send_email",
        targetLabel: "Customer",
        payload: { to: "a@example.com", body: "Hello", ignored: "one" },
      })
    ).toBe(
      automationDeduplicationSignature({
        actionType: "send_email",
        targetLabel: "customer",
        payload: { ignored: "two", body: "Hello", to: "a@example.com" },
      })
    );
  });
});
