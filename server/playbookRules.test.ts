import { describe, expect, it } from "vitest";
import { buildPlaybookPlan } from "./playbookRules";

describe("active playbook preparation", () => {
  const playbook = { id: 7, title: "Callback recovery", description: "Review callback recovery work.", agentKey: "pipeline_planner", requiredCapabilities: ["notes", "tasks", "email"], reviewRequired: true, status: "active" as const };
  it("maps an active playbook to review-required proposal types", () => {
    const plan = buildPlaybookPlan({ playbook, leadLabel: "Amara Daniels", factualContext: "Requested another callback after work." });
    expect(plan.actions.every(action => action.payload.reviewRequired === true)).toBe(true);
    expect(plan.actions.map(action => action.actionType)).toEqual(expect.arrayContaining(["verify_contact_context", "append_contact_note", "schedule_callback", "send_email_template"]));
  });
  it("rejects inactive or empty-context playbook preparation", () => {
    expect(() => buildPlaybookPlan({ playbook: { ...playbook, status: "active", reviewRequired: false }, leadLabel: "Amara Daniels", factualContext: "Context" })).toThrow("Only active review-first playbooks");
    expect(() => buildPlaybookPlan({ playbook, leadLabel: "Amara Daniels", factualContext: "" })).toThrow("Provide factual context");
  });
});
