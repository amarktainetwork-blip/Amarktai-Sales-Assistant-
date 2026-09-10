import {
  getClientActionConfiguration,
  type ClientActionConfiguration,
  type WorkflowActionConfiguration,
} from "./clientActionConfiguration";
import {
  findConfiguredTemplate,
  materializeConfiguredCommunication,
  resolveConfiguredSender,
} from "./communicationContent";
import { getOutboundSuppressionStatus } from "./communications";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";
import {
  buildWorkflowPlan,
  type ProposedAction,
  type WorkflowPlan,
  type WorkflowRequest,
} from "./workflowRules";

const SEQUENCE_ACTIONS = new Set([
  "verify_contact_context",
  "append_contact_note",
  "schedule_callback",
  "complete_active_task",
  "update_contact_status",
  "update_contact",
  "update_current_opportunity",
  "update_opportunity",
  "send_email_template",
  "send_sms_template",
  "send_whatsapp_template",
  "apply_sequence",
]);

function safeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 100);
}

function norm(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function officeHourParts(
  officeHours: ClientActionConfiguration["officeHours"],
  now: Date
) {
  if (!officeHours) return undefined;
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(officeHours.start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(officeHours.end) ||
    !officeHours.days.length
  )
    throw new Error(
      "WORKFLOW_OFFICE_HOURS_INVALID: configure valid contact days and HH:MM start/end times."
    );
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: officeHours.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    throw new Error(
      `WORKFLOW_OFFICE_HOURS_INVALID: '${officeHours.timezone}' is not a valid configured timezone.`
    );
  }
  const weekday = parts.find(part => part.type === "weekday")?.value || "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday
  );
  const hour = Number(parts.find(part => part.type === "hour")?.value || "0");
  const minute = Number(
    parts.find(part => part.type === "minute")?.value || "0"
  );
  const [startHour, startMinute] = officeHours.start.split(":").map(Number);
  const [endHour, endMinute] = officeHours.end.split(":").map(Number);
  return {
    dayIndex,
    currentMinutes: hour * 60 + minute,
    startMinutes: startHour * 60 + startMinute,
    endMinutes: endHour * 60 + endMinute,
  };
}

export function withinConfiguredOfficeHours(
  officeHours: ClientActionConfiguration["officeHours"],
  now: Date
) {
  if (!officeHours) return true;
  const parts = officeHourParts(officeHours, now)!;
  return (
    officeHours.days.includes(parts.dayIndex) &&
    parts.currentMinutes >= parts.startMinutes &&
    parts.currentMinutes < parts.endMinutes
  );
}

function timingDurationMs(rule: string) {
  const value = rule.trim();
  const iso = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i
  );
  if (iso && iso.slice(1).some(Boolean))
    return (
      Number(iso[1] || 0) * 86_400_000 +
      Number(iso[2] || 0) * 3_600_000 +
      Number(iso[3] || 0) * 60_000
    );
  return undefined;
}

/** Resolve reusable configured cadence into one concrete, office-hours-safe due time. */
export function resolveConfiguredTimingRule(input: {
  rule: string;
  officeHours: ClientActionConfiguration["officeHours"];
  now?: Date;
}) {
  const rule = input.rule.trim();
  if (!rule) throw new Error("WORKFLOW_TIMING_REQUIRED: callback timing is empty.");
  const now = input.now || new Date();
  const duration = timingDurationMs(rule);
  let candidate: Date;
  if (duration !== undefined) candidate = new Date(now.valueOf() + duration);
  else {
    const absolute = new Date(rule);
    if (Number.isNaN(absolute.valueOf()))
      throw new Error(
        `WORKFLOW_TIMING_INVALID: '${rule}' must be an ISO duration such as P1D/PT2H or an absolute ISO date/time.`
      );
    candidate = absolute;
  }
  candidate.setUTCSeconds(0, 0);
  if (!input.officeHours) return candidate.toISOString();
  for (let minute = 0; minute <= 14 * 24 * 60; minute += 1) {
    if (withinConfiguredOfficeHours(input.officeHours, candidate))
      return candidate.toISOString();
    candidate = new Date(candidate.valueOf() + 60_000);
  }
  throw new Error(
    "WORKFLOW_TIMING_OUTSIDE_ALLOWED_WINDOW: no configured office-hours slot was found in the next 14 days."
  );
}

function matchesConfiguredStatus(value: string, configured: string[]) {
  const current = norm(value);
  return configured.some(item => norm(item) === current);
}

function assertWorkflowPreparationEligibility(
  workflow: WorkflowActionConfiguration,
  customer: ResolvedAssistantCustomerContext
) {
  const status = customer.contactStatus?.trim() || "";
  if (status && matchesConfiguredStatus(status, workflow.stopStatuses))
    throw new Error(
      `WORKFLOW_STOP_STATUS: the customer is already '${status}', which is a configured stop status. Nothing was prepared.`
    );
  if (workflow.eligibilityStatuses.length) {
    if (!status)
      throw new Error(
        "WORKFLOW_ELIGIBILITY_UNVERIFIED: the customer's current CRM status is not synchronized, so Amarktai will not guess whether this workflow is allowed."
      );
    if (!matchesConfiguredStatus(status, workflow.eligibilityStatuses))
      throw new Error(
        `WORKFLOW_NOT_ELIGIBLE: the customer's current CRM status '${status}' is not eligible for this configured workflow. Nothing was prepared.`
      );
  }
}

function assertConfiguredCurrentTask(input: {
  action: ProposedAction;
  customer: ResolvedAssistantCustomerContext;
}) {
  if (input.action.actionType !== "complete_active_task") return;
  const expected =
    typeof input.action.payload.taskTitle === "string"
      ? input.action.payload.taskTitle.trim()
      : "";
  if (!expected)
    throw new Error(
      "WORKFLOW_TASK_ALIAS_REQUIRED: a workflow that completes a task must configure the exact current task title."
    );
  const openTasks = input.customer.operationalRecordState.openTasks;
  if (openTasks.length !== 1)
    throw new Error(
      openTasks.length
        ? "WORKFLOW_CURRENT_TASK_AMBIGUOUS: more than one open task exists, so Amarktai will not guess which task to complete."
        : "WORKFLOW_CURRENT_TASK_MISSING: no current open task can be proven for this workflow."
    );
  if (norm(openTasks[0].title) !== norm(expected))
    throw new Error(
      `WORKFLOW_CURRENT_TASK_MISMATCH: expected current task '${expected}' but the CRM currently shows '${openTasks[0].title}'. Nothing was prepared.`
    );
}

function sequenceAction(
  token: string,
  leadLabel: string,
  index: number
): ProposedAction {
  const [rawAction, ...rest] = token.split(":");
  const actionType = rawAction.trim();
  const purpose = rest.join(":").trim() || actionType;
  if (!SEQUENCE_ACTIONS.has(actionType))
    throw new Error(
      `WORKFLOW_SEQUENCE_ACTION_INVALID: '${actionType}' is not an approved reusable workflow action.`
    );
  const payload: Record<string, unknown> = {
    reviewRequired: true,
    workflowToken: token,
    workflowPurpose: purpose,
    duplicateProtection:
      "Re-read the exact external record and skip when the configured postcondition is already satisfied.",
  };
  if (/^send_(?:email|sms|whatsapp)_template$/.test(actionType))
    payload.templatePurpose = purpose;
  if (
    actionType === "schedule_callback" ||
    actionType === "complete_active_task"
  )
    payload.taskPurpose = purpose;
  if (actionType === "update_contact_status") payload.statusIntent = purpose;
  if (
    actionType === "update_current_opportunity" ||
    actionType === "update_opportunity"
  )
    payload.transitionIntent = purpose;
  if (actionType === "apply_sequence") payload.sequencePurpose = purpose;
  return {
    actionType,
    title: `${actionType.replace(/_/g, " ")} · ${purpose}`,
    targetLabel: leadLabel,
    idempotencyKey: `${safeKey(leadLabel)}:configured:${String(index + 1).padStart(2, "0")}:${safeKey(actionType)}:${safeKey(purpose)}`,
    payload,
  };
}

function actionsFromConfiguration(
  base: WorkflowPlan,
  workflow: WorkflowActionConfiguration,
  leadLabel: string
) {
  if (!workflow.sequence.length) return base.actions;
  const configured = workflow.sequence.map((token, index) =>
    sequenceAction(token, leadLabel, index)
  );
  if (
    !configured.some(
      action => action.actionType === "verify_contact_context"
    )
  )
    configured.unshift(
      sequenceAction("verify_contact_context:current_customer", leadLabel, -1)
    );
  return configured;
}

function applyTaskProgression(input: {
  request: WorkflowRequest;
  workflow: WorkflowActionConfiguration;
  customer: ResolvedAssistantCustomerContext;
  actions: ProposedAction[];
}) {
  if (
    input.request.workflowKey !== "first_contact" ||
    !input.workflow.taskSequence.length
  )
    return input.actions;
  const purposes = input.workflow.taskSequence;
  const titles = purposes.map(purpose => {
    const title = input.workflow.taskAliases[purpose];
    if (!title)
      throw new Error(
        `WORKFLOW_TASK_ALIAS_REQUIRED: task sequence purpose '${purpose}' has no exact CRM task alias.`
      );
    return title;
  });
  const openTasks = input.customer.operationalRecordState.openTasks;
  if (openTasks.length !== 1)
    throw new Error(
      openTasks.length
        ? "FIRST_CONTACT_CURRENT_ATTEMPT_AMBIGUOUS: more than one open task exists, so Amarktai will not guess the current outreach attempt."
        : "FIRST_CONTACT_CURRENT_ATTEMPT_MISSING: no single open task proves the current outreach attempt."
    );
  const current = openTasks[0];
  const attemptIndex = titles.findIndex(
    title => norm(title) === norm(current.title)
  );
  if (attemptIndex < 0)
    throw new Error(
      `FIRST_CONTACT_TASK_NOT_CONFIGURED: current task '${current.title}' is not one of the configured outreach attempts.`
    );
  const finalAttempt = attemptIndex === titles.length - 1;
  const nextPurpose = finalAttempt ? undefined : purposes[attemptIndex + 1];
  const nextTitle = finalAttempt ? undefined : titles[attemptIndex + 1];
  return input.actions
    .filter(action => {
      if (
        attemptIndex > 0 &&
        /^send_(?:email|sms|whatsapp)_template$/.test(action.actionType)
      )
        return false;
      if (finalAttempt && action.actionType === "schedule_callback") return false;
      return true;
    })
    .map(action => ({
      ...action,
      payload: {
        ...action.payload,
        workflowAttempt: {
          current: attemptIndex + 1,
          maximum: titles.length,
          currentTaskExternalId: current.externalId,
          currentTaskTitle: current.title,
          finalAttempt,
        },
        ...(action.actionType === "schedule_callback" && nextPurpose && nextTitle
          ? {
              taskPurpose: nextPurpose,
              taskTitle: nextTitle,
              timingRule:
                input.workflow.timingRules[nextPurpose] ||
                input.workflow.timingRules.follow_up,
            }
          : {}),
      },
    }));
}

function uniqueStrings(...sets: string[][]) {
  return Array.from(
    new Set(sets.flat().map(item => item.trim()).filter(Boolean))
  );
}

function configuredActionMetadata(input: {
  action: ProposedAction;
  configuration: ClientActionConfiguration;
  workflow: WorkflowActionConfiguration;
  workflowKey: string;
  request: WorkflowRequest;
  customer: ResolvedAssistantCustomerContext;
  now: Date;
}) {
  const payload = input.action.payload;
  const taskPurpose =
    typeof payload.taskPurpose === "string" ? payload.taskPurpose : undefined;
  const timingRule = taskPurpose
    ? input.workflow.timingRules[taskPurpose]
    : undefined;
  const taskTitle = taskPurpose
    ? input.workflow.taskAliases[taskPurpose]
    : undefined;
  const transitionIntent =
    typeof payload.transitionIntent === "string"
      ? payload.transitionIntent
      : undefined;
  const statusIntent =
    typeof payload.statusIntent === "string"
      ? payload.statusIntent
      : undefined;
  const sequencePurpose =
    typeof payload.sequencePurpose === "string"
      ? payload.sequencePurpose
      : undefined;
  const workflowPurpose =
    typeof payload.workflowPurpose === "string"
      ? payload.workflowPurpose
      : undefined;
  const stageTransitions = transitionIntent
    ? input.workflow.opportunityStageTransitions?.[transitionIntent]
    : undefined;
  let opportunityStage = transitionIntent
    ? input.workflow.opportunityMappings[transitionIntent]
    : undefined;
  if (stageTransitions && Object.keys(stageTransitions).length) {
    const currentStage = input.customer.stage?.trim();
    if (!currentStage && input.customer.opportunityExternalId)
      throw new Error(
        "WORKFLOW_OPPORTUNITY_STAGE_UNVERIFIED: the current open opportunity stage is not synchronized, so Amarktai will not guess the closure transition."
      );
    if (currentStage) {
      const match = Object.entries(stageTransitions).find(
        ([source]) => norm(source) === norm(currentStage)
      );
      if (!match)
        throw new Error(
          `WORKFLOW_OPPORTUNITY_STAGE_UNMAPPED: current stage '${currentStage}' has no configured transition for '${transitionIntent}'. Nothing was prepared.`
        );
      opportunityStage = match[1];
    }
  }
  const contactStatus = statusIntent
    ? input.workflow.statusMappings[statusIntent] ||
      input.configuration.closureMapping[statusIntent]
    : undefined;
  const sequenceName = sequencePurpose
    ? input.workflow.sequenceMappings?.[sequencePurpose]
    : undefined;
  const opportunityFields = transitionIntent
    ? input.workflow.opportunityFieldMappings?.[transitionIntent] || {}
    : {};
  const contactFields = statusIntent
    ? input.workflow.contactFieldMappings?.[statusIntent] || {}
    : {};
  const configuredNote = workflowPurpose
    ? input.workflow.noteMappings?.[workflowPurpose]
    : undefined;
  const factualNote =
    input.action.actionType === "append_contact_note"
      ? input.request.callOutcome === "answered"
        ? input.request.conversationNotes?.trim()
        : input.request.callOutcome === "no_answer"
          ? "Follow-up call attempted: no answer."
          : input.request.callOutcome === "voicemail"
            ? "Follow-up call attempted: voicemail."
            : configuredNote
      : undefined;
  if (
    input.action.actionType === "append_contact_note" &&
    !String(payload.content || payload.note || factualNote || "").trim()
  )
    throw new Error(
      "WORKFLOW_NOTE_CONTENT_REQUIRED: no factual or configured note content is available. Nothing was prepared."
    );
  if (
    input.action.actionType === "apply_sequence" &&
    sequencePurpose &&
    !sequenceName
  )
    throw new Error(
      `WORKFLOW_SEQUENCE_REQUIRED: sequence purpose '${sequencePurpose}' has no exact CRM sequence mapping.`
    );
  const requiredPostconditions = uniqueStrings(
    input.workflow.requiredPostconditions,
    input.configuration.requiredPostconditions[input.action.actionType] || []
  );
  const duplicateRules = uniqueStrings(
    input.configuration.duplicateRules,
    input.workflow.duplicateRules
  );
  if (
    input.action.actionType === "schedule_callback" &&
    taskPurpose &&
    !taskTitle &&
    !(typeof payload.taskTitle === "string" && payload.taskTitle.trim())
  )
    throw new Error(
      `WORKFLOW_TASK_ALIAS_REQUIRED: callback purpose '${taskPurpose}' has no exact CRM task alias.`
    );
  const dueAt =
    input.action.actionType === "schedule_callback"
      ? typeof payload.dueAt === "string" && payload.dueAt.trim()
        ? payload.dueAt.trim()
        : timingRule
          ? resolveConfiguredTimingRule({
              rule: timingRule,
              officeHours: input.configuration.officeHours,
              now: input.now,
            })
          : undefined
      : undefined;
  if (input.action.actionType === "schedule_callback" && !dueAt)
    throw new Error(
      "WORKFLOW_TIMING_REQUIRED: this configured callback has no exact due time or reusable timing rule."
    );

  return {
    workflowConfiguration: {
      workflowKey: input.workflowKey,
      eligibilityStatuses: input.workflow.eligibilityStatuses,
      stopStatuses: input.workflow.stopStatuses,
      officeHours: input.configuration.officeHours || null,
    },
    ...(taskTitle && !payload.taskTitle ? { taskTitle } : {}),
    ...(timingRule && !payload.timingRule ? { timingRule } : {}),
    ...(dueAt && !payload.dueAt ? { dueAt } : {}),
    ...(opportunityStage || Object.keys(opportunityFields).length
      ? {
          patch: {
            ...(payload.patch as Record<string, unknown> | undefined),
            ...opportunityFields,
            ...(opportunityStage ? { stage: opportunityStage } : {}),
          },
        }
      : {}),
    ...(contactStatus || Object.keys(contactFields).length
      ? {
          fields: {
            ...(payload.fields as Record<string, unknown> | undefined),
            ...contactFields,
            ...(contactStatus ? { status: contactStatus } : {}),
          },
          ...(contactStatus ? { status: contactStatus } : {}),
        }
      : {}),
    ...(sequenceName ? { sequence: sequenceName } : {}),
    ...(factualNote && !payload.content ? { content: factualNote } : {}),
    duplicateRules,
    requiredPostconditions,
  };
}

async function materializeTemplateAction(input: {
  organisationId: number;
  action: ProposedAction;
  workflow: WorkflowActionConfiguration;
  configuration: ClientActionConfiguration;
  customer: ResolvedAssistantCustomerContext;
}) {
  const channel = input.action.actionType.includes("email")
    ? "email"
    : input.action.actionType.includes("sms")
      ? "sms"
      : input.action.actionType.includes("whatsapp")
        ? "whatsapp"
        : undefined;
  if (!channel) return input.action;
  const purpose =
    typeof input.action.payload.templatePurpose === "string"
      ? input.action.payload.templatePurpose
      : typeof input.action.payload.workflowPurpose === "string"
        ? input.action.payload.workflowPurpose
        : "";
  const templateKey = purpose
    ? input.workflow.templates[purpose]
    : undefined;
  if (!templateKey)
    throw new Error(
      `WORKFLOW_TEMPLATE_REQUIRED: configure the '${purpose || input.action.actionType}' ${channel.toUpperCase()} template for this workflow before it can be prepared.`
    );
  const template = findConfiguredTemplate({
    configuration: input.configuration,
    channel,
    templateKey,
  });
  if (!template)
    throw new Error(
      `WORKFLOW_TEMPLATE_NOT_FOUND: configured template key '${templateKey}' is missing or is not approved for ${channel}.`
    );
  const to = channel === "email" ? input.customer.email : input.customer.phone;
  if (!to)
    throw new Error(
      `WORKFLOW_RECIPIENT_REQUIRED: the exact normalized customer has no ${channel === "email" ? "email address" : "phone number"}.`
    );
  const materialized = await materializeConfiguredCommunication({
    organisationId: input.organisationId,
    channel,
    to,
    template,
    variables: {
      firstName: input.customer.firstName,
      lastName: input.customer.lastName,
      fullName: input.customer.contactName,
      companyName: input.customer.companyName,
    },
  });
  const senderIdentity = resolveConfiguredSender({
    configuration: input.configuration,
    channel,
    template,
  });
  const suppression = await getOutboundSuppressionStatus({
    organisationId: input.organisationId,
    message: {
      channel,
      to: materialized.to,
      subject: materialized.subject,
      body: materialized.body,
      templateName: materialized.templateName,
      contactExternalId: input.customer.contactExternalId,
      opportunityExternalId: input.customer.opportunityExternalId,
    },
  });
  if (suppression.suppressed)
    throw new Error(
      `OUTBOUND_SUPPRESSED: the exact customer is opted out or suppressed for ${channel}. Nothing was prepared.`
    );
  return {
    ...input.action,
    payload: {
      ...input.action.payload,
      to: materialized.to,
      body: materialized.body,
      ...(materialized.subject ? { subject: materialized.subject } : {}),
      templateName: materialized.templateName,
      templateKey,
      contentSource: materialized.contentSource,
      ...(senderIdentity ? { senderIdentity } : {}),
      executionOwner:
        channel === "email" ? "microsoft_delegated" : "commissioned_crm",
      actionVerification: {
        ...((input.action.payload.actionVerification as Record<string, unknown>) || {}),
        recipientVerified: true,
        senderVerified: channel === "email" ? true : Boolean(senderIdentity),
      },
      compliance: {
        ...((input.action.payload.compliance as Record<string, unknown>) || {}),
        suppressionVerified: suppression.verified,
        optedOut: false,
      },
      duplicateVerification: {
        state: "unknown",
        rule:
          "Canonical execution must re-read external activity or Microsoft Sent Items immediately before the irreversible send.",
      },
    },
  };
}

function workflowConfigurationKey(request: WorkflowRequest) {
  return request.callOutcome
    ? `${request.workflowKey}:${request.callOutcome}`
    : request.workflowKey;
}

/**
 * Minimal generic workflow materializer. Client-specific subjects, stages,
 * task names, senders, timing and sequence order are data, never engine
 * constants. Outcome-specific variants can be commissioned with keys such as
 * 'post_consultation_follow_up:answered' without teaching the engine client
 * names or statuses.
 */
export async function buildConfiguredWorkflowPlan(input: {
  organisationId: number;
  request: WorkflowRequest;
  customer: ResolvedAssistantCustomerContext;
  now?: Date;
}) {
  const configuration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const variantKey = workflowConfigurationKey(input.request);
  const workflow =
    configuration.workflows[variantKey] ||
    configuration.workflows[input.request.workflowKey];
  if (!workflow)
    throw new Error(
      `WORKFLOW_CONFIGURATION_REQUIRED: '${variantKey}' has not been commissioned for this organisation.`
    );
  assertWorkflowPreparationEligibility(workflow, input.customer);
  const base = buildWorkflowPlan(input.request);
  const configuredSource = actionsFromConfiguration(
    base,
    workflow,
    input.customer.contactName
  );
  if (
    input.request.callOutcome === "answered" &&
    input.request.agreedFollowUpAt &&
    !configuredSource.some(action => action.actionType === "schedule_callback")
  ) {
    const agreed = sequenceAction(
      "schedule_callback:agreed_follow_up",
      input.customer.contactName,
      configuredSource.length
    );
    configuredSource.push({
      ...agreed,
      idempotencyKey: `${agreed.idempotencyKey}:${safeKey(input.request.agreedFollowUpAt)}`,
      payload: {
        ...agreed.payload,
        dueAt: input.request.agreedFollowUpAt,
        agreedFromConversation: true,
      },
    });
  }
  const source = applyTaskProgression({
    request: input.request,
    workflow,
    customer: input.customer,
    actions: configuredSource,
  });
  const actions: ProposedAction[] = [];
  const skippedOptionalActions: string[] = [];
  for (const raw of source) {
    const token =
      typeof raw.payload.workflowToken === "string"
        ? raw.payload.workflowToken
        : "";
    const optional = Boolean(
      token && workflow.optionalActions?.includes(token)
    );
    if (optional && raw.actionType === "complete_active_task") {
      if (!input.customer.operationalRecordState.openTasks.length) {
        skippedOptionalActions.push(token);
        continue;
      }
      if (input.customer.operationalRecordState.openTasks.length > 1)
        throw new Error(
          "WORKFLOW_CURRENT_TASK_AMBIGUOUS: more than one open task exists, so an optional current-task step cannot be guessed."
        );
    }
    if (
      optional &&
      ["update_current_opportunity", "update_opportunity"].includes(
        raw.actionType
      )
    ) {
      if (!input.customer.operationalRecordState.openOpportunities.length) {
        skippedOptionalActions.push(token);
        continue;
      }
      if (input.customer.operationalRecordState.openOpportunities.length > 1)
        throw new Error(
          "WORKFLOW_CURRENT_OPPORTUNITY_AMBIGUOUS: more than one open opportunity exists, so an optional current-opportunity step cannot be guessed."
        );
    }
    const metadata = configuredActionMetadata({
      action: raw,
      configuration,
      workflow,
      workflowKey: variantKey,
      request: input.request,
      customer: input.customer,
      now: input.now || new Date(),
    });
    const configured: ProposedAction = {
      ...raw,
      payload: { ...raw.payload, ...metadata },
    };
    assertConfiguredCurrentTask({ action: configured, customer: input.customer });
    actions.push(
      await materializeTemplateAction({
        organisationId: input.organisationId,
        action: configured,
        workflow,
        configuration,
        customer: input.customer,
      })
    );
  }
  return {
    verificationSummary:
      `${base.verificationSummary} Client sequence, templates, task aliases, task progression, mappings, sender identities, timing, duplicate rules and postconditions were resolved from organisation configuration '${variantKey}'.${skippedOptionalActions.length ? ` Optional steps skipped because no exact current target existed: ${skippedOptionalActions.join(", ")}.` : ""}`,
    actions,
    configuration: {
      workflowKey: variantKey,
      sequence: workflow.sequence,
      taskSequence: workflow.taskSequence,
      optionalActions: workflow.optionalActions || [],
      eligibilityStatuses: workflow.eligibilityStatuses,
      stopStatuses: workflow.stopStatuses,
    },
  };
}
