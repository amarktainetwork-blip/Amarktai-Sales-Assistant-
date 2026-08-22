import { describe, expect, it } from "vitest";
import { COURSE2CAREER_PRESET } from "./presets/course2career";
import { buildWorkflowPlan } from "./workflowRules";

describe("generic workflow rules", () => {
  it("uses organisation-configured communication guardrails instead of legacy sender or customer values", () => {
    const plan = buildWorkflowPlan({ workflowKey: "first_contact", leadLabel: "Candidate A" });
    const serialised = JSON.stringify(plan);

    expect(plan.actions.every(action => action.payload.reviewRequired === true)).toBe(true);
    expect(serialised).toContain("APPROVED_FIRST_CONTACT_SMS");
    expect(serialised).toContain("organisation-configured approved template");
    expect(serialised).not.toContain("Course2Career");
    expect(serialised).not.toContain("Amelia");
    expect(serialised).not.toContain("+447428000560");
    expect(serialised).not.toContain("Cyber");
  });

  it("rejects an obsolete customer-specific workflow key", () => {
    expect(() => buildWorkflowPlan({ workflowKey: "cyber_final_close" as never, leadLabel: "Candidate B" })).toThrow("supported generic workflow");
  });
  it("prepares the Call 2 failed-contact path with protected history and the next task", () => {
    const plan = buildWorkflowPlan({ workflowKey: "call_2_followup", leadLabel: "Candidate E", callOutcome: "no_answer" });
    expect(plan.actions.map(action => action.title)).toContain("Schedule Call 3 only if no duplicate exists");
    expect(plan.actions.find(action => action.actionType === "send_sms_template")?.payload.sendingNumber).toBeUndefined();
  });
  it("requires factual callback details before scheduling a callback", () => {
    expect(() => buildWorkflowPlan({ workflowKey: "callback_requested", leadLabel: "Candidate F", conversationNotes: "Requested a callback" })).toThrow("Provide the agreed callback date and time");
    const plan = buildWorkflowPlan({ workflowKey: "callback_requested", leadLabel: "Candidate F", callbackAt: "2026-08-19T10:00:00Z", conversationNotes: "Asked for a callback after work." });
    expect(plan.actions.map(action => action.actionType)).toContain("schedule_callback");
  });
  it("requires factual context and a time for booking confirmation", () => {
    expect(() => buildWorkflowPlan({ workflowKey: "booking_confirmation", leadLabel: "Candidate G", conversationNotes: "Confirmed a booking." })).toThrow("Provide the agreed date and time");
    const plan = buildWorkflowPlan({ workflowKey: "booking_confirmation", leadLabel: "Candidate G", conversationNotes: "Confirmed a booking for Wednesday.", callbackAt: "2026-08-19T10:00:00Z" });
    expect(plan.actions.map(action => action.title)).toContain("Send approved booking confirmation email");
    expect(plan.actions.every(action => action.payload.reviewRequired === true)).toBe(true);
  });
  it("maps a verified booked outcome to protected status and booking-task proposals", () => {
    const plan = buildWorkflowPlan({ workflowKey: "post_call_outcome", leadLabel: "Candidate H", salesOutcome: "booked", conversationNotes: "Candidate confirmed a booking for Friday." });
    expect(plan.actions.map(action => action.title)).toContain("Review status update to Booked");
    expect(plan.actions.map(action => action.title)).toContain("Schedule booking task only if no duplicate exists");
  });
  it("requires factual notes and prepares approved information-request communication", () => {
    expect(() => buildWorkflowPlan({ workflowKey: "post_call_outcome", leadLabel: "Candidate I", salesOutcome: "information_requested" })).toThrow("Provide factual outcome notes");
    const plan = buildWorkflowPlan({ workflowKey: "post_call_outcome", leadLabel: "Candidate I", salesOutcome: "information_requested", conversationNotes: "Asked for approved programme information by email." });
    expect(plan.actions.map(action => action.title)).toContain("Send approved information-request email");
  });
});

describe("Course2Career migration preset", () => {
  it("is isolated and inactive until an organisation explicitly activates it", () => {
    expect(COURSE2CAREER_PRESET.key).toBe("course2career");
    expect(COURSE2CAREER_PRESET.status).toBe("inactive_by_default");
    expect(COURSE2CAREER_PRESET.requiresExplicitOrganisationActivation).toBe(true);
  });
});
