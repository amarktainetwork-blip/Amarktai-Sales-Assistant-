import { listConnectedSystemsForUser } from "./connectedSystems";
import { routeConnectedSystemActions } from "./crmRouter";
import { createWorkflowRun } from "./db";
import { routeSalesCommand } from "./supervisor";
import { buildWorkflowPlan } from "./workflowRules";

type SafeCrmContext = {
  connectedSystemId?: number;
  authorisedUrlPath?: string;
  pageTitle?: string;
  provider?: string;
  control?: string;
};

type AssistantResult = {
  state: "needs_clarification" | "answered" | "prepared_for_review" | "executed_and_verified" | "blocked" | "connection_not_ready";
  workflowRunId?: number;
  proposalCount: number;
  summary: string;
  needsClarification: boolean;
  route: ReturnType<typeof routeSalesCommand>;
};

function labelFromCommand(command: string) {
  const match = command.match(/\b(?:for|to|with)\s+([A-Za-z][A-Za-z0-9'’ .-]{1,120}?)(?:\s+(?:on|by|at|about|regarding)\b|[?.!,]|$)/i);
  return match?.[1]?.trim() || "";
}

function callbackInstruction(command: string, leadLabel: string) {
  return {
    actionType: "schedule_callback",
    targetLabel: leadLabel,
    title: `Prepare callback for ${leadLabel}`,
    idempotencyKey: `${leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:assistant-callback`,
    payload: {
      reviewRequired: true,
      taskPurpose: "assistant_requested_callback",
      requestedInstruction: command.trim(),
      prerequisite: "Verify the customer record, requested timing, and duplicate future callbacks before execution.",
    },
  };
}

/**
 * The only preparation path used by both normal and live-CRM assistant calls.
 * It creates reviewable workflow proposals; it never makes a direct browser or
 * CRM write and therefore never reports execution before readback has occurred.
 */
export async function prepareGovernedAssistantRequest(input: {
  userId: number;
  organisationId: number;
  command: string;
  crmContext?: SafeCrmContext;
}): Promise<AssistantResult> {
  const command = input.command.trim();
  const route = routeSalesCommand(command);
  const leadLabel = labelFromCommand(command);
  const systems = await listConnectedSystemsForUser(input.userId, input.organisationId);
  const browserSystem = input.crmContext?.connectedSystemId
    ? systems.find(system => system.id === input.crmContext?.connectedSystemId)
    : undefined;

  if (input.crmContext && !browserSystem) {
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary: "The CRM connection is not ready for that request yet.",
      needsClarification: false,
      route,
    };
  }

  if (/\b(callback|follow[- ]?up task|remind me)\b/i.test(command)) {
    if (!leadLabel)
      return { state: "needs_clarification", proposalCount: 0, summary: "Please identify the customer before I prepare a callback for review.", needsClarification: true, route };
    const actions = routeConnectedSystemActions([callbackInstruction(command, leadLabel)], systems);
    const routable = Boolean((actions[0]?.payload.crmRoute as { routable?: boolean } | undefined)?.routable);
    if (!routable)
      return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready to prepare that callback yet.", needsClarification: false, route };
    const workflowRunId = await createWorkflowRun({
      userId: input.userId,
      organisationId: input.organisationId,
      workflowKey: "assistant_callback",
      leadLabel,
      payload: { command, crmContext: input.crmContext || null },
      verificationSummary: "A callback is prepared for human review. Execution must verify its target, prevent duplicates, and read back the CRM result.",
      actions,
    });
    return { state: "prepared_for_review", workflowRunId, proposalCount: actions.length, summary: `I prepared a callback for ${leadLabel} for review.`, needsClarification: false, route };
  }

  if (route.intent !== "workflow" || !route.workflowKey) {
    return {
      state: route.intent === "clarification" ? "needs_clarification" : "answered",
      proposalCount: 0,
      summary: route.intent === "clarification"
        ? "Please identify the customer and intended outcome so I can prepare governed work safely."
        : route.summary,
      needsClarification: route.intent === "clarification",
      route,
    };
  }
  if (!leadLabel)
    return { state: "needs_clarification", proposalCount: 0, summary: "Please identify the customer before I prepare this workflow for review.", needsClarification: true, route };

  const plan = buildWorkflowPlan({ workflowKey: route.workflowKey, leadLabel });
  const actions = routeConnectedSystemActions(plan.actions, systems);
  const routable = actions.some(action => (action.payload.crmRoute as { routable?: boolean } | undefined)?.routable);
  if (!routable)
    return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready to prepare that work yet.", needsClarification: false, route };
  const workflowRunId = await createWorkflowRun({
    userId: input.userId,
    organisationId: input.organisationId,
    workflowKey: route.workflowKey,
    leadLabel,
    payload: { command, crmContext: input.crmContext || null },
    verificationSummary: plan.verificationSummary,
    actions,
  });
  return {
    state: "prepared_for_review",
    workflowRunId,
    proposalCount: actions.length,
    summary: `I prepared ${actions.length} governed action${actions.length === 1 ? "" : "s"} for ${leadLabel} to review.`,
    needsClarification: false,
    route,
  };
}
