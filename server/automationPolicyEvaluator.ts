export type AutomationPolicyOutcome =
  | "ALLOWED_AUTOMATIC"
  | "SALESPERSON_APPROVAL_REQUIRED"
  | "MANAGER_APPROVAL_REQUIRED"
  | "DISABLED"
  | "OUT_OF_SCOPE"
  | "OUTSIDE_SCHEDULE"
  | "QUIET_HOURS"
  | "ACTION_NOT_ALLOWED"
  | "CHANNEL_NOT_ALLOWED"
  | "TEMPLATE_NOT_ALLOWED"
  | "ACTION_LIMIT_REACHED"
  | "DEDUPLICATED";

export type AutomationEvaluationContext = {
  phase: "trigger" | "work" | "proposal" | "approval" | "execution";
  actionType: string;
  monitorKey?: string;
  triggerKey?: string;
  userId?: number | null;
  pipelineId?: string | null;
  leadSource?: string | null;
  channel?: string | null;
  templateId?: string | null;
  attributes?: Record<string, unknown>;
  now?: Date;
  manual?: boolean;
  actionsInRun?: number;
  duplicate?: boolean;
  retryCount?: number;
  approvalSatisfied?: boolean;
  managerApprovalSatisfied?: boolean;
};

type EvaluatedPolicy = {
  mode: string;
  autoActionTypes: string[];
  requireReviewForCommunications: boolean;
  requireReviewForStageChanges: boolean;
  monitorKeys: string[];
  actionModes: Record<string, string>;
  scope: { userIds: number[]; pipelineIds: string[]; leadSources: string[] };
  triggerKeys: string[];
  conditions: Record<string, string[]>;
  schedule: {
    mode: string;
    timezone?: string;
    days: number[];
    startHour?: number;
    endHour?: number;
  };
  safety: {
    maximumActionsPerRun: number;
    deduplicationWindowMinutes: number;
    maximumRetries: number;
    quietHoursEnabled: boolean;
    allowedActionKeys: string[];
    allowedChannels: string[];
    allowedTemplateIds: string[];
  };
};

function decision(outcome: AutomationPolicyOutcome, detail: string) {
  const approvalRequired =
    outcome === "SALESPERSON_APPROVAL_REQUIRED" ||
    outcome === "MANAGER_APPROVAL_REQUIRED";
  return {
    outcome,
    detail,
    allowedToCreate: outcome === "ALLOWED_AUTOMATIC" || approvalRequired,
    approvalRequired,
    approvalMode:
      outcome === "MANAGER_APPROVAL_REQUIRED"
        ? ("manager" as const)
        : approvalRequired
          ? ("salesperson" as const)
          : ("none" as const),
    mayExecute: outcome === "ALLOWED_AUTOMATIC",
  };
}

function communicationAction(actionType: string) {
  return /^send_(?:email|sms|whatsapp)/.test(actionType);
}

function stageAction(actionType: string) {
  return /opportunity|stage|contact_status/.test(actionType);
}

function inferredChannel(actionType: string) {
  if (/email/.test(actionType)) return "email";
  if (/sms/.test(actionType)) return "sms";
  if (/whatsapp/.test(actionType)) return "whatsapp";
  if (/call|dialler/.test(actionType)) return "dialler";
  return "";
}

function zonedClock(now: Date, timezone?: string) {
  const zone = timezone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const weekday = parts.find(part => part.type === "weekday")?.value || "Sun";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekday
    );
    return {
      day: day < 0 ? now.getUTCDay() : day,
      hour: Number(parts.find(part => part.type === "hour")?.value || 0),
    };
  } catch {
    return { day: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

function normalized(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** The single deterministic server-side decision point for every automation phase. */
export function evaluateAutomationPolicy(
  policy: EvaluatedPolicy,
  context: AutomationEvaluationContext
) {
  const mode = policy.actionModes[context.actionType];
  if (mode === "disabled")
    return decision(
      "DISABLED",
      "This action is disabled by management policy."
    );

  if (context.monitorKey && !policy.monitorKeys.includes(context.monitorKey))
    return decision(
      "ACTION_NOT_ALLOWED",
      "This event category is not monitored by management policy."
    );
  if (context.triggerKey && !policy.triggerKeys.includes(context.triggerKey))
    return decision(
      "ACTION_NOT_ALLOWED",
      "This trigger is not enabled by management policy."
    );
  if (
    policy.scope.userIds.length &&
    (!context.userId || !policy.scope.userIds.includes(context.userId))
  )
    return decision(
      "OUT_OF_SCOPE",
      "The assigned salesperson is outside policy scope."
    );
  if (
    policy.scope.pipelineIds.length &&
    (!context.pipelineId ||
      !policy.scope.pipelineIds.includes(context.pipelineId))
  )
    return decision(
      "OUT_OF_SCOPE",
      "The CRM pipeline is outside policy scope."
    );
  if (
    policy.scope.leadSources.length &&
    (!context.leadSource ||
      !policy.scope.leadSources.includes(context.leadSource))
  )
    return decision("OUT_OF_SCOPE", "The lead source is outside policy scope.");
  for (const [key, accepted] of Object.entries(policy.conditions)) {
    if (
      accepted.length &&
      !accepted.map(normalized).includes(normalized(context.attributes?.[key]))
    )
      return decision("OUT_OF_SCOPE", `Condition '${key}' was not satisfied.`);
  }

  const clock = zonedClock(context.now || new Date(), policy.schedule.timezone);
  if (policy.schedule.mode === "manual" && !context.manual)
    return decision("OUTSIDE_SCHEDULE", "Policy allows manual runs only.");
  if (policy.schedule.days.length && !policy.schedule.days.includes(clock.day))
    return decision(
      "OUTSIDE_SCHEDULE",
      "Today is outside the configured schedule."
    );
  if (policy.schedule.mode === "business_hours") {
    const start = policy.schedule.startHour ?? 8;
    const end = policy.schedule.endHour ?? 17;
    if (clock.hour < start || clock.hour >= end)
      return decision(
        "OUTSIDE_SCHEDULE",
        "The run is outside configured business hours."
      );
  }
  if (
    policy.safety.quietHoursEnabled &&
    !context.manual &&
    (clock.hour >= 20 || clock.hour < 7)
  )
    return decision("QUIET_HOURS", "Management quiet hours are active.");

  const externalActionPhase = ["proposal", "approval", "execution"].includes(
    context.phase
  );
  if (
    externalActionPhase &&
    policy.safety.allowedActionKeys.length &&
    !policy.safety.allowedActionKeys.includes(context.actionType)
  )
    return decision(
      "ACTION_NOT_ALLOWED",
      "The action is not in the management allowlist."
    );
  const channel = context.channel || inferredChannel(context.actionType);
  if (
    externalActionPhase &&
    channel &&
    policy.safety.allowedChannels.length &&
    !policy.safety.allowedChannels.includes(channel)
  )
    return decision(
      "CHANNEL_NOT_ALLOWED",
      "The communication channel is not allowed."
    );
  if (
    externalActionPhase &&
    communicationAction(context.actionType) &&
    policy.safety.allowedTemplateIds.length &&
    (!context.templateId ||
      !policy.safety.allowedTemplateIds.includes(context.templateId))
  )
    return decision("TEMPLATE_NOT_ALLOWED", "The template is not allowed.");
  if (Number(context.actionsInRun || 0) >= policy.safety.maximumActionsPerRun)
    return decision(
      "ACTION_LIMIT_REACHED",
      "The run action limit was reached."
    );
  if (context.duplicate)
    return decision(
      "DEDUPLICATED",
      "An equivalent action already exists in the deduplication window."
    );
  if (Number(context.retryCount || 0) > policy.safety.maximumRetries)
    return decision(
      "ACTION_NOT_ALLOWED",
      "The bounded retry limit was exceeded."
    );

  if (mode === "manager_approval" && !context.managerApprovalSatisfied)
    return decision(
      "MANAGER_APPROVAL_REQUIRED",
      "Manager approval is required."
    );
  if (mode === "salesperson_approval" && !context.approvalSatisfied)
    return decision(
      "SALESPERSON_APPROVAL_REQUIRED",
      "Salesperson approval is required."
    );
  if (
    policy.requireReviewForCommunications &&
    communicationAction(context.actionType) &&
    !context.approvalSatisfied
  )
    return decision(
      "SALESPERSON_APPROVAL_REQUIRED",
      "Communication review is required."
    );
  if (
    policy.requireReviewForStageChanges &&
    stageAction(context.actionType) &&
    !context.managerApprovalSatisfied
  )
    return decision(
      "MANAGER_APPROVAL_REQUIRED",
      "CRM stage-change review is required."
    );
  if (
    policy.mode === "auto_preapproved" &&
    (mode === "automatic" ||
      (mode !== "salesperson_approval" &&
        mode !== "manager_approval" &&
        policy.autoActionTypes.includes(context.actionType)))
  )
    return decision(
      "ALLOWED_AUTOMATIC",
      "The action is explicitly pre-approved."
    );
  return context.approvalSatisfied
    ? decision("ALLOWED_AUTOMATIC", "The required approval was recorded.")
    : decision(
        "SALESPERSON_APPROVAL_REQUIRED",
        "The organisation policy requires review before execution."
      );
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function automationDeduplicationWindowMinutes(value: unknown) {
  const safety = object(object(value).safety);
  const parsed = Number(safety.deduplicationWindowMinutes ?? 1_440);
  return Number.isInteger(parsed)
    ? Math.max(1, Math.min(43_200, parsed))
    : 1_440;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  return value;
}

/** Stable action/target/effect identity used inside the configured time window. */
export function automationDeduplicationSignature(input: {
  actionType: string;
  targetLabel: string;
  payload: Record<string, unknown>;
}) {
  const keys = [
    "externalId",
    "contactExternalId",
    "companyExternalId",
    "opportunityExternalId",
    "taskExternalId",
    "to",
    "subject",
    "body",
    "title",
    "dueAt",
    "templateId",
    "templateName",
    "patch",
  ];
  return JSON.stringify(
    stableValue({
      actionType: input.actionType,
      targetLabel: input.targetLabel.trim().toLowerCase(),
      effect: Object.fromEntries(
        keys
          .filter(key => input.payload[key] !== undefined)
          .map(key => [key, input.payload[key]])
      ),
    })
  );
}

/** Evaluates the normalized stored policy, failing closed when settings are absent. */
export function evaluateStoredAutomationPolicy(
  value: unknown,
  context: AutomationEvaluationContext
) {
  const source = object(value);
  const scope = object(source.scope);
  const schedule = object(source.schedule);
  const safety = object(source.safety);
  const policy: EvaluatedPolicy = {
    mode: typeof source.mode === "string" ? source.mode : "review",
    autoActionTypes: stringList(source.autoActionTypes),
    requireReviewForCommunications:
      source.requireReviewForCommunications !== false,
    requireReviewForStageChanges: source.requireReviewForStageChanges !== false,
    monitorKeys: source.monitorKeys
      ? stringList(source.monitorKeys)
      : [
          "new_leads",
          "task_changes",
          "opportunities",
          "inbound_mail",
          "callbacks",
          "appointments",
          "stale_leads",
          "overdue_tasks",
        ],
    actionModes: Object.fromEntries(
      Object.entries(object(source.actionModes)).map(([key, mode]) => [
        key,
        String(mode),
      ])
    ),
    scope: {
      userIds: Array.isArray(scope.userIds)
        ? scope.userIds.map(Number).filter(Number.isInteger)
        : [],
      pipelineIds: stringList(scope.pipelineIds),
      leadSources: stringList(scope.leadSources),
    },
    triggerKeys: source.triggerKeys
      ? stringList(source.triggerKeys)
      : [
          "new_lead",
          "field_or_stage_change",
          "inbound_email",
          "scheduled_time",
          "overdue_task",
          "callback_due",
          "opportunity_stalled",
          "explicit_user_action",
        ],
    conditions: Object.fromEntries(
      Object.entries(object(source.conditions)).map(([key, values]) => [
        key,
        stringList(values),
      ])
    ),
    schedule: {
      mode: typeof schedule.mode === "string" ? schedule.mode : "continuous",
      timezone:
        typeof schedule.timezone === "string" ? schedule.timezone : "UTC",
      days: Array.isArray(schedule.days)
        ? schedule.days.map(Number).filter(Number.isInteger)
        : [1, 2, 3, 4, 5],
      startHour:
        schedule.startHour === undefined
          ? undefined
          : Number(schedule.startHour),
      endHour:
        schedule.endHour === undefined ? undefined : Number(schedule.endHour),
    },
    safety: {
      maximumActionsPerRun: Number(safety.maximumActionsPerRun || 25),
      deduplicationWindowMinutes: Number(
        safety.deduplicationWindowMinutes || 1_440
      ),
      maximumRetries: Number(safety.maximumRetries ?? 2),
      quietHoursEnabled: safety.quietHoursEnabled !== false,
      allowedActionKeys: stringList(safety.allowedActionKeys),
      allowedChannels: stringList(safety.allowedChannels),
      allowedTemplateIds: stringList(safety.allowedTemplateIds),
    },
  };
  return evaluateAutomationPolicy(policy, context);
}
