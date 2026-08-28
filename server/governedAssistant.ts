import {
  listConnectedSystemsForUser,
  loadConnectionSecret,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { isRuntimeConnectionStatus } from "./crm/runtimeCapabilities";
import type { NormalizedContact } from "./crm/types";
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
  data?: Record<string, unknown>;
};

type ReadIntent = "contact" | "opportunity" | "tasks" | "activity" | null;

function labelFromCommand(command: string) {
  const match = command.match(/\b(?:for|to|with)\s+([A-Za-z][A-Za-z0-9'’ .-]{1,120}?)(?:\s+(?:on|by|at|about|regarding)\b|[?.!,]|$)/i);
  return match?.[1]?.trim() || "";
}

function readIntent(command: string): { intent: ReadIntent; customer: string } {
  const normalized = command.trim().toLowerCase();
  const customer = (command.match(/\b(?:find|with|for|happened with)\s+(.+?)(?:[?.!,]|$)/i)?.[1] || "").trim();
  if (/\bfind\b/.test(normalized) || /what happened with/.test(normalized) || /this customer/.test(normalized)) return { intent: "contact", customer };
  if (/current opportunity|opportunity/.test(normalized)) return { intent: "opportunity", customer };
  if (/open tasks|follow[- ]?ups?/.test(normalized)) return { intent: "tasks", customer };
  if (/recent activity|activities/.test(normalized)) return { intent: "activity", customer };
  return { intent: null, customer: "" };
}

function callbackTiming(command: string) {
  const timing = command.match(/\bon\s+(.+?)(?:[?.!,]|$)/i)?.[1]?.trim();
  if (!timing) return { requestedTiming: undefined as string | undefined, dueAt: undefined as string | undefined };
  const iso = timing.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (!iso) return { requestedTiming: timing, dueAt: undefined as string | undefined };
  const dueAt = `${iso[1]}T${iso[2] || "09:00"}:00.000Z`;
  return Number.isNaN(Date.parse(dueAt))
    ? { requestedTiming: timing, dueAt: undefined as string | undefined }
    : { requestedTiming: timing, dueAt };
}

function callbackInstruction(command: string, leadLabel: string, dueAt?: string, requestedTiming?: string) {
  return {
    actionType: "schedule_callback",
    targetLabel: leadLabel,
    title: `Prepare callback for ${leadLabel}`,
    idempotencyKey: `${leadLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}:assistant-callback:${dueAt || "unscheduled"}`,
    payload: {
      reviewRequired: true,
      taskPurpose: "assistant_requested_callback",
      requestedInstruction: command.trim(),
      requestedTiming: requestedTiming || null,
      dueAt: dueAt || null,
      prerequisite: "Verify the customer record, requested timing, and duplicate future callbacks before execution.",
    },
  };
}

function canRead(system: Awaited<ReturnType<typeof listConnectedSystemsForUser>>[number], capability: string) {
  return isRuntimeConnectionStatus(system.status) && system.verifiedCapabilities.includes(capability);
}

function publicContact(contact: NormalizedContact | null) {
  if (!contact) return null;
  return {
    externalId: contact.externalId,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
    email: contact.email || null,
    phone: contact.phone || null,
    lifecycleStage: contact.lifecycleStage || null,
  };
}

async function performSafeRead(input: {
  userId: number;
  organisationId: number;
  command: string;
  crmContext?: SafeCrmContext;
  route: ReturnType<typeof routeSalesCommand>;
}): Promise<AssistantResult | null> {
  const request = readIntent(input.command);
  if (!request.intent) return null;
  const systems = await listConnectedSystemsForUser(input.userId, input.organisationId);
  const system = input.crmContext?.connectedSystemId
    ? systems.find(item => item.id === input.crmContext?.connectedSystemId)
    : systems.find(item => isRuntimeConnectionStatus(item.status) && item.verifiedCapabilities.some(capability => capability.endsWith(".read")));
  if (!system)
    return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready for that read yet.", needsClarification: false, route: input.route };

  const required = request.intent === "contact" ? "contacts.read" : request.intent === "opportunity" ? "opportunities.read" : request.intent === "tasks" ? "tasks.read" : "activities.read";
  if (!canRead(system, required))
    return { state: "connection_not_ready", proposalCount: 0, summary: "The connected CRM does not have the verified read capability needed for that request.", needsClarification: false, route: input.route };

  const adapter = getCrmAdapter(system.provider);
  const secret = await loadConnectionSecret({ organisationId: input.organisationId, connectedSystemId: system.id, secretKind: system.connectionMethod === "browser" ? "browser" : "oauth" });
  if (!secret)
    return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection does not have an available secure session for that read.", needsClarification: false, route: input.route };
  const connection = toAdapterConnection(system);
  const context = { connection, secret };

  if (request.intent === "contact") {
    if (!request.customer)
      return { state: "needs_clarification", proposalCount: 0, summary: "Please identify the customer you want me to look up.", needsClarification: true, route: input.route };
    const matches = await adapter.searchContacts({ ...context, query: request.customer });
    if (matches.length > 1)
      return { state: "needs_clarification", proposalCount: 0, summary: `I found ${matches.length} matching customers. Please choose one before I read CRM details.`, needsClarification: true, route: input.route, data: { matches: matches.map(publicContact).filter(Boolean) } };
    if (!matches.length)
      return { state: "answered", proposalCount: 0, summary: `No CRM customer matched “${request.customer}”.`, needsClarification: false, route: input.route, data: { matches: [] } };
    const contact = await adapter.getContact({ ...context, externalId: matches[0].externalId });
    if (!contact)
      return { state: "answered", proposalCount: 0, summary: "The matching customer record is no longer available in the CRM.", needsClarification: false, route: input.route };
    return { state: "answered", proposalCount: 0, summary: `Here are the current CRM details for ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "this customer"}.`, needsClarification: false, route: input.route, data: { contact: publicContact(contact) } };
  }

  if (request.intent === "opportunity") {
    const records = (await adapter.syncOpportunities({ ...context })).records;
    return { state: "answered", proposalCount: 0, summary: records.length ? "Here are the current opportunities returned by the verified CRM." : "No current opportunities were returned by the CRM.", needsClarification: false, route: input.route, data: { opportunities: records.slice(0, 20).map(item => ({ externalId: item.externalId, name: item.name, stage: item.stage || null, valueMinor: item.valueMinor || null, currency: item.currency || null })) } };
  }
  if (request.intent === "tasks") {
    const records = (await adapter.syncTasks({ ...context })).records;
    const open = records.filter(item => !/complete|closed|done/i.test(item.status));
    return { state: "answered", proposalCount: 0, summary: open.length ? "Here are the open tasks returned by the verified CRM." : "No open tasks were returned by the CRM.", needsClarification: false, route: input.route, data: { tasks: open.slice(0, 30).map(item => ({ externalId: item.externalId, title: item.title, status: item.status, dueAt: item.dueAt?.toISOString() || null })) } };
  }
  const records = (await adapter.syncActivities({ ...context })).records;
  return { state: "answered", proposalCount: 0, summary: records.length ? "Here is the recent activity returned by the verified CRM." : "No recent activity was returned by the CRM.", needsClarification: false, route: input.route, data: { activities: records.slice(0, 30).map(item => ({ externalId: item.externalId, activityType: item.activityType, occurredAt: item.occurredAt.toISOString(), body: item.body || null })) } };
}

/** The one governed path for normal and live-CRM assistant requests. */
export async function prepareGovernedAssistantRequest(input: {
  userId: number;
  organisationId: number;
  command: string;
  crmContext?: SafeCrmContext;
}): Promise<AssistantResult> {
  const command = input.command.trim();
  const route = routeSalesCommand(command);
  const safeRead = await performSafeRead({ ...input, command, route });
  if (safeRead) return safeRead;
  const leadLabel = labelFromCommand(command);
  const systems = await listConnectedSystemsForUser(input.userId, input.organisationId);
  const browserSystem = input.crmContext?.connectedSystemId ? systems.find(system => system.id === input.crmContext?.connectedSystemId) : undefined;
  if (input.crmContext && !browserSystem)
    return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready for that request yet.", needsClarification: false, route };

  if (/\b(callback|follow[- ]?up task|remind me)\b/i.test(command)) {
    if (!leadLabel) return { state: "needs_clarification", proposalCount: 0, summary: "Please identify the customer before I prepare a callback for review.", needsClarification: true, route };
    const timing = callbackTiming(command);
    if (timing.requestedTiming && !timing.dueAt)
      return { state: "needs_clarification", proposalCount: 0, summary: `Please provide a date and time with a timezone for “${timing.requestedTiming}” before I prepare that callback.`, needsClarification: true, route, data: { requestedTiming: timing.requestedTiming } };
    const actions = routeConnectedSystemActions([callbackInstruction(command, leadLabel, timing.dueAt, timing.requestedTiming)], systems);
    const routable = Boolean((actions[0]?.payload.crmRoute as { routable?: boolean } | undefined)?.routable);
    if (!routable) return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready to prepare that callback yet.", needsClarification: false, route };
    const workflowRunId = await createWorkflowRun({ userId: input.userId, organisationId: input.organisationId, workflowKey: "assistant_callback", leadLabel, payload: { command, crmContext: input.crmContext || null, requestedTiming: timing.requestedTiming || null, dueAt: timing.dueAt || null }, verificationSummary: "A callback is prepared for human review. Execution must verify its target, due time, duplicates, and CRM readback.", actions });
    return { state: "prepared_for_review", workflowRunId, proposalCount: actions.length, summary: `I prepared a callback for ${leadLabel} for review.`, needsClarification: false, route, data: { dueAt: timing.dueAt || null, requestedTiming: timing.requestedTiming || null } };
  }

  if (route.intent !== "workflow" || !route.workflowKey)
    return { state: route.intent === "clarification" ? "needs_clarification" : "answered", proposalCount: 0, summary: route.intent === "clarification" ? "Please identify the customer and intended outcome so I can prepare governed work safely." : route.summary, needsClarification: route.intent === "clarification", route };
  if (!leadLabel) return { state: "needs_clarification", proposalCount: 0, summary: "Please identify the customer before I prepare this workflow for review.", needsClarification: true, route };

  const plan = buildWorkflowPlan({ workflowKey: route.workflowKey, leadLabel });
  const actions = routeConnectedSystemActions(plan.actions, systems);
  const routable = actions.some(action => (action.payload.crmRoute as { routable?: boolean } | undefined)?.routable);
  if (!routable) return { state: "connection_not_ready", proposalCount: 0, summary: "The CRM connection is not ready to prepare that work yet.", needsClarification: false, route };
  const workflowRunId = await createWorkflowRun({ userId: input.userId, organisationId: input.organisationId, workflowKey: route.workflowKey, leadLabel, payload: { command, crmContext: input.crmContext || null }, verificationSummary: plan.verificationSummary, actions });
  return { state: "prepared_for_review", workflowRunId, proposalCount: actions.length, summary: `I prepared ${actions.length} governed action${actions.length === 1 ? "" : "s"} for ${leadLabel} to review.`, needsClarification: false, route };
}
