import {
  getPersonalMailboxStatus,
  type PersonalMailboxProvider,
} from "./personalMailboxRuntime";
import {
  isCustomOperationKey,
  productionOperationAvailable,
  type RuntimeLearnedOperation,
} from "./crm/runtimeCapabilities";

export type ConnectedSystemRoute = {
  id: number;
  provider: string;
  displayName: string;
  status: string;
  connectionMethod: string;
  verifiedCapabilities: string[];
  learnedOperations?: RuntimeLearnedOperation[];
  configuration?: Record<string, unknown>;
};

export type PersonalMailboxRouteContext = {
  connected: boolean;
  provider?: PersonalMailboxProvider;
  mailbox?: string;
  capabilities?: {
    sendEmail: boolean;
    inboxSync: boolean;
    calendar: boolean;
    sentReadback: boolean;
  };
};

/**
 * A mutable action is production-routable only when the same connector can
 * both perform the write and read enough external state to verify target,
 * duplicate/precondition state, or the requested postcondition. This keeps a
 * green write capability from becoming an apparently executable route that
 * cannot be governed safely at execution time.
 */
export const ACTION_CONNECTED_CAPABILITIES: Record<string, string[][]> = {
  verify_contact_context: [["contacts.read"]],
  append_contact_note: [
    ["notes.read", "notes.write"],
    ["activities.read", "activities.write"],
  ],
  schedule_callback: [["tasks.read", "tasks.write"]],
  complete_active_task: [["tasks.read", "tasks.write"]],
  update_contact_status: [["contacts.read", "contacts.write"]],
  update_contact: [["contacts.read", "contacts.write"]],
  create_contact: [["contacts.write"]],
  create_company: [["companies.write"]],
  update_current_opportunity: [["opportunities.read", "opportunities.write"]],
  update_opportunity: [["opportunities.read", "opportunities.write"]],
  create_opportunity: [["opportunities.write"]],
  create_activity: [["activities.write"]],
  send_email_template: [["email.send"]],
  send_email: [["email.send"]],
  send_sms_template: [["activities.read", "sms.send"]],
  send_sms: [["activities.read", "sms.send"]],
  send_whatsapp_template: [["activities.read", "whatsapp.send"]],
  send_whatsapp: [["activities.read", "whatsapp.send"]],
  apply_sequence: [["activities.read", "sequences.apply"]],
};

function isBrowserConnection(system: ConnectedSystemRoute) {
  return (
    system.connectionMethod === "browser" || system.connectionMethod === "sidecar"
  );
}

export function connectedSystemSupportsAction(
  system: ConnectedSystemRoute,
  actionType: string,
  customOperationKey?: string
) {
  if (actionType === "custom_crm_action") {
    if (!isBrowserConnection(system)) return false;
    // Approved-action execution re-selects the exact already-routed browser
    // connection from the database before the browser adapter performs its own
    // authoritative requireRuntimeBrowserOperation() check. That selector has
    // no operation matrix attached, so it may pass through only when no matrix
    // was supplied. Proposal routing always supplies a matrix and therefore
    // requires the exact LIVE_PROVEN operation below.
    if (!system.learnedOperations && !customOperationKey) return true;
    return Boolean(
      customOperationKey &&
        isCustomOperationKey(customOperationKey) &&
        productionOperationAvailable(
          system.learnedOperations,
          customOperationKey
        )
    );
  }

  const alternatives = ACTION_CONNECTED_CAPABILITIES[actionType] || [
    ["activities.write"],
  ];
  return alternatives.some(required =>
    required.every(capability =>
      system.verifiedCapabilities.includes(capability)
    )
  );
}

function routedActionType(action: {
  actionType: string;
  payload: Record<string, unknown>;
}) {
  if (action.actionType !== "deterministic_crm_batch") return action.actionType;
  const plan = action.payload.batchPlan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return "";
  const nested = (plan as Record<string, unknown>).actionType;
  return typeof nested === "string" ? nested : "";
}

function routedPayload(action: {
  actionType: string;
  payload: Record<string, unknown>;
}) {
  if (action.actionType !== "deterministic_crm_batch") return action.payload;
  const plan = action.payload.batchPlan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan))
    return action.payload;
  const nestedPayload = (plan as Record<string, unknown>).payload;
  return nestedPayload &&
    typeof nestedPayload === "object" &&
    !Array.isArray(nestedPayload)
    ? (nestedPayload as Record<string, unknown>)
    : action.payload;
}

function connectionCanRoute(status: string) {
  return status === "ready" || status === "limited_permissions";
}

function personalMailboxRoute(
  actionType: string,
  personalMailbox?: PersonalMailboxRouteContext
) {
  const email =
    actionType === "send_email" || actionType === "send_email_template";
  const calendar = actionType === "create_calendar_event";
  if (!email && !calendar) return undefined;

  const capability = email ? "sendEmail" : "calendar";
  const requiredCapability = email
    ? "personal mailbox email send"
    : "personal mailbox calendar";

  if (!personalMailbox?.connected || !personalMailbox.provider)
    return {
      routable: false as const,
      reason: email
        ? "Connect your personal mailbox before preparing an executable email action."
        : "Connect Microsoft 365 or Google Calendar before preparing an executable calendar action.",
      requiredCapability,
      connectionMode: "per_user_mailbox" as const,
    };

  if (!personalMailbox.capabilities?.[capability])
    return {
      routable: false as const,
      reason: calendar
        ? "Your connected mailbox does not provide calendar access. Connect Microsoft 365 or Google Calendar for this action."
        : "Your connected mailbox is missing email-send permission. Reconnect it before using this action.",
      requiredCapability,
      connectionMode: "per_user_mailbox" as const,
    };

  return {
    routable: true as const,
    provider: "personal_mailbox",
    mailboxProvider: personalMailbox.provider,
    displayName: personalMailbox.mailbox || "Your personal mailbox",
    connectionMode:
      personalMailbox.provider === "smtp"
        ? ("verified_smtp" as const)
        : ("delegated_oauth" as const),
    requiredCapability,
    mailbox: personalMailbox.mailbox,
    sentReadback: Boolean(personalMailbox.capabilities?.sentReadback),
  };
}

export function routeConnectedSystemActions<
  T extends { actionType: string; payload: Record<string, unknown> },
>(
  actions: T[],
  systems: ConnectedSystemRoute[],
  options?: { personalMailbox?: PersonalMailboxRouteContext }
) {
  const eligibleSystems = systems.filter(system =>
    connectionCanRoute(system.status)
  );
  return actions.map(action => {
    const effectiveActionType = routedActionType(action);
    const effectivePayload = routedPayload(action);
    const mailboxRoute = personalMailboxRoute(
      effectiveActionType || action.actionType,
      options?.personalMailbox
    );
    if (mailboxRoute)
      return {
        ...action,
        payload: { ...action.payload, crmRoute: mailboxRoute },
      };

    const customAction = effectiveActionType === "custom_crm_action";
    const customOperationKey =
      customAction && isCustomOperationKey(effectivePayload.actionName)
        ? effectivePayload.actionName.trim()
        : undefined;
    const alternatives = customAction
      ? []
      : ACTION_CONNECTED_CAPABILITIES[effectiveActionType] || [
          ["activities.write"],
        ];
    const preferred =
      typeof effectivePayload.preferredProvider === "string"
        ? effectivePayload.preferredProvider
        : undefined;
    const preferredConnectedSystemId =
      typeof effectivePayload.preferredConnectedSystemId === "number"
        ? effectivePayload.preferredConnectedSystemId
        : undefined;
    const eligible =
      customAction && !customOperationKey
        ? []
        : eligibleSystems.filter(system =>
            connectedSystemSupportsAction(
              system,
              effectiveActionType,
              customOperationKey
            )
          );
    const chosen = preferredConnectedSystemId
      ? eligible.find(system => system.id === preferredConnectedSystemId)
      : preferred
        ? eligible.find(system => system.provider === preferred)
        : eligible[0];
    const requiredCapability = customAction
      ? customOperationKey
        ? `${customOperationKey} must be LIVE_PROVEN`
        : "a valid custom.read.* or custom.write.* LIVE_PROVEN operation"
      : alternatives.map(set => set.join("+")).join(" OR ");
    const crmRoute = chosen
      ? {
          routable: true as const,
          provider: chosen.provider,
          displayName: chosen.displayName,
          connectionMode: chosen.connectionMethod,
          connectedSystemId: chosen.id,
          requiredCapability,
          operationKey: customOperationKey,
          operationState: customAction
            ? ("LIVE_PROVEN" as const)
            : undefined,
          shadowMode: chosen.configuration?.shadowMode === true,
        }
      : {
          routable: false as const,
          reason: customAction
            ? customOperationKey
              ? `No connected CRM has the exact '${customOperationKey}' function commissioned as LIVE_PROVEN for production execution.`
              : "Choose a commissioned CRM-specific function before preparing this action."
            : `No backend-verified organisation CRM connection can perform '${effectiveActionType || action.actionType}' with the required execution/readback capability (${requiredCapability}).`,
          requiredCapability,
        };
    return { ...action, payload: { ...action.payload, crmRoute } };
  });
}

export async function routeConnectedSystemActionsForUser<
  T extends { actionType: string; payload: Record<string, unknown> },
>(input: {
  userId: number;
  organisationId: number;
  actions: T[];
  systems: ConnectedSystemRoute[];
}) {
  const requiresMailbox = input.actions.some(action => {
    const actionType = routedActionType(action) || action.actionType;
    return (
      actionType === "send_email" ||
      actionType === "send_email_template" ||
      actionType === "create_calendar_event"
    );
  });
  if (!requiresMailbox)
    return routeConnectedSystemActions(input.actions, input.systems);

  const status = await getPersonalMailboxStatus({
    userId: input.userId,
    organisationId: input.organisationId,
  });
  return routeConnectedSystemActions(input.actions, input.systems, {
    personalMailbox: status.mailbox
      ? {
          connected: true,
          provider: status.mailbox.provider,
          mailbox: status.mailbox.email,
          capabilities: status.mailbox.capabilities,
        }
      : { connected: false },
  });
}
