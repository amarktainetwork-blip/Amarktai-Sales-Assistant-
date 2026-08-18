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
  if (request.workflowKey === "cyber_final_close") return cyberFinalClosePlan(leadLabel);
  return cyberPostConsultationPlan({ ...request, leadLabel });
}
