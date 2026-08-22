import type { WorkflowKey } from "./agentCatalog";

export type CallOutcome = "no_answer" | "voicemail" | "answered";
export type SalesOutcome = "answered" | "no_answer" | "voicemail" | "wrong_number" | "not_interested" | "not_fit" | "callback_requested" | "booked" | "considering_options" | "information_requested" | "funding_issue" | "time_issue" | "family_commitments" | "already_studying_elsewhere" | "closed_lost";

export type WorkflowRequest = {
  workflowKey: WorkflowKey;
  leadLabel: string;
  callOutcome?: CallOutcome;
  salesOutcome?: SalesOutcome;
  conversationNotes?: string;
  callbackAt?: string;
};

export type ProposedAction = {
  actionType: string;
  title: string;
  targetLabel: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type WorkflowPlan = {
  verificationSummary: string;
  actions: ProposedAction[];
};

function key(leadLabel: string, suffix: string) {
  return `${leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${suffix}`;
}

function reviewAction(
  leadLabel: string,
  suffix: string,
  actionType: string,
  title: string,
  payload: Record<string, unknown>,
): ProposedAction {
  return {
    actionType,
    title,
    targetLabel: leadLabel,
    idempotencyKey: key(leadLabel, suffix),
    payload: {
      reviewRequired: true,
      duplicateProtection: "Check the external record immediately before execution; skip if this exact action is already complete.",
      ...payload,
    },
  };
}

function commonVerification(leadLabel: string): ProposedAction[] {
  return [
    reviewAction(leadLabel, "contact-context", "verify_contact_context", "Review contact history and existing tasks", {
      requiredChecks: ["existing tasks", "conversation history", "all opportunities"],
    }),
  ];
}

function firstContactPlan(leadLabel: string): WorkflowPlan {
  return {
    verificationSummary:
      "Before an external action, verify the contact is not pitched, closed, rejected, not interested, not a fit, or otherwise progressed beyond attempted contact. Check for an already-sent first-contact message and a duplicate future callback.",
    actions: [
      ...commonVerification(leadLabel),
      reviewAction(leadLabel, "first-contact-sms", "send_sms_template", "Send approved initial first-contact SMS", {
        templateName: "APPROVED_FIRST_CONTACT_SMS",
        guardrail: "Use only an organisation-configured approved template, sender identity, consent rule, and contact-hours policy.",
      }),
      reviewAction(leadLabel, "call-2", "schedule_callback", "Schedule Call 2 only when the First Call remains pending", {
        taskTitle: "Call 2",
        prerequisite: "Confirm no current future Call 2 task exists and that the First Call has not been completed successfully.",
      }),
    ],
  };
}

function callAttemptPlan(request: WorkflowRequest, attempt: 2 | 3 | 4): WorkflowPlan {
  const outcome = request.callOutcome;
  if (!outcome) throw new Error(`Select no answer, voicemail, or answered before preparing the Call ${attempt} workflow.`);
  if (outcome === "answered" && !request.conversationNotes?.trim()) throw new Error("Provide factual conversation notes for an answered call. The assistant will not invent a customer outcome.");
  const nextTask = attempt === 2 ? "Call 3" : attempt === 3 ? "Call 4" : "Final closure review";
  const actions: ProposedAction[] = [
    ...commonVerification(request.leadLabel),
    reviewAction(request.leadLabel, `complete-call-${attempt}`, "complete_active_task", `Complete only the active Call ${attempt} task`, { allowedTaskTitles: [`Call ${attempt}`], forbidden: ["reopen completed tasks", "modify historical tasks"] }),
    reviewAction(request.leadLabel, `call-${attempt}-notes`, "append_contact_note", `Add factual Call ${attempt} outcome notes`, { outcome, content: outcome === "answered" ? request.conversationNotes?.trim() : `Call ${attempt} attempted: ${outcome === "no_answer" ? "no answer" : "voicemail"}.`, guardrail: "Use only information supplied by the consultant." }),
  ];
  if (outcome !== "answered") actions.push(
    reviewAction(request.leadLabel, `call-${attempt}-email`, "send_email_template", `Send approved Call ${attempt} follow-up email`, { templateName: `CALL ${attempt} FOLLOW-UP EMAIL`, requireSavedSubject: true, guardrail: "Only execute when the saved approved template and subject are configured." }),
    reviewAction(request.leadLabel, `call-${attempt}-sms`, "send_sms_template", `Send approved Call ${attempt} follow-up SMS`, { templateName: `CALL_${attempt}_FOLLOW_UP_SMS`, guardrail: "Only execute when the organisation-configured approved template, sender identity, consent, and contact-hours policy are configured." }),
    reviewAction(request.leadLabel, `call-${attempt}-next-task`, "schedule_callback", `Schedule ${nextTask} only if no duplicate exists`, { taskTitle: nextTask, prerequisite: "Verify there is no current future task of this type and that the current call task was attempted." }),
  );
  return { verificationSummary: `Review the full contact history, current open task, current opportunity, consent signals, and future callbacks before progressing Call ${attempt}. Completed or historical records remain protected. If the candidate answered, use only factual notes and the agreed next step; do not send failed-contact communications automatically.`, actions };
}

function callbackRequestedPlan(request: WorkflowRequest): WorkflowPlan {
  if (!request.callbackAt?.trim()) throw new Error("Provide the agreed callback date and time before preparing a callback-requested workflow.");
  if (!request.conversationNotes?.trim()) throw new Error("Provide the factual request and agreed callback context before preparing the workflow.");
  return { verificationSummary: "Confirm the callback request is factual, consent is intact, the requested time is within policy, and no equivalent future callback already exists before creating a reviewable task.", actions: [
    ...commonVerification(request.leadLabel),
    reviewAction(request.leadLabel, "callback-request-note", "append_contact_note", "Add factual callback-request notes", { content: request.conversationNotes.trim(), guardrail: "Record only what the candidate or consultant stated." }),
    reviewAction(request.leadLabel, "callback-request-task", "schedule_callback", "Schedule the agreed callback only if no duplicate exists", { taskTitle: "Callback", callbackAt: request.callbackAt.trim(), prerequisite: "Verify a matching future callback does not already exist and respect approved office-hour rules." }),
  ] };
}

function structuredFollowUpPlan(request: WorkflowRequest, type: "booking_confirmation" | "reschedule_requested" | "no_show_followup" | "information_request" | "manager_escalation"): WorkflowPlan {
  if (!request.conversationNotes?.trim()) throw new Error("Provide factual notes before preparing this workflow. The assistant will not infer a booking, reschedule, no-show, request, or escalation.");
  const definitions = {
    booking_confirmation: { title: "Booking confirmation", email: "BOOKING CONFIRMATION EMAIL", sms: "BOOKING CONFIRMATION SMS", task: "Booking task", requiresTime: true },
    reschedule_requested: { title: "Reschedule requested", email: "RESCHEDULE CONFIRMATION EMAIL", sms: "RESCHEDULE CONFIRMATION SMS", task: "Rescheduled consultation", requiresTime: true },
    no_show_followup: { title: "No-show follow-up", email: "NO-SHOW FOLLOW-UP EMAIL", sms: "NO-SHOW FOLLOW-UP SMS", task: "No-show follow-up" },
    information_request: { title: "Information request", email: "INFORMATION REQUEST EMAIL", sms: "INFORMATION REQUEST SMS", task: "Information follow-up" },
    manager_escalation: { title: "Manager escalation", task: "Manager review" },
  } as const;
  const definition = definitions[type];
  if ("requiresTime" in definition && definition.requiresTime && !request.callbackAt?.trim()) throw new Error("Provide the agreed date and time before preparing this booking or reschedule workflow.");
  const actions: ProposedAction[] = [
    ...commonVerification(request.leadLabel),
    reviewAction(request.leadLabel, `${type}-notes`, "append_contact_note", `Add factual ${definition.title.toLowerCase()} notes`, { content: request.conversationNotes.trim(), guardrail: "Record only verified statements and never overwrite historic notes." }),
  ];
  if ("email" in definition) actions.push(reviewAction(request.leadLabel, `${type}-email`, "send_email_template", `Send approved ${definition.title.toLowerCase()} email`, { templateName: definition.email, requireSavedSubject: true, guardrail: "Use only a configured approved template and do not send a blank subject." }));
  if ("sms" in definition) actions.push(reviewAction(request.leadLabel, `${type}-sms`, "send_sms_template", `Send approved ${definition.title.toLowerCase()} SMS`, { templateName: definition.sms, guardrail: "Use only an organisation-configured approved template, sender identity, consent, and contact-hours policy." }));
  actions.push(reviewAction(request.leadLabel, `${type}-task`, "schedule_callback", `Schedule ${definition.task} only if no duplicate exists`, { taskTitle: definition.task, callbackAt: request.callbackAt?.trim(), prerequisite: "Check existing future tasks, consent, and any current active task before creating work." }));
  return { verificationSummary: `${definition.title} requires factual context, current CRM history, consent and exclusion checks, duplicate protection, and a human decision on every proposed communication or task. This workflow never assumes that a booking, reschedule, no-show, request, or escalation occurred.`, actions };
}

function postCallOutcomePlan(request: WorkflowRequest): WorkflowPlan {
  const outcome = request.salesOutcome;
  if (!outcome) throw new Error("Select the verified post-call outcome before preparing outcome actions.");
  if (!request.conversationNotes?.trim()) throw new Error("Provide factual outcome notes. The assistant will not infer a candidate statement, interest level, booking, or objection.");
  const outcomeLabels: Record<SalesOutcome, string> = { answered: "Answered", no_answer: "No answer", voicemail: "Voicemail", wrong_number: "Wrong number", not_interested: "Not interested", not_fit: "Not a fit", callback_requested: "Callback requested", booked: "Booked", considering_options: "Considering options", information_requested: "Information requested", funding_issue: "Funding issue", time_issue: "Time issue", family_commitments: "Family or commitments issue", already_studying_elsewhere: "Already studying elsewhere", closed_lost: "Closed lost" };
  const actions: ProposedAction[] = [...commonVerification(request.leadLabel), reviewAction(request.leadLabel, `outcome-${outcome}-notes`, "append_contact_note", `Add factual ${outcomeLabels[outcome].toLowerCase()} outcome notes`, { outcome, content: request.conversationNotes.trim(), guardrail: "Record only verified statements and never overwrite history." })];
  if (["not_interested", "not_fit", "wrong_number", "closed_lost"].includes(outcome)) actions.push(reviewAction(request.leadLabel, `outcome-${outcome}-status`, "update_contact_status", `Review status update for ${outcomeLabels[outcome].toLowerCase()}`, { status: outcome === "wrong_number" || outcome === "not_fit" ? "Not a Fit" : outcome === "not_interested" ? "Not Interested" : "Lost", guardrail: "Confirm the current record and historical status trail before any change." }));
  if (["callback_requested", "considering_options", "funding_issue", "time_issue", "family_commitments", "information_requested"].includes(outcome)) actions.push(reviewAction(request.leadLabel, `outcome-${outcome}-task`, "schedule_callback", "Schedule outcome follow-up only if no duplicate exists", { taskTitle: outcome === "callback_requested" ? "Callback" : "Outcome follow-up", callbackAt: request.callbackAt?.trim(), prerequisite: "Confirm consent, any agreed time, and the absence of a duplicate future task." }));
  if (outcome === "booked") actions.push(reviewAction(request.leadLabel, "outcome-booked-status", "update_contact_status", "Review status update to Booked", { status: "Booked", guardrail: "Verify the booking is factual and current before updating the record." }), reviewAction(request.leadLabel, "outcome-booked-task", "schedule_callback", "Schedule booking task only if no duplicate exists", { taskTitle: "Booking task", callbackAt: request.callbackAt?.trim(), prerequisite: "Verify no booking task or calendar item already exists." }));
  if (outcome === "information_requested") actions.push(reviewAction(request.leadLabel, "outcome-information-email", "send_email_template", "Send approved information-request email", { templateName: "INFORMATION REQUEST EMAIL", requireSavedSubject: true, guardrail: "Use approved knowledge and a configured saved template only." }));
  return { verificationSummary: `The verified outcome is ${outcomeLabels[outcome]}. Review existing history, consent, current task, current opportunity, communication history, and duplicate risk before each proposal. The assistant has prepared actions only; a person must decide whether each CRM change or communication is appropriate.`, actions };
}

export function buildWorkflowPlan(request: WorkflowRequest): WorkflowPlan {
  const leadLabel = request.leadLabel.trim();
  if (!leadLabel) throw new Error("A contact or candidate label is required.");
  if (request.workflowKey === "first_contact") return firstContactPlan(leadLabel);
  if (request.workflowKey === "call_2_followup") return callAttemptPlan({ ...request, leadLabel }, 2);
  if (request.workflowKey === "call_3_followup") return callAttemptPlan({ ...request, leadLabel }, 3);
  if (request.workflowKey === "call_4_final_attempt") return callAttemptPlan({ ...request, leadLabel }, 4);
  if (request.workflowKey === "callback_requested") return callbackRequestedPlan({ ...request, leadLabel });
  if (request.workflowKey === "booking_confirmation") return structuredFollowUpPlan({ ...request, leadLabel }, "booking_confirmation");
  if (request.workflowKey === "reschedule_requested") return structuredFollowUpPlan({ ...request, leadLabel }, "reschedule_requested");
  if (request.workflowKey === "no_show_followup") return structuredFollowUpPlan({ ...request, leadLabel }, "no_show_followup");
  if (request.workflowKey === "information_request") return structuredFollowUpPlan({ ...request, leadLabel }, "information_request");
  if (request.workflowKey === "manager_escalation") return structuredFollowUpPlan({ ...request, leadLabel }, "manager_escalation");
  if (request.workflowKey === "post_call_outcome") return postCallOutcomePlan({ ...request, leadLabel });
  throw new Error("Select a supported generic workflow or configure an approved company preset.");
}
