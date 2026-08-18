import { describe, expect, it } from "vitest";
import { buildWorkflowPlan } from "./workflowRules";

describe("workflow rules", () => {
  it("keeps first-contact work review-only and fixes the required SMS sending number", () => {
    const plan = buildWorkflowPlan({ workflowKey: "first_contact", leadLabel: "Candidate A" });
    const sms = plan.actions.find(action => action.actionType === "send_sms_template");

    expect(plan.actions.every(action => action.payload.reviewRequired === true)).toBe(true);
    expect(sms?.payload.sendingNumber).toBe("+447428000560");
    expect(sms?.payload.templateName).toBe("INITIAL FIRST CONTACT SMS");
  });

  it("preserves historical opportunities during Cyber final closure planning", () => {
    const plan = buildWorkflowPlan({ workflowKey: "cyber_final_close", leadLabel: "Candidate B" });
    const opportunity = plan.actions.find(action => action.actionType === "update_current_opportunity");

    expect(opportunity?.payload.skipOnlyWhen).toContain("No current open opportunity");
    expect(plan.verificationSummary).toContain("Historical closed or Lost opportunities remain untouched");
  });

  it("adds failed-contact communications only when the Cyber follow-up was not answered", () => {
    const plan = buildWorkflowPlan({ workflowKey: "cyber_post_consultation", leadLabel: "Candidate C", callOutcome: "voicemail" });
    const titles = plan.actions.map(action => action.title);

    expect(titles).toContain("Send saved Follow-up Email Cyber");
    expect(titles).toContain("Send saved Failed Follow-up Cyber SMS");
    expect(titles).toContain("Schedule Last Try Cyber only if no duplicate exists");
  });

  it("requires factual notes for an answered Cyber follow-up", () => {
    expect(() =>
      buildWorkflowPlan({ workflowKey: "cyber_post_consultation", leadLabel: "Candidate D", callOutcome: "answered" }),
    ).toThrow("Provide factual conversation notes");
  });
});
