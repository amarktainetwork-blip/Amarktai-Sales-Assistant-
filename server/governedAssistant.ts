import {
  listConnectedSystemsForUser,
  loadConnectionSecret,
  loadUserConnectionSecret,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { isRuntimeConnectionStatus } from "./crm/runtimeCapabilities";
import type { NormalizedContact } from "./crm/types";
import { routeConnectedSystemActionsForUser } from "./crmRouter";
import { createWorkflowRun } from "./db";
import { getManagerWatchtower } from "./managerWatchtower";
import { getSalesWatchtower } from "./salesCommsWatchtower";
import { routeSalesCommand } from "./supervisor";
import { buildWorkflowPlan, type ProposedAction } from "./workflowRules";
import {
  requestUsesCurrentCustomerReference,
  resolveAssistantCustomerContext,
  type AssistantCrmSurfaceContext,
  type ResolvedAssistantCustomerContext,
} from "./assistantCustomerContext";
import { tryPrepareDirectAssistantAction } from "./assistantDirectActions";

type SafeCrmContext = AssistantCrmSurfaceContext;

type AssistantResult = {
  state:
    | "needs_clarification"
    | "answered"
    | "prepared_for_review"
    | "executed_and_verified"
    | "blocked"
    | "connection_not_ready";
  workflowRunId?: number;
  proposalCount: number;
  summary: string;
  needsClarification: boolean;
  route: ReturnType<typeof routeSalesCommand>;
  data?: Record<string, unknown>;
};

type ReadIntent = "contact" | "opportunity" | "tasks" | "activity" | null;

const WATCHTOWER_AGENT_KEYS = new Set([
  "sales_comms_tracker",
  "promise_tracker",
  "revenue_leakage",
  "relationship_health",
  "pipeline_hygiene",
  "attention_engine",
  "manager_watchtower",
]);

function labelFromCommand(command: string) {
  const match = command.match(
    /\b(?:for|to|with)\s+([A-Za-z][A-Za-z0-9'’ .-]{1,120}?)(?:\s+(?:on|by|at|about|regarding)\b|[?.!,]|$)/i
  );
  return match?.[1]?.trim() || "";
}

function readIntent(command: string): { intent: ReadIntent; customer: string } {
  const normalized = command.trim().toLowerCase();
  const customer = (
    command.match(
      /\b(?:find|with|for|happened with)\s+(.+?)(?:[?.!,]|$)/i
    )?.[1] || ""
  ).trim();
  if (
    /\bfind\b/.test(normalized) ||
    /what happened with/.test(normalized) ||
    /this customer/.test(normalized)
  )
    return { intent: "contact", customer };
  if (/current opportunity|opportunity/.test(normalized))
    return { intent: "opportunity", customer };
  if (/open tasks|follow[- ]?ups?/.test(normalized))
    return { intent: "tasks", customer };
  if (/recent activity|activities/.test(normalized))
    return { intent: "activity", customer };
  return { intent: null, customer: "" };
}

function callbackTiming(command: string) {
  const timing = command.match(/\bon\s+(.+?)(?:[?.!,]|$)/i)?.[1]?.trim();
  if (!timing)
    return {
      requestedTiming: undefined as string | undefined,
      dueAt: undefined as string | undefined,
    };
  const iso = timing.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (!iso)
    return {
      requestedTiming: timing,
      dueAt: undefined as string | undefined,
    };
  const dueAt = `${iso[1]}T${iso[2] || "09:00"}:00.000Z`;
  return Number.isNaN(Date.parse(dueAt))
    ? { requestedTiming: timing, dueAt: undefined as string | undefined }
    : { requestedTiming: timing, dueAt };
}

function callbackInstruction(
  command: string,
  customer: ResolvedAssistantCustomerContext,
  dueAt?: string,
  requestedTiming?: string
): ProposedAction {
  return {
    actionType: "schedule_callback",
    targetLabel: customer.contactName,
    title: `Prepare callback for ${customer.contactName}`,
    idempotencyKey: `${customer.connectedSystemId}:${customer.contactExternalId}:assistant-callback:${dueAt || "unscheduled"}`,
    payload: {
      reviewRequired: true,
      taskPurpose: "assistant_requested_callback",
      requestedInstruction: command.trim(),
      requestedTiming: requestedTiming || null,
      dueAt: dueAt || null,
      contactExternalId: customer.contactExternalId,
      preferredConnectedSystemId: customer.connectedSystemId,
      preferredProvider: customer.provider,
      customerContext: {
        source: customer.targetVerification.source,
        connectedSystemId: customer.connectedSystemId,
        contactExternalId: customer.contactExternalId,
      },
      actionVerification: { targetVerified: true },
      duplicateVerification: {
        state: "unknown",
        rule: "Check current open/future CRM tasks immediately before creation.",
      },
      historicalProtection: {
        completedTasksMustRemainUntouched: true,
        historicalCompletedTaskCount:
          customer.operationalRecordState.historicalCompletedTaskCount,
      },
      prerequisite:
        "Verify the exact customer, requested timing, and duplicate future callbacks before execution.",
    },
  };
}

function canRead(
  system: Awaited<ReturnType<typeof listConnectedSystemsForUser>>[number],
  capability: string
) {
  return (
    isRuntimeConnectionStatus(system.status) &&
    system.verifiedCapabilities.includes(capability)
  );
}

function publicContact(contact: NormalizedContact | null) {
  if (!contact) return null;
  return {
    externalId: contact.externalId,
    name:
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null,
    email: contact.email || null,
    phone: contact.phone || null,
    lifecycleStage: contact.lifecycleStage || null,
  };
}

async function secretForRead(input: {
  userId: number;
  organisationId: number;
  system: Awaited<ReturnType<typeof listConnectedSystemsForUser>>[number];
}) {
  const secretKind =
    input.system.connectionMethod === "browser" ||
    input.system.connectionMethod === "sidecar"
      ? "browser"
      : "oauth";
  if (
    input.system.connectionMethod === "browser" ||
    input.system.connectionMethod === "sidecar"
  )
    return loadUserConnectionSecret({
      userId: input.userId,
      organisationId: input.organisationId,
      connectedSystemId: input.system.id,
      secretKind,
    });
  return loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: input.system.id,
    secretKind,
  });
}

async function performSafeRead(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  command: string;
  crmContext?: SafeCrmContext;
  route: ReturnType<typeof routeSalesCommand>;
}): Promise<AssistantResult | null> {
  const request = readIntent(input.command);
  if (!request.intent) return null;
  const exactCustomer = await resolveAssistantCustomerContext({
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
  });
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const system = exactCustomer
    ? systems.find(item => item.id === exactCustomer.connectedSystemId)
    : input.crmContext?.connectedSystemId
      ? systems.find(item => item.id === input.crmContext?.connectedSystemId)
      : systems.find(
          item =>
            isRuntimeConnectionStatus(item.status) &&
            item.verifiedCapabilities.some(capability =>
              capability.endsWith(".read")
            )
        );
  if (!system)
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary: "The CRM connection is not ready for that read yet.",
      needsClarification: false,
      route: input.route,
    };

  const required =
    request.intent === "contact"
      ? "contacts.read"
      : request.intent === "opportunity"
        ? "opportunities.read"
        : request.intent === "tasks"
          ? "tasks.read"
          : "activities.read";
  if (!canRead(system, required))
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary:
        "The connected CRM does not have the verified read capability needed for that request.",
      needsClarification: false,
      route: input.route,
    };

  const adapter = getCrmAdapter(system.provider);
  const secret = await secretForRead({
    userId: input.userId,
    organisationId: input.organisationId,
    system,
  });
  if (!secret)
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary:
        system.connectionMethod === "browser" ||
        system.connectionMethod === "sidecar"
          ? "Sign in to your private CRM session before I read or act on this CRM."
          : "The CRM connection does not have an available secure session for that read.",
      needsClarification: false,
      route: input.route,
    };
  const connection = toAdapterConnection(system);
  const context = { connection, secret };

  if (request.intent === "contact") {
    if (exactCustomer) {
      const contact = await adapter.getContact({
        ...context,
        externalId: exactCustomer.contactExternalId,
      });
      if (!contact)
        return {
          state: "blocked",
          proposalCount: 0,
          summary:
            "The exact current customer is no longer readable from the CRM. Nothing was changed.",
          needsClarification: false,
          route: input.route,
        };
      return {
        state: "answered",
        proposalCount: 0,
        summary: `Here are the current CRM details for ${exactCustomer.contactName}.`,
        needsClarification: false,
        route: input.route,
        data: {
          contact: publicContact(contact),
          customerContext: exactCustomer.targetVerification,
        },
      };
    }
    if (!request.customer)
      return {
        state: "needs_clarification",
        proposalCount: 0,
        summary:
          "I cannot prove which CRM record you mean. Choose the exact customer or open a commissioned customer record; I will not infer identity from the page title.",
        needsClarification: true,
        route: input.route,
      };
    const matches = await adapter.searchContacts({
      ...context,
      query: request.customer,
    });
    if (matches.length > 1)
      return {
        state: "needs_clarification",
        proposalCount: 0,
        summary: `I found ${matches.length} matching customers. Please choose one before I read CRM details.`,
        needsClarification: true,
        route: input.route,
        data: { matches: matches.map(publicContact).filter(Boolean) },
      };
    if (!matches.length)
      return {
        state: "answered",
        proposalCount: 0,
        summary: `No CRM customer matched “${request.customer}”.`,
        needsClarification: false,
        route: input.route,
        data: { matches: [] },
      };
    const contact = await adapter.getContact({
      ...context,
      externalId: matches[0].externalId,
    });
    if (!contact)
      return {
        state: "answered",
        proposalCount: 0,
        summary: "The matching customer record is no longer available in the CRM.",
        needsClarification: false,
        route: input.route,
      };
    return {
      state: "answered",
      proposalCount: 0,
      summary: `Here are the current CRM details for ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "the selected customer"}.`,
      needsClarification: false,
      route: input.route,
      data: { contact: publicContact(contact) },
    };
  }

  if (!exactCustomer)
    return {
      state: "needs_clarification",
      proposalCount: 0,
      summary:
        "Choose the exact customer before I read customer-specific opportunities, tasks or activity. I will not return an organisation-wide list for a current-customer question.",
      needsClarification: true,
      route: input.route,
    };

  if (request.intent === "opportunity") {
    const records = (
      await adapter.syncOpportunities({ ...context })
    ).records.filter(
      item => item.contactExternalId === exactCustomer.contactExternalId
    );
    return {
      state: "answered",
      proposalCount: 0,
      summary: records.length
        ? "Here are this customer's current CRM opportunities."
        : "No opportunities were returned for this exact customer.",
      needsClarification: false,
      route: input.route,
      data: {
        opportunities: records.slice(0, 20).map(item => ({
          externalId: item.externalId,
          name: item.name,
          stage: item.stage || null,
          valueMinor: item.valueMinor || null,
          currency: item.currency || null,
        })),
      },
    };
  }
  if (request.intent === "tasks") {
    const records = (await adapter.syncTasks({ ...context })).records.filter(
      item => item.contactExternalId === exactCustomer.contactExternalId
    );
    const open = records.filter(item => !/complete|closed|done/i.test(item.status));
    return {
      state: "answered",
      proposalCount: 0,
      summary: open.length
        ? "Here are this customer's open CRM tasks."
        : "No open tasks were returned for this exact customer.",
      needsClarification: false,
      route: input.route,
      data: {
        tasks: open.slice(0, 30).map(item => ({
          externalId: item.externalId,
          title: item.title,
          status: item.status,
          dueAt: item.dueAt?.toISOString() || null,
        })),
      },
    };
  }
  const records = (await adapter.syncActivities({ ...context })).records.filter(
    item => item.contactExternalId === exactCustomer.contactExternalId
  );
  return {
    state: "answered",
    proposalCount: 0,
    summary: records.length
      ? "Here is this customer's recent CRM activity."
      : "No recent activity was returned for this exact customer.",
    needsClarification: false,
    route: input.route,
    data: {
      activities: records.slice(0, 30).map(item => ({
        externalId: item.externalId,
        activityType: item.activityType,
        occurredAt: item.occurredAt.toISOString(),
        body: item.body || null,
      })),
    },
  };
}

async function performWatchtowerAnalysis(input: {
  userId: number;
  organisationId: number;
  route: ReturnType<typeof routeSalesCommand>;
}): Promise<AssistantResult | null> {
  if (
    input.route.intent !== "analytics" ||
    !WATCHTOWER_AGENT_KEYS.has(input.route.agentKey)
  )
    return null;
  try {
    if (input.route.agentKey === "manager_watchtower") {
      const manager = await getManagerWatchtower(input);
      return {
        state: "answered",
        proposalCount: 0,
        summary: manager.summary.peopleNeedingAttention
          ? `${manager.summary.peopleNeedingAttention} mapped salesperson${manager.summary.peopleNeedingAttention === 1 ? " needs" : "s need"} attention. The watchtower is ranked from synchronized CRM exceptions only.`
          : "No mapped salesperson currently has a watchtower exception in synchronized CRM evidence.",
        needsClarification: false,
        route: input.route,
        data: { managerWatchtower: manager },
      };
    }
    const watchtower = await getSalesWatchtower({
      userId: input.userId,
      organisationId: input.organisationId,
      includePromises: input.route.agentKey === "promise_tracker",
    });
    if (input.route.agentKey === "sales_comms_tracker") {
      const waiting = watchtower.salesComms.filter(item => item.waitingOnUs).length;
      return {
        state: "answered",
        proposalCount: 0,
        summary: waiting
          ? `${waiting} customer${waiting === 1 ? " is" : "s are"} currently waiting on the team according to synchronized communication evidence.`
          : "No synchronized customer communication is currently marked as waiting on the team.",
        needsClarification: false,
        route: input.route,
        data: {
          salesComms: watchtower.salesComms,
          evidenceSummary: watchtower.evidenceSummary,
        },
      };
    }
    if (input.route.agentKey === "promise_tracker") {
      const overdue = watchtower.promises.filter(item => item.overdue).length;
      return {
        state: "answered",
        proposalCount: 0,
        summary:
          watchtower.promiseAnalysis === "unavailable"
            ? "The synchronized communication evidence is available, but promise interpretation is temporarily unavailable. No commitments were guessed."
            : `${watchtower.promises.length} explicit commitment${watchtower.promises.length === 1 ? "" : "s"} found${overdue ? `, including ${overdue} overdue` : ""}.`,
        needsClarification: false,
        route: input.route,
        data: {
          promises: watchtower.promises,
          analysisStatus: watchtower.promiseAnalysis,
          evidenceSummary: watchtower.evidenceSummary,
        },
      };
    }
    if (input.route.agentKey === "revenue_leakage")
      return {
        state: "answered",
        proposalCount: 0,
        summary: watchtower.revenueLeakage.length
          ? `${watchtower.revenueLeakage.length} evidence-backed revenue-risk item${watchtower.revenueLeakage.length === 1 ? "" : "s"} need attention.`
          : "No revenue-leakage exception is currently visible in synchronized CRM evidence.",
        needsClarification: false,
        route: input.route,
        data: {
          revenueLeakage: watchtower.revenueLeakage,
          evidenceSummary: watchtower.evidenceSummary,
        },
      };
    if (input.route.agentKey === "relationship_health") {
      const highRisk = watchtower.customerHealth.filter(
        item => item.status === "high_risk"
      ).length;
      return {
        state: "answered",
        proposalCount: 0,
        summary: highRisk
          ? `${highRisk} active deal${highRisk === 1 ? " is" : "s are"} currently high risk based on explainable CRM evidence.`
          : "No active deal is currently classified high risk by the operational health rules.",
        needsClarification: false,
        route: input.route,
        data: {
          customerHealth: watchtower.customerHealth,
          evidenceSummary: watchtower.evidenceSummary,
        },
      };
    }
    if (input.route.agentKey === "pipeline_hygiene")
      return {
        state: "answered",
        proposalCount: 0,
        summary: watchtower.pipelineHygiene.length
          ? `${watchtower.pipelineHygiene.length} active pipeline record${watchtower.pipelineHygiene.length === 1 ? " has" : "s have"} a hygiene issue to review.`
          : "No active pipeline hygiene exception is currently visible in synchronized CRM evidence.",
        needsClarification: false,
        route: input.route,
        data: {
          pipelineHygiene: watchtower.pipelineHygiene,
          evidenceSummary: watchtower.evidenceSummary,
        },
      };
    return {
      state: "answered",
      proposalCount: 0,
      summary: watchtower.attention.length
        ? `I ranked ${watchtower.attention.length} customer attention item${watchtower.attention.length === 1 ? "" : "s"} from the current CRM evidence. The first item is the strongest operational exception, not an autonomous instruction to contact the customer.`
        : "There is no current CRM exception requiring a ranked next action.",
      needsClarification: false,
      route: input.route,
      data: {
        attention: watchtower.attention,
        evidenceSummary: watchtower.evidenceSummary,
      },
    };
  } catch (error) {
    return {
      state: "blocked",
      proposalCount: 0,
      summary:
        error instanceof Error
          ? error.message
          : "Sales intelligence could not be produced safely from the current CRM evidence.",
      needsClarification: false,
      route: input.route,
    };
  }
}

function bindWorkflowActionToCustomer(
  action: ProposedAction,
  customer: ResolvedAssistantCustomerContext
): ProposedAction {
  const payload = {
    ...action.payload,
    contactExternalId: customer.contactExternalId,
    preferredConnectedSystemId: customer.connectedSystemId,
    preferredProvider: customer.provider,
    customerContext: {
      source: customer.targetVerification.source,
      connectedSystemId: customer.connectedSystemId,
      contactExternalId: customer.contactExternalId,
    },
    actionVerification: { targetVerified: true },
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
    return {
      ...action,
      targetLabel: customer.contactName,
      idempotencyKey: `${customer.connectedSystemId}:${customer.contactExternalId}:${action.idempotencyKey}`,
      payload: {
        ...payload,
        taskExternalId:
          customer.operationalRecordState.currentActiveTaskExternalId,
      },
    };
  if (
    action.actionType === "update_current_opportunity" ||
    action.actionType === "update_opportunity"
  )
    return {
      ...action,
      targetLabel: customer.contactName,
      idempotencyKey: `${customer.connectedSystemId}:${customer.contactExternalId}:${action.idempotencyKey}`,
      payload: {
        ...payload,
        opportunityExternalId:
          customer.operationalRecordState.currentActiveOpportunityExternalId,
      },
    };
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

/** The one governed path for normal and live-CRM assistant action requests. */
export async function prepareGovernedAssistantRequest(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  command: string;
  crmContext?: SafeCrmContext;
}): Promise<AssistantResult> {
  const command = input.command.trim();
  const route = routeSalesCommand(command);

  const directAction = await tryPrepareDirectAssistantAction({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
    request: command,
  });
  if (directAction)
    return {
      state: directAction.reviewRequired
        ? "prepared_for_review"
        : directAction.workflowRunId
          ? "executed_and_verified"
          : "blocked",
      workflowRunId: directAction.workflowRunId,
      proposalCount: directAction.proposalCount || 0,
      summary: directAction.content,
      needsClarification: false,
      route,
      data: directAction.actionPreview
        ? { actionPreview: directAction.actionPreview }
        : undefined,
    };

  const safeRead = await performSafeRead({ ...input, command, route });
  if (safeRead) return safeRead;
  const watchtower = await performWatchtowerAnalysis({ ...input, route });
  if (watchtower) return watchtower;

  const currentReference = requestUsesCurrentCustomerReference(command);
  const exactCustomer = await resolveAssistantCustomerContext({
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
  });
  const requestedLabel = labelFromCommand(command);
  const leadLabel = exactCustomer?.contactName || requestedLabel;
  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const browserSystem = input.crmContext?.connectedSystemId
    ? systems.find(system => system.id === input.crmContext?.connectedSystemId)
    : undefined;
  if (input.crmContext && !browserSystem)
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary: "The CRM connection is not ready for that request yet.",
      needsClarification: false,
      route,
    };
  if ((currentReference || input.contactId) && !exactCustomer)
    return {
      state: "needs_clarification",
      proposalCount: 0,
      summary:
        "I cannot prove the exact current CRM customer. Open a commissioned customer record or choose the customer explicitly; I will not guess from a displayed name.",
      needsClarification: true,
      route,
    };

  if (/\b(callback|follow[- ]?up task|remind me)\b/i.test(command)) {
    if (!exactCustomer)
      return {
        state: "needs_clarification",
        proposalCount: 0,
        summary:
          "Choose the exact customer before I prepare a callback. A name in natural language is not enough for an external CRM write.",
        needsClarification: true,
        route,
      };
    const timing = callbackTiming(command);
    if (timing.requestedTiming && !timing.dueAt)
      return {
        state: "needs_clarification",
        proposalCount: 0,
        summary: `Please provide a date and time with a timezone for “${timing.requestedTiming}” before I prepare that callback.`,
        needsClarification: true,
        route,
        data: { requestedTiming: timing.requestedTiming },
      };
    const actions = await routeConnectedSystemActionsForUser({
      userId: input.userId,
      organisationId: input.organisationId,
      actions: [
        callbackInstruction(
          command,
          exactCustomer,
          timing.dueAt,
          timing.requestedTiming
        ),
      ],
      systems,
    });
    const routable = Boolean(
      (actions[0]?.payload.crmRoute as { routable?: boolean } | undefined)
        ?.routable
    );
    if (!routable)
      return {
        state: "connection_not_ready",
        proposalCount: 0,
        summary: "The CRM connection is not ready to prepare that callback yet.",
        needsClarification: false,
        route,
      };
    const workflowRunId = await createWorkflowRun({
      userId: input.userId,
      organisationId: input.organisationId,
      workflowKey: "assistant_callback",
      leadLabel,
      payload: {
        command,
        crmContext: input.crmContext || null,
        requestedTiming: timing.requestedTiming || null,
        dueAt: timing.dueAt || null,
        contactExternalId: exactCustomer.contactExternalId,
      },
      verificationSummary:
        "A callback is prepared for one exact normalized customer. Execution must re-check current tasks, timing, duplicate state and CRM readback.",
      actions,
    });
    return {
      state: "prepared_for_review",
      workflowRunId,
      proposalCount: actions.length,
      summary: `I prepared a callback for ${leadLabel} for review.`,
      needsClarification: false,
      route,
      data: {
        dueAt: timing.dueAt || null,
        requestedTiming: timing.requestedTiming || null,
      },
    };
  }

  if (route.intent !== "workflow" || !route.workflowKey)
    return {
      state:
        route.intent === "clarification" ? "needs_clarification" : "answered",
      proposalCount: 0,
      summary:
        route.intent === "clarification"
          ? "Please identify the customer and intended outcome so I can prepare governed work safely."
          : route.summary,
      needsClarification: route.intent === "clarification",
      route,
    };
  if (!exactCustomer)
    return {
      state: "needs_clarification",
      proposalCount: 0,
      summary:
        "Choose the exact normalized customer before I prepare this workflow. Destructive CRM actions cannot target a person by name alone.",
      needsClarification: true,
      route,
    };

  const plan = buildWorkflowPlan({
    workflowKey: route.workflowKey,
    leadLabel: exactCustomer.contactName,
  });
  const unsafe = destructiveWorkflowBlock(plan.actions, exactCustomer);
  if (unsafe)
    return {
      state: "blocked",
      proposalCount: 0,
      summary: unsafe,
      needsClarification: false,
      route,
      data: { operationalRecordState: exactCustomer.operationalRecordState },
    };
  const bound = plan.actions.map(action =>
    bindWorkflowActionToCustomer(action, exactCustomer)
  );
  const actions = await routeConnectedSystemActionsForUser({
    userId: input.userId,
    organisationId: input.organisationId,
    actions: bound,
    systems,
  });
  const unroutable = actions.filter(
    action =>
      !(action.payload.crmRoute as { routable?: boolean } | undefined)?.routable
  );
  if (unroutable.length)
    return {
      state: "connection_not_ready",
      proposalCount: 0,
      summary:
        (unroutable[0].payload.crmRoute as { reason?: string } | undefined)
          ?.reason ||
        "At least one required execution capability is not ready, so I did not prepare a partial workflow.",
      needsClarification: false,
      route,
    };
  const workflowRunId = await createWorkflowRun({
    userId: input.userId,
    organisationId: input.organisationId,
    workflowKey: route.workflowKey,
    leadLabel: exactCustomer.contactName,
    payload: {
      command,
      crmContext: input.crmContext || null,
      contactExternalId: exactCustomer.contactExternalId,
      connectedSystemId: exactCustomer.connectedSystemId,
    },
    verificationSummary: plan.verificationSummary,
    actions,
  });
  return {
    state: "prepared_for_review",
    workflowRunId,
    proposalCount: actions.length,
    summary: `I prepared ${actions.length} governed action${actions.length === 1 ? "" : "s"} for ${exactCustomer.contactName} to review.`,
    needsClarification: false,
    route,
  };
}
