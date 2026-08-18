import type { WorkflowKey } from "./agentCatalog";

export type CallOutcome = "no_answer" | "voicemail" | "answered";

export type WorkflowRequest = {
  workflowKey: WorkflowKey;
  leadLabel: string;
  callOutcome?: CallOutcome;
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

const FIRST_CONTACT_SMS =
  "Hi [First Name], thank you for your enquiry about our Career Programme. I’ve received your details and would be happy to talk you through the programme and answer any questions you may have. We’re currently handling a high volume of enquiries, so please let me know a convenient day and time for a quick call, and confirm the best number to reach you on. Our office hours are Monday–Friday, 9am–6pm. Kind regards, Amelia – Course2Career";

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
        sendingNumber: "+447428000560",
        templateName: "INITIAL FIRST CONTACT SMS",
        templateText: FIRST_CONTACT_SMS,
        officeHours: "Monday–Friday, 9am–6pm",
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
    reviewAction(request.leadLabel, `call-${attempt}-sms`, "send_sms_template", `Send approved Call ${attempt} follow-up SMS`, { templateName: `CALL ${attempt} FOLLOW-UP SMS`, sendingNumber: "+447428000560", guardrail: "Only execute when the saved approved template is configured." }),
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
  if ("sms" in definition) actions.push(reviewAction(request.leadLabel, `${type}-sms`, "send_sms_template", `Send approved ${definition.title.toLowerCase()} SMS`, { templateName: definition.sms, sendingNumber: "+447428000560", guardrail: "Use only a configured approved template, respect consent, and respect office hours." }));
  actions.push(reviewAction(request.leadLabel, `${type}-task`, "schedule_callback", `Schedule ${definition.task} only if no duplicate exists`, { taskTitle: definition.task, callbackAt: request.callbackAt?.trim(), prerequisite: "Check existing future tasks, consent, and any current active task before creating work." }));
  return { verificationSummary: `${definition.title} requires factual context, current CRM history, consent and exclusion checks, duplicate protection, and a human decision on every proposed communication or task. This workflow never assumes that a booking, reschedule, no-show, request, or escalation occurred.`, actions };
}

function cyberFinalClosePlan(leadLabel: string): WorkflowPlan {
  return {
    verificationSummary:
      "Locate only the active open Last Try task and inspect every opportunity. Historical closed or Lost opportunities remain untouched; a separate current open opportunity must be assessed independently.",
    actions: [
      ...commonVerification(leadLabel),
      reviewAction(leadLabel, "close-active-last-try", "complete_active_task", "Complete only the active Last Try task", {
        allowedTaskTitles: ["Last Try", "Last Try Cyber"],
        forbidden: ["reopen completed tasks", "modify historical tasks"],
      }),
      reviewAction(leadLabel, "permission-close-email", "send_email_template", "Send the saved Permission to Close Your File email", {
        templateLocation: "Consultant Contact Emails",
        templateName: "Permission to Close Your File",
        requireSavedSubject: true,
        forbidden: ["blank subject", "rewriting the template"],
      }),
      reviewAction(leadLabel, "close-file-cyber-sms", "send_sms_template", "Send the saved close file cyber SMS", {
        templateLocation: "Consultant Contact Texts",
        templateName: "close file cyber",
        sendingNumber: "+447428000560",
      }),
      reviewAction(leadLabel, "close-current-opportunity", "update_current_opportunity", "Close only the current open opportunity", {
        transitions: {
          "New Lead – Uncontacted": "Lost – No Show",
          "Attempting Contact": "Lost – No Show",
          "Discovery Call Completed – Considering Options": "Not a Fit / Rejected",
        },
        skipOnlyWhen: "No current open opportunity exists and all historic opportunities are already closed.",
      }),
      reviewAction(leadLabel, "update-lead-lost", "update_contact_status", "Set current contact status to Lost", {
        status: "Lost",
        requiredFields: "Complete closed-lost fields on the current opportunity only.",
      }),
      reviewAction(leadLabel, "cyber-closed-lost-sequence", "apply_sequence", "Set the Cyber Security closed-lost sequence", {
        sequence: "Cyber Security closed-lost",
      }),
    ],
  };
}

function cyberPostConsultationPlan(request: WorkflowRequest): WorkflowPlan {
  const outcome = request.callOutcome;
  if (!outcome) {
    throw new Error("Select no answer, voicemail, or answered before preparing the post-consultation workflow.");
  }
  if (outcome === "answered" && !request.conversationNotes?.trim()) {
    throw new Error("Provide factual conversation notes for an answered call. The assistant will not invent objections, commitments, or outcomes.");
  }

  const baseActions = [
    ...commonVerification(request.leadLabel),
    reviewAction(request.leadLabel, "complete-yes-no-cyber", "complete_active_task", "Complete only the current Yes/No Cyber task", {
      allowedTaskTitles: ["Yes/No Cyber"],
      forbidden: ["reopen completed tasks", "modify historical tasks"],
    }),
    reviewAction(request.leadLabel, "follow-up-notes", "append_contact_note", "Add factual Cyber follow-up notes", {
      outcome,
      content:
        outcome === "answered"
          ? request.conversationNotes?.trim()
          : `Cyber follow-up call attempted: ${outcome === "no_answer" ? "no answer" : "voicemail"}.`,
      guardrail: "Use only information supplied by the consultant.",
    }),
    reviewAction(request.leadLabel, "ensure-discovery-stage", "update_current_opportunity", "Keep the current opportunity at Discovery Completed – Considering Options", {
      transitionOnlyIfCurrentStage: "Attempting Contact",
      targetStage: "Discovery Completed – Considering Options",
      forbidden: ["create duplicate opportunity", "modify historical closed or Lost opportunity"],
    }),
  ];

  if (outcome === "answered") {
    return {
      verificationSummary:
        "The call was answered. Record only the supplied conversation notes, complete the current task, and follow any agreed next step. Do not send failed-contact communications or create a Last Try task automatically.",
      actions: baseActions,
    };
  }

  return {
    verificationSummary:
      "The call was not completed. Verify every existing communication and task immediately before action; then use saved templates exactly, keeping the approved SMS sending number.",
    actions: [
      ...baseActions,
      reviewAction(request.leadLabel, "follow-up-email-cyber", "send_email_template", "Send saved Follow-up Email Cyber", {
        templateLocation: "Consultant Contact Emails",
        templateName: "Follow-up Email Cyber",
        requireSavedSubject: true,
      }),
      reviewAction(request.leadLabel, "failed-follow-up-cyber-sms", "send_sms_template", "Send saved Failed Follow-up Cyber SMS", {
        templateLocation: "Consultant Contact Text",
        templateName: "Failed Follow-up Cyber",
        sendingNumber: "+447428000560",
      }),
      reviewAction(request.leadLabel, "tried-to-email-whatsapp", "send_whatsapp_template", "Send saved tried_to_email WhatsApp template", {
        templateName: "tried_to_email",
      }),
      reviewAction(request.leadLabel, "last-try-cyber", "schedule_callback", "Schedule Last Try Cyber only if no duplicate exists", {
        taskTitle: "Last Try Cyber",
        prerequisite: "Verify a future Last Try Cyber task does not already exist.",
      }),
    ],
  };
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
  if (request.workflowKey === "cyber_final_close") return cyberFinalClosePlan(leadLabel);
  return cyberPostConsultationPlan({ ...request, leadLabel });
}
