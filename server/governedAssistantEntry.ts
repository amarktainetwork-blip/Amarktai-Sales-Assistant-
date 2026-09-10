import { createWorkflowRun } from "./db";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { getTodayWork } from "./today";
import { findPersonalCrmContact } from "./liveCalls/context";
import { routeConnectedSystemActionsForUser } from "./crmRouter";
import { routeSalesCommand } from "./supervisor";
import {
  resolveAssistantCustomerContext,
  type AssistantCrmSurfaceContext,
  type ResolvedAssistantCustomerContext,
} from "./assistantCustomerContext";
import {
  buildConfiguredWorkflowPlan,
  withinConfiguredOfficeHours,
} from "./configuredWorkflow";
import { getClientActionConfiguration } from "./clientActionConfiguration";
import type {
  CallOutcome,
  ProposedAction,
  WorkflowRequest,
} from "./workflowRules";
import { prepareGovernedAssistantRequest as prepareLegacyGovernedAssistantRequest } from "./governedAssistant";

export type GovernedAssistantEntryInput = {
  userId: number;
  organisationId: number;
  contactId?: number;
  command: string;
  crmContext?: AssistantCrmSurfaceContext;
};

type LegacyResult = Awaited<
  ReturnType<typeof prepareLegacyGovernedAssistantRequest>
>;

function mergeActionVerification(
  action: ProposedAction,
  customer: ResolvedAssistantCustomerContext
): ProposedAction {
  const existing =
    action.payload.actionVerification &&
    typeof action.payload.actionVerification === "object" &&
    !Array.isArray(action.payload.actionVerification)
      ? (action.payload.actionVerification as Record<string, unknown>)
      : {};
  const payload: Record<string, unknown> = {
    ...action.payload,
    contactExternalId: customer.contactExternalId,
    preferredConnectedSystemId: customer.connectedSystemId,
    preferredProvider: customer.provider,
    customerContext: {
      source: customer.targetVerification.source,
      connectedSystemId: customer.connectedSystemId,
      contactExternalId: customer.contactExternalId,
    },
    actionVerification: { ...existing, targetVerified: true },
    historicalProtection: {
      completedTasksMustRemainUntouched: true,
      historicalOpportunitiesMustRemainUntouched: true,
      historicalCompletedTaskCount:
        customer.operationalRecordState.historicalCompletedTaskCount,
      historicalClosedOpportunityCount:
        customer.operationalRecordState.historicalClosedOpportunityCount,
    },
  };
  if (action.actionType === "complete_active_task")
    payload.taskExternalId =
      customer.operationalRecordState.currentActiveTaskExternalId;
  if (
    action.actionType === "update_current_opportunity" ||
    action.actionType === "update_opportunity"
  )
    payload.opportunityExternalId =
      customer.operationalRecordState.currentActiveOpportunityExternalId;
  return {
    ...action,
    targetLabel: customer.contactName,
    idempotencyKey: `${customer.connectedSystemId}:${customer.contactExternalId}:${action.idempotencyKey}`,
    payload,
  };
}

function destructiveWorkflowBlock(
  actions: ProposedAction[],
  customer: ResolvedAssistantCustomerContext
) {
  if (
    actions.some(action => action.actionType === "complete_active_task") &&
    customer.operationalRecordState.openTasks.length !== 1
  )
    return customer.operationalRecordState.openTasks.length
      ? "I found more than one open task for this customer, so I cannot safely choose the current task. Nothing was prepared."
      : "I could not prove one current open task for this customer. Nothing was prepared.";
  if (
    actions.some(action =>
      ["update_current_opportunity", "update_opportunity"].includes(
        action.actionType
      )
    ) &&
    customer.operationalRecordState.openOpportunities.length !== 1
  )
    return customer.operationalRecordState.openOpportunities.length
      ? "I found more than one open opportunity for this customer, so I cannot safely choose the current opportunity. Historical opportunities will not be touched."
      : "I could not prove one current open opportunity for this customer. Historical opportunities will not be touched.";
  return null;
}

function callOutcomeFromCommand(command: string): CallOutcome | undefined {
  if (/\bno[ -]?answer(?:ed)?\b|\bdid(?: not|n't) answer\b/i.test(command))
    return "no_answer";
  if (/\bvoice\s*mail\b|\bvoicemail\b/i.test(command)) return "voicemail";
  if (/\banswered\b|\bspoke (?:to|with)\b|\bconnected call\b/i.test(command))
    return "answered";
  return undefined;
}

function explicitConversationNotes(command: string) {
  const match = command.match(
    /\b(?:conversation\s+notes?|call\s+notes?|notes?)\s*:\s*([\s\S]{3,12000})$/i
  );
  return match?.[1]?.trim();
}

export function workflowRequestFromCommand(input: {
  command: string;
  workflowKey: WorkflowRequest["workflowKey"];
  leadLabel: string;
}): { request?: WorkflowRequest; error?: string } {
  if (input.workflowKey !== "post_consultation_follow_up")
    return {
      request: {
        workflowKey: input.workflowKey,
        leadLabel: input.leadLabel,
      },
    };
  const callOutcome = callOutcomeFromCommand(input.command);
  if (!callOutcome)
    return {
      error:
        "Tell me whether the post-consultation call was answered, no answer, or voicemail before I prepare any follow-up.",
    };
  const conversationNotes =
    callOutcome === "answered"
      ? explicitConversationNotes(input.command)
      : undefined;
  if (callOutcome === "answered" && !conversationNotes)
    return {
      error:
        "For an answered call, add factual notes after 'Notes:' before I prepare CRM updates. I will not invent objections, commitments or next steps.",
    };
  return {
    request: {
      workflowKey: input.workflowKey,
      leadLabel: input.leadLabel,
      callOutcome,
      conversationNotes,
    },
  };
}

function actionableCallback(command: string) {
  return /\b(?:schedule|create|add|set|prepare)\b[^\n]{0,120}\b(?:callback|follow[- ]?up task)\b|\bremind me\b/i.test(
    command
  );
}

export function explicitCallbackTime(command: string) {
  const match = command.match(
    /\b(?:at|on|for)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))\b/i
  );
  if (!match) return undefined;
  const date = new Date(match[1]);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

function zonedDateParts(value: Date, timeZone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value || "0");
  const weekdayName = parts.find(part => part.type === "weekday")?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekdayName
  );
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    weekday,
    hour: number("hour"),
    minute: number("minute"),
  };
}

function localDateTimeToIso(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) {
  const desired = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute
  );
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateParts(new Date(guess), input.timeZone);
    const represented = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute
    );
    const adjustment = desired - represented;
    guess += adjustment;
    if (!adjustment) break;
  }
  const result = new Date(guess);
  const observed = zonedDateParts(result, input.timeZone);
  if (
    observed.year !== input.year ||
    observed.month !== input.month ||
    observed.day !== input.day ||
    observed.hour !== input.hour ||
    observed.minute !== input.minute
  )
    return undefined;
  return result.toISOString();
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Parses common salesperson callback language without guessing an ambiguous date or time. */
export function naturalCallbackTime(input: {
  command: string;
  timeZone?: string;
  now?: Date;
}) {
  const exact = explicitCallbackTime(input.command);
  if (exact) return exact;
  if (!input.timeZone) return undefined;
  const now = input.now || new Date();
  let current: ZonedDateParts;
  try {
    current = zonedDateParts(now, input.timeZone);
  } catch {
    return undefined;
  }

  const twelveHour = input.command.match(
    /\b(?:at|for)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i
  );
  const twentyFourHour = input.command.match(
    /\b(?:at|for)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i
  );
  if (!twelveHour && !twentyFourHour) return undefined;
  let hour = twentyFourHour ? Number(twentyFourHour[1]) : Number(twelveHour![1]);
  const minute = twentyFourHour
    ? Number(twentyFourHour[2])
    : Number(twelveHour![2] || 0);
  if (twelveHour) {
    if (hour < 1 || hour > 12) return undefined;
    const meridiem = twelveHour[3].toLowerCase();
    hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  }

  const exactDate = input.command.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const weekdayMatch = input.command.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  const relative = /\btomorrow\b/i.test(input.command)
    ? 1
    : /\btoday\b/i.test(input.command)
      ? 0
      : undefined;
  let targetBase: Date;
  let weekdayTarget: number | undefined;
  if (exactDate) {
    targetBase = new Date(
      Date.UTC(Number(exactDate[1]), Number(exactDate[2]) - 1, Number(exactDate[3]))
    );
  } else if (relative !== undefined) {
    targetBase = new Date(Date.UTC(current.year, current.month - 1, current.day));
    targetBase.setUTCDate(targetBase.getUTCDate() + relative);
  } else if (weekdayMatch) {
    weekdayTarget = WEEKDAY_INDEX[weekdayMatch[1].toLowerCase()];
    let delta = (weekdayTarget - current.weekday + 7) % 7;
    targetBase = new Date(Date.UTC(current.year, current.month - 1, current.day));
    targetBase.setUTCDate(targetBase.getUTCDate() + delta);
  } else {
    return undefined;
  }

  const build = (base: Date) =>
    localDateTimeToIso({
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour,
      minute,
      timeZone: input.timeZone!,
    });
  let result = build(targetBase);
  if (!result) return undefined;
  if (new Date(result) <= now && weekdayTarget !== undefined) {
    targetBase.setUTCDate(targetBase.getUTCDate() + 7);
    result = build(targetBase);
  }
  if (!result || new Date(result) <= now) return undefined;
  return result;
}

function mentionsAgreedFollowUpTime(command: string) {
  return (
    /\b(?:callback|call\s+(?:them|her|him|me)?\s*back|next\s+call|follow[- ]?up)\b/i.test(
      command
    ) &&
    /\b(?:today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|20\d{2}-\d{2}-\d{2})\b/i.test(
      command
    ) &&
    /\b(?:at|for)\s+(?:\d{1,2}(?::[0-5]\d)?\s*(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d)\b/i.test(
      command
    )
  );
}

async function prepareCallback(input: GovernedAssistantEntryInput) {
  if (!actionableCallback(input.command)) return undefined;
  const customer = await resolveAssistantCustomerContext({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
  });
  const route = routeSalesCommand(input.command);
  if (!customer)
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary:
        "Choose the exact customer before I prepare a callback. A displayed name is not enough for an external CRM write.",
      needsClarification: true,
      route,
    } satisfies LegacyResult;
  const configuration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const dueAt = naturalCallbackTime({
    command: input.command,
    timeZone: configuration.officeHours?.timezone,
  });
  if (!dueAt)
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary:
        "Tell me the callback day and time, for example 'Friday at 2pm' or 'tomorrow at 10am'. If your organisation has no timezone configured, use a timezone-qualified time such as 2026-09-11T14:00+02:00.",
      needsClarification: true,
      route,
    } satisfies LegacyResult;
  if (
    configuration.officeHours &&
    !withinConfiguredOfficeHours(configuration.officeHours, new Date(dueAt))
  )
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary: `That callback falls outside the configured office hours (${configuration.officeHours.start}–${configuration.officeHours.end}, ${configuration.officeHours.timezone}). Choose a permitted time.`,
      needsClarification: true,
      route,
    } satisfies LegacyResult;
  const action: ProposedAction = mergeActionVerification(
    {
      actionType: "schedule_callback",
      title: `Prepare callback for ${customer.contactName}`,
      targetLabel: customer.contactName,
      idempotencyKey: `assistant-callback:${dueAt}`,
      payload: {
        reviewRequired: true,
        taskPurpose: "assistant_requested_callback",
        taskTitle: `Callback · ${customer.contactName}`,
        dueAt,
        duplicateVerification: {
          state: "unknown",
          rule:
            "Canonical execution re-reads the exact customer's open tasks before creation.",
        },
      },
    },
    customer
  );
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const [routed] = await routeConnectedSystemActionsForUser({
    userId: input.userId,
    organisationId: input.organisationId,
    actions: [action],
    systems,
  });
  const executionRoute = routed.payload.crmRoute as
    | { routable?: boolean; reason?: string }
    | undefined;
  if (!executionRoute?.routable)
    return {
      state: "connection_not_ready" as const,
      proposalCount: 0,
      summary:
        executionRoute?.reason ||
        "The CRM does not currently have the verified task read/write capability needed for a safe callback.",
      needsClarification: false,
      route,
    } satisfies LegacyResult;
  const workflowRunId = await createWorkflowRun({
    userId: input.userId,
    organisationId: input.organisationId,
    workflowKey: "assistant_callback",
    leadLabel: customer.contactName,
    payload: {
      source: "shared_governed_assistant_entry",
      dueAt,
      contactExternalId: customer.contactExternalId,
      connectedSystemId: customer.connectedSystemId,
    },
    verificationSummary:
      "One exact customer and timezone-qualified callback were prepared. Canonical execution must re-read current tasks and skip an equivalent existing callback.",
    actions: [routed],
  });
  return {
    state: "prepared_for_review" as const,
    workflowRunId,
    proposalCount: 1,
    summary: `I prepared the callback for ${customer.contactName} for review.`,
    needsClarification: false,
    route,
    data: { dueAt },
  } satisfies LegacyResult;
}

export function configuredWorkflowBatchRequested(command: string) {
  return (
    /\b(?:process|work\s+through|handle|action|prepare)\b/i.test(command) &&
    /\b(?:overdue|due[- ]?today|due\s+today|tasks?|leads?|callbacks?)\b/i.test(
      command
    )
  );
}

function workflowTaskTitles(
  configuration: Awaited<ReturnType<typeof getClientActionConfiguration>>,
  workflowKey: WorkflowRequest["workflowKey"]
) {
  const workflow = configuration.workflows[workflowKey];
  if (!workflow) return [];
  return workflow.taskSequence.map(purpose => {
    const title = workflow.taskAliases[purpose]?.trim();
    if (!title)
      throw new Error(
        `WORKFLOW_TASK_ALIAS_REQUIRED: configured task sequence purpose '${purpose}' has no exact CRM title.`
      );
    return title;
  });
}

export function effectiveConfiguredBatchWorkflowKey(input: {
  requestedWorkflowKey: WorkflowRequest["workflowKey"];
  taskTitle: string;
  configuration: Awaited<ReturnType<typeof getClientActionConfiguration>>;
}) {
  const currentWorkflow = input.configuration.workflows[input.requestedWorkflowKey];
  const finalConfiguredTitle = currentWorkflow?.taskSequence.length
    ? currentWorkflow.taskAliases[
        currentWorkflow.taskSequence[currentWorkflow.taskSequence.length - 1]
      ]
    : undefined;
  return input.requestedWorkflowKey === "first_contact" &&
    finalConfiguredTitle &&
    input.taskTitle.trim().toLowerCase() === finalConfiguredTitle.trim().toLowerCase()
    ? ("final_close" as const)
    : input.requestedWorkflowKey;
}

/**
 * Prepares one fully governed configured workflow per exact salesperson-owned
 * due task. It never turns a complex client workflow into one bulk mutation.
 */
export async function prepareConfiguredWorkflowBatch(input: {
  userId: number;
  organisationId: number;
  command: string;
  workflowKey: WorkflowRequest["workflowKey"];
}) {
  const [today, configuration, systems] = await Promise.all([
    getTodayWork({
      userId: input.userId,
      organisationId: input.organisationId,
    }),
    getClientActionConfiguration({ organisationId: input.organisationId }),
    listConnectedSystemsForUser(input.userId, input.organisationId),
  ]);
  const configuredTitles = workflowTaskTitles(configuration, input.workflowKey);
  if (!configuredTitles.length)
    return {
      state: "blocked" as const,
      proposalCount: 0,
      summary:
        "This workflow has no configured task sequence, so Amarktai will not guess which due tasks belong to it.",
      needsClarification: false,
    };
  const normalizedCommand = input.command.toLowerCase();
  const wantsOverdue = /\boverdue\b/i.test(input.command);
  const wantsToday = /\bdue[- ]?today\b|\bdue\s+today\b/i.test(input.command);
  const sourceTasks = [
    ...(wantsOverdue || (!wantsOverdue && !wantsToday)
      ? today.queues.overdueTasks
      : []),
    ...(wantsToday || (!wantsOverdue && !wantsToday)
      ? today.queues.dueToday
      : []),
  ];
  const mentionedTitles = configuredTitles.filter(title =>
    normalizedCommand.includes(title.toLowerCase())
  );
  const allowedTitles = new Set(
    (mentionedTitles.length ? mentionedTitles : configuredTitles).map(title =>
      title.trim().toLowerCase().replace(/\s+/g, " ")
    )
  );
  const selected = sourceTasks
    .filter(task =>
      allowedTitles.has(task.title.trim().toLowerCase().replace(/\s+/g, " "))
    )
    .filter(
      (task, index, all) =>
        all.findIndex(candidate => candidate.externalId === task.externalId) ===
        index
    )
    .slice(0, 50);
  if (!selected.length)
    return {
      state: "completed" as const,
      proposalCount: 0,
      summary:
        "There are no salesperson-owned overdue or due-today tasks matching this configured contact sequence right now.",
      needsClarification: false,
    };

  const workflowRunIds: number[] = [];
  const blocked: Array<{ taskExternalId: string; reason: string }> = [];
  let proposalCount = 0;
  for (const task of selected) {
    try {
      if (!task.contactExternalId)
        throw new Error(
          "TASK_CUSTOMER_REQUIRED: the due task has no exact normalized customer link."
        );
      const contact = await findPersonalCrmContact({
        userId: input.userId,
        organisationId: input.organisationId,
        connectedSystemId: task.connectedSystemId,
        externalId: task.contactExternalId,
      });
      if (!contact)
        throw new Error(
          "TASK_CUSTOMER_NOT_OWNED: the due task does not resolve to a customer owned by this salesperson."
        );
      const customer = await resolveAssistantCustomerContext({
        userId: input.userId,
        organisationId: input.organisationId,
        contactId: contact.id,
      });
      if (!customer)
        throw new Error(
          "TASK_CUSTOMER_CONTEXT_REQUIRED: the exact customer context could not be resolved."
        );
      const effectiveWorkflowKey = effectiveConfiguredBatchWorkflowKey({
        requestedWorkflowKey: input.workflowKey,
        taskTitle: task.title,
        configuration,
      });
      if (
        effectiveWorkflowKey === "final_close" &&
        !configuration.workflows.final_close
      )
        throw new Error(
          "FINAL_CLOSE_CONFIGURATION_REQUIRED: the final configured contact attempt has no final-close workflow. Nothing was prepared."
        );
      const plan = await buildConfiguredWorkflowPlan({
        organisationId: input.organisationId,
        request: {
          workflowKey: effectiveWorkflowKey,
          leadLabel: customer.contactName,
        },
        customer,
      });
      const unsafe = destructiveWorkflowBlock(plan.actions, customer);
      if (unsafe) throw new Error(unsafe);
      const bound = plan.actions.map(action =>
        mergeActionVerification(action, customer)
      );
      const actions = await routeConnectedSystemActionsForUser({
        userId: input.userId,
        organisationId: input.organisationId,
        actions: bound,
        systems,
      });
      const unroutable = actions.find(
        action =>
          !(action.payload.crmRoute as { routable?: boolean } | undefined)
            ?.routable
      );
      if (unroutable)
        throw new Error(
          (unroutable.payload.crmRoute as { reason?: string } | undefined)
            ?.reason ||
            "A required CRM capability is not live-proven for this workflow."
        );
      const workflowRunId = await createWorkflowRun({
        userId: input.userId,
        organisationId: input.organisationId,
        workflowKey: `assistant_configured_batch:${effectiveWorkflowKey}`,
        leadLabel: customer.contactName,
        payload: {
          source: "configured_due_task_batch",
          instruction: input.command,
          sourceTaskExternalId: task.externalId,
          sourceWorkflowKey: input.workflowKey,
          effectiveWorkflowKey,
          contactExternalId: customer.contactExternalId,
          connectedSystemId: customer.connectedSystemId,
        },
        verificationSummary: plan.verificationSummary,
        actions,
      });
      workflowRunIds.push(workflowRunId);
      proposalCount += actions.length;
    } catch (error) {
      blocked.push({
        taskExternalId: task.externalId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    state: workflowRunIds.length
      ? ("prepared_for_review" as const)
      : ("blocked" as const),
    proposalCount,
    summary: workflowRunIds.length
      ? `Prepared ${workflowRunIds.length} exact customer workflow${workflowRunIds.length === 1 ? "" : "s"} for Review. ${blocked.length ? `${blocked.length} task${blocked.length === 1 ? "" : "s"} were safely skipped and flagged because their current CRM state was ambiguous or ineligible.` : "Every selected task passed preparation checks."}`
      : "None of the selected due tasks could be prepared safely. Nothing was changed.",
    needsClarification: false,
    workflowRunIds,
    blocked,
  };
}

async function prepareConfiguredWorkflow(input: GovernedAssistantEntryInput) {
  const route = routeSalesCommand(input.command);
  if (route.intent !== "workflow" || !route.workflowKey) return undefined;
  const customer = await resolveAssistantCustomerContext({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
  });
  if (!customer)
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary:
        "Choose the exact normalized customer before I prepare this workflow. Destructive CRM actions cannot target a displayed name.",
      needsClarification: true,
      route,
    } satisfies LegacyResult;
  const parsed = workflowRequestFromCommand({
    command: input.command,
    workflowKey: route.workflowKey,
    leadLabel: customer.contactName,
  });
  if (!parsed.request)
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary: parsed.error || "The workflow needs more exact information.",
      needsClarification: true,
      route,
    } satisfies LegacyResult;

  if (
    parsed.request.callOutcome === "answered" &&
    mentionsAgreedFollowUpTime(input.command)
  ) {
    const configuration = await getClientActionConfiguration({
      organisationId: input.organisationId,
    });
    const agreedFollowUpAt = naturalCallbackTime({
      command: input.command,
      timeZone: configuration.officeHours?.timezone,
    });
    if (!agreedFollowUpAt)
      return {
        state: "needs_clarification" as const,
        proposalCount: 0,
        summary:
          "I can see that a follow-up time was discussed, but I cannot resolve it safely. Give the agreed day and time explicitly, for example 'Friday at 2pm'.",
        needsClarification: true,
        route,
      } satisfies LegacyResult;
    if (
      configuration.officeHours &&
      !withinConfiguredOfficeHours(
        configuration.officeHours,
        new Date(agreedFollowUpAt)
      )
    )
      return {
        state: "needs_clarification" as const,
        proposalCount: 0,
        summary: `The agreed follow-up time is outside the configured office hours (${configuration.officeHours.start}–${configuration.officeHours.end}, ${configuration.officeHours.timezone}). Confirm a permitted time before I prepare a task.`,
        needsClarification: true,
        route,
      } satisfies LegacyResult;
    parsed.request.agreedFollowUpAt = agreedFollowUpAt;
  }
  let plan;
  try {
    plan = await buildConfiguredWorkflowPlan({
      organisationId: input.organisationId,
      request: parsed.request,
      customer,
    });
  } catch (error) {
    return {
      state: "blocked" as const,
      proposalCount: 0,
      summary: error instanceof Error ? error.message : String(error),
      needsClarification: false,
      route,
    } satisfies LegacyResult;
  }
  const unsafe = destructiveWorkflowBlock(plan.actions, customer);
  if (unsafe)
    return {
      state: "blocked" as const,
      proposalCount: 0,
      summary: unsafe,
      needsClarification: false,
      route,
      data: { operationalRecordState: customer.operationalRecordState },
    } satisfies LegacyResult;

  const bound = plan.actions.map(action =>
    mergeActionVerification(action, customer)
  );
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const actions = await routeConnectedSystemActionsForUser({
    userId: input.userId,
    organisationId: input.organisationId,
    actions: bound,
    systems,
  });
  const unroutable = actions.find(
    action =>
      !(action.payload.crmRoute as { routable?: boolean } | undefined)?.routable
  );
  if (unroutable)
    return {
      state: "connection_not_ready" as const,
      proposalCount: 0,
      summary:
        (unroutable.payload.crmRoute as { reason?: string } | undefined)
          ?.reason ||
        "A required read/write capability is not commissioned, so no partial workflow was prepared.",
      needsClarification: false,
      route,
    } satisfies LegacyResult;

  const workflowRunId = await createWorkflowRun({
    userId: input.userId,
    organisationId: input.organisationId,
    workflowKey: route.workflowKey,
    leadLabel: customer.contactName,
    payload: {
      source: "shared_governed_assistant_entry",
      command: input.command,
      contactExternalId: customer.contactExternalId,
      connectedSystemId: customer.connectedSystemId,
      workflowConfiguration: plan.configuration,
      callOutcome: parsed.request.callOutcome || null,
    },
    verificationSummary: plan.verificationSummary,
    actions,
  });
  return {
    state: "prepared_for_review" as const,
    workflowRunId,
    proposalCount: actions.length,
    summary: `I prepared ${actions.length} configured governed action${actions.length === 1 ? "" : "s"} for ${customer.contactName} to review.`,
    needsClarification: false,
    route,
  } satisfies LegacyResult;
}

/**
 * One public governed entry for both Assistant surfaces. External workflow and
 * callback intents use the configured canonical planner; all ordinary reads,
 * coaching, knowledge and direct-message drafting continue through the proven
 * Assistant service underneath it.
 */
export async function prepareGovernedAssistantRequest(
  input: GovernedAssistantEntryInput
): Promise<LegacyResult> {
  const route = routeSalesCommand(input.command);
  if (
    route.intent === "workflow" &&
    route.workflowKey &&
    !input.contactId &&
    configuredWorkflowBatchRequested(input.command)
  )
    return prepareConfiguredWorkflowBatch({
      userId: input.userId,
      organisationId: input.organisationId,
      command: input.command,
      workflowKey: route.workflowKey,
    }) as Promise<LegacyResult>;
  const workflow = await prepareConfiguredWorkflow(input);
  if (workflow) return workflow;
  const callback = await prepareCallback(input);
  if (callback) return callback;
  return prepareLegacyGovernedAssistantRequest(input);
}
