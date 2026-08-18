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
  it("prepares the Call 2 failed-contact path with protected history and the next task", () => {
    const plan = buildWorkflowPlan({ workflowKey: "call_2_followup", leadLabel: "Candidate E", callOutcome: "no_answer" });
    expect(plan.actions.map(action => action.title)).toContain("Schedule Call 3 only if no duplicate exists");
    expect(plan.actions.find(action => action.actionType === "send_sms_template")?.payload.sendingNumber).toBe("+447428000560");
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
