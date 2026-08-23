import { describe, expect, it } from "vitest";
import { buildWorkflowPlan } from "./workflowRules";

describe("workflow rules", () => {
  it("keeps first-contact work review-only and requires configured messaging", () => {
    const plan = buildWorkflowPlan({ workflowKey: "first_contact", leadLabel: "Candidate A" });
    const sms = plan.actions.find(action => action.actionType === "send_sms_template");

    expect(plan.actions.every(action => action.payload.reviewRequired === true)).toBe(true);
    expect(sms?.payload.requiresConfiguredSender).toBe(true);
    expect(sms?.payload.requiresConfiguredTemplate).toBe(true);
    expect(sms?.payload).not.toHaveProperty("sendingNumber");
    expect(sms?.payload).not.toHaveProperty("templateName");
  });

  it("preserves historical opportunities during generic final closure planning", () => {
    const plan = buildWorkflowPlan({ workflowKey: "final_close", leadLabel: "Contact B" });
    const opportunity = plan.actions.find(action => action.actionType === "update_current_opportunity");

    expect(opportunity?.payload.skipOnlyWhen).toContain("No current open opportunity");
    expect(plan.verificationSummary).toContain("Historical closed records remain untouched");
    expect(opportunity?.payload.requiresConfiguredPipelineMapping).toBe(true);
  });

  it("adds configured failed-contact communications only when a follow-up was not answered", () => {
    const plan = buildWorkflowPlan({ workflowKey: "post_consultation_follow_up", leadLabel: "Contact C", callOutcome: "voicemail" });
    const titles = plan.actions.map(action => action.title);

    expect(titles).toContain("Prepare the organisation-approved follow-up email");
    expect(titles).toContain("Prepare the organisation-approved follow-up SMS");
    expect(titles).toContain("Prepare the next follow-up only if no duplicate exists");
  });

  it("requires factual notes for an answered follow-up", () => {
    expect(() =>
      buildWorkflowPlan({ workflowKey: "post_consultation_follow_up", leadLabel: "Contact D", callOutcome: "answered" }),
    ).toThrow("Provide factual conversation notes");
  });
});
