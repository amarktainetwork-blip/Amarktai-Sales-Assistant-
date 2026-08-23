import type { WorkflowKey } from "./agentCatalog";

export type CallOutcome = "no_answer" | "voicemail" | "answered";

export type WorkflowRequest = {
  workflowKey: WorkflowKey;
  leadLabel: string;
  callOutcome?: CallOutcome;
  conversationNotes?: string;
};

export type ProposedAction = {
  actionType: string;
  title: string;
  targetLabel: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type WorkflowPlan = { verificationSummary: string; actions: ProposedAction[] };

function key(leadLabel: string, suffix: string) {
  return `${leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${suffix}`;
}

function reviewAction(leadLabel: string, suffix: string, actionType: string, title: string, payload: Record<string, unknown>): ProposedAction {
  return { actionType, title, targetLabel: leadLabel, idempotencyKey: key(leadLabel, suffix), payload: { reviewRequired: true, duplicateProtection: "Check the external record immediately before execution; skip when this exact action is already complete.", ...payload } };
}

function commonVerification(leadLabel: string): ProposedAction[] {
  return [reviewAction(leadLabel, "contact-context", "verify_contact_context", "Review contact history and current work", { requiredChecks: ["existing tasks", "conversation history", "current and historical opportunities"] })];
}

function firstContactPlan(leadLabel: string): WorkflowPlan {
  return {
    verificationSummary: "Before an external action, verify the contact is not already progressed, closed, rejected, or beyond an initial outreach attempt. Check for an already-sent first-contact message and a duplicate future callback.",
    actions: [
      ...commonVerification(leadLabel),
      reviewAction(leadLabel, "first-contact-message", "send_sms_template", "Prepare the organisation-approved first-contact message", { templatePurpose: "first_contact", requiresConfiguredTemplate: true, requiresConfiguredSender: true }),
      reviewAction(leadLabel, "next-follow-up", "schedule_callback", "Prepare the next follow-up only when no equivalent future task exists", { taskPurpose: "follow_up", prerequisite: "Confirm an equivalent future task does not already exist and the contact has not completed the intended interaction." }),
    ],
  };
}

function finalClosePlan(leadLabel: string): WorkflowPlan {
  return {
    verificationSummary: "Inspect the current open work and every opportunity before closure. Historical closed records remain untouched; a current open opportunity is reviewed independently and no status is changed without human approval.",
    actions: [
      ...commonVerification(leadLabel),
      reviewAction(leadLabel, "complete-active-follow-up", "complete_active_task", "Complete only the active final follow-up task", { taskPurpose: "final_follow_up", forbidden: ["reopen completed tasks", "modify historical tasks"] }),
      reviewAction(leadLabel, "permission-to-close-message", "send_email_template", "Prepare the organisation-approved closure message", { templatePurpose: "permission_to_close", requiresConfiguredTemplate: true, forbidden: ["blank subject", "rewriting an approved template"] }),
      reviewAction(leadLabel, "close-current-opportunity", "update_current_opportunity", "Prepare an update to the current open opportunity", { transitionIntent: "close_or_lost", requiresConfiguredPipelineMapping: true, skipOnlyWhen: "No current open opportunity exists and all historical opportunities are already closed." }),
      reviewAction(leadLabel, "update-contact-status", "update_contact_status", "Prepare the configured closed-contact status update", { statusIntent: "closed_or_lost", requiresConfiguredPipelineMapping: true }),
    ],
  };
}

function postConsultationFollowUpPlan(request: WorkflowRequest): WorkflowPlan {
  const outcome = request.callOutcome;
  if (!outcome) throw new Error("Select no answer, voicemail, or answered before preparing the post-consultation workflow.");
  if (outcome === "answered" && !request.conversationNotes?.trim()) throw new Error("Provide factual conversation notes for an answered call. The assistant will not invent objections, commitments, or outcomes.");

  const baseActions = [
    ...commonVerification(request.leadLabel),
    reviewAction(request.leadLabel, "complete-current-follow-up", "complete_active_task", "Complete only the current follow-up task", { taskPurpose: "post_consultation_follow_up", forbidden: ["reopen completed tasks", "modify historical tasks"] }),
    reviewAction(request.leadLabel, "follow-up-notes", "append_contact_note", "Add factual follow-up notes", { outcome, content: outcome === "answered" ? request.conversationNotes?.trim() : `Follow-up call attempted: ${outcome === "no_answer" ? "no answer" : "voicemail"}.`, guardrail: "Use only information supplied by the consultant." }),
    reviewAction(request.leadLabel, "review-current-opportunity", "update_current_opportunity", "Prepare a mapped current-opportunity update", { transitionIntent: "post_consultation", requiresConfiguredPipelineMapping: true, forbidden: ["create duplicate opportunity", "modify historical closed opportunity"] }),
  ];

  if (outcome === "answered") return { verificationSummary: "The call was answered. Record only the supplied conversation notes, complete the current task, and prepare any agreed next step. Do not send failed-contact communications or create another follow-up automatically.", actions: baseActions };

  return {
    verificationSummary: "The call was not completed. Verify existing communications and tasks immediately before action, then prepare only organisation-configured templates and a duplicate-safe follow-up task for human review.",
    actions: [
      ...baseActions,
      reviewAction(request.leadLabel, "follow-up-email", "send_email_template", "Prepare the organisation-approved follow-up email", { templatePurpose: "follow_up", requiresConfiguredTemplate: true }),
      reviewAction(request.leadLabel, "follow-up-sms", "send_sms_template", "Prepare the organisation-approved follow-up SMS", { templatePurpose: "follow_up", requiresConfiguredTemplate: true, requiresConfiguredSender: true }),
      reviewAction(request.leadLabel, "follow-up-whatsapp", "send_whatsapp_template", "Prepare the organisation-approved follow-up WhatsApp message", { templatePurpose: "follow_up", requiresConfiguredTemplate: true }),
      reviewAction(request.leadLabel, "next-follow-up", "schedule_callback", "Prepare the next follow-up only if no duplicate exists", { taskPurpose: "follow_up", prerequisite: "Verify an equivalent future follow-up task does not already exist." }),
    ],
  };
}

export function buildWorkflowPlan(request: WorkflowRequest): WorkflowPlan {
  const leadLabel = request.leadLabel.trim();
  if (!leadLabel) throw new Error("A contact label is required.");
  if (request.workflowKey === "first_contact") return firstContactPlan(leadLabel);
  if (request.workflowKey === "final_close") return finalClosePlan(leadLabel);
  return postConsultationFollowUpPlan({ ...request, leadLabel });
}
