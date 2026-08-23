export const TELESALES_OUTCOMES = [
  "interested",
  "information_requested",
  "callback",
  "meeting_booked",
  "no_answer",
  "voicemail",
  "not_interested",
  "other",
] as const;
export type TelesalesOutcome = (typeof TELESALES_OUTCOMES)[number];

export type ConfirmedCloseout = {
  callSessionId: number;
  leadLabel: string;
  summary: string;
  outcome: TelesalesOutcome;
  nextStep?: string;
  callbackAt?: string;
  opportunityState?: "open" | "won" | "lost" | "unchanged";
  contactStatus?: string;
  communication?: {
    channel: "email" | "sms" | "whatsapp";
    templateName: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  contactExternalId?: string;
  taskExternalId?: string;
  opportunityExternalId?: string;
  commitmentsConfirmed: boolean;
};

export type CloseoutAction = {
  actionType: string;
  title: string;
  targetLabel: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

function basePayload(input: ConfirmedCloseout) {
  return {
    reviewRequired: true,
    sourceCallSessionId: input.callSessionId,
    confirmedOutcome: input.outcome,
    contactExternalId: input.contactExternalId,
    taskExternalId: input.taskExternalId,
    opportunityExternalId: input.opportunityExternalId,
    contactName: input.leadLabel,
  };
}

/** Plans only salesperson-confirmed facts; transcript text never creates commitments. */
export function planTelesalesCloseout(
  input: ConfirmedCloseout
): CloseoutAction[] {
  if (!input.leadLabel.trim() || !input.summary.trim())
    throw new Error("A contact and factual summary are required.");
  const key = (suffix: string) => `live-call:${input.callSessionId}:${suffix}`;
  const common = basePayload(input);
  const actions: CloseoutAction[] = [
    {
      actionType: "append_contact_note",
      title: "Add factual post-call note",
      targetLabel: input.leadLabel,
      idempotencyKey: key("note"),
      payload: { ...common, content: input.summary },
    },
    {
      actionType: "create_activity",
      title: "Log telesales call activity",
      targetLabel: input.leadLabel,
      idempotencyKey: key("activity"),
      payload: {
        ...common,
        fields: {
          activityType: "telesales_call",
          outcome: input.outcome,
          summary: input.summary,
          occurredAt: new Date().toISOString(),
        },
      },
    },
  ];
  if (input.taskExternalId)
    actions.push({
      actionType: "complete_active_task",
      title: "Complete current CRM task / Manual Action",
      targetLabel: input.leadLabel,
      idempotencyKey: key("complete-task"),
      payload: common,
    });
  if (input.callbackAt && input.commitmentsConfirmed)
    actions.push({
      actionType: "schedule_callback",
      title: `Create callback for ${input.callbackAt}`,
      targetLabel: input.leadLabel,
      idempotencyKey: key("callback"),
      payload: {
        ...common,
        dueAt: input.callbackAt,
        taskTitle:
          input.nextStep ||
          `Callback after ${input.outcome.replaceAll("_", " ")}`,
      },
    });
  if (input.contactStatus && input.commitmentsConfirmed)
    actions.push({
      actionType: "update_contact_status",
      title: `Set contact status to ${input.contactStatus}`,
      targetLabel: input.leadLabel,
      idempotencyKey: key("contact-status"),
      payload: {
        ...common,
        status: input.contactStatus,
        fields: { status: input.contactStatus },
      },
    });
  if (
    input.opportunityExternalId &&
    input.opportunityState &&
    input.opportunityState !== "unchanged" &&
    input.commitmentsConfirmed
  )
    actions.push({
      actionType: "update_current_opportunity",
      title: `Update opportunity to ${input.opportunityState}`,
      targetLabel: input.leadLabel,
      idempotencyKey: key("opportunity"),
      payload: {
        ...common,
        fields: {
          status: input.opportunityState,
          nextStep: input.nextStep,
          nextStepAt: input.callbackAt,
        },
      },
    });
  if (input.communication && input.commitmentsConfirmed) {
    const channel = input.communication.channel;
    actions.push({
      actionType: `send_${channel}_template`,
      title: `Prepare approved ${channel.toUpperCase()} follow-up`,
      targetLabel: input.leadLabel,
      idempotencyKey: key(`${channel}-follow-up`),
      payload: {
        ...common,
        templateName: input.communication.templateName,
        to: input.communication.to,
        subject: input.communication.subject,
        body: input.communication.body || "",
      },
    });
  }
  return actions;
}
