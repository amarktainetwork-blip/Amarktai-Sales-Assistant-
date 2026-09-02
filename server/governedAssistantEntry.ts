import { createWorkflowRun } from "./db";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { routeConnectedSystemActionsForUser } from "./crmRouter";
import { routeSalesCommand } from "./supervisor";
import {
  resolveAssistantCustomerContext,
  type AssistantCrmSurfaceContext,
  type ResolvedAssistantCustomerContext,
} from "./assistantCustomerContext";
import { buildConfiguredWorkflowPlan } from "./configuredWorkflow";
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

async function prepareCallback(input: GovernedAssistantEntryInput) {
  if (!actionableCallback(input.command)) return undefined;
  const customer = await resolveAssistantCustomerContext({
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
  const dueAt = explicitCallbackTime(input.command);
  if (!dueAt)
    return {
      state: "needs_clarification" as const,
      proposalCount: 0,
      summary:
        "Provide the callback time as an exact ISO date/time with timezone, for example 2026-09-03T10:00+02:00. I will not guess the timezone for an external task.",
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

async function prepareConfiguredWorkflow(input: GovernedAssistantEntryInput) {
  const route = routeSalesCommand(input.command);
  if (route.intent !== "workflow" || !route.workflowKey) return undefined;
  const customer = await resolveAssistantCustomerContext({
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
  const workflow = await prepareConfiguredWorkflow(input);
  if (workflow) return workflow;
  const callback = await prepareCallback(input);
  if (callback) return callback;
  return prepareLegacyGovernedAssistantRequest(input);
}
