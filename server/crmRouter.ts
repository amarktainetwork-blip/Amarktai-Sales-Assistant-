import { delegatedMailboxReadiness } from "./delegatedMailbox";
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

export const ACTION_CONNECTED_CAPABILITIES: Record<string, string[][]> = {
  verify_contact_context: [["contacts.read"]],
  append_contact_note: [["notes.write"], ["activities.write"]],
  schedule_callback: [["tasks.write"]],
  complete_active_task: [["tasks.write"]],
  update_contact_status: [["contacts.write"]],
  update_contact: [["contacts.write"]],
  create_contact: [["contacts.write"]],
  create_company: [["companies.write"]],
  update_current_opportunity: [["opportunities.write"]],
  update_opportunity: [["opportunities.write"]],
  create_opportunity: [["opportunities.write"]],
  create_activity: [["activities.write"]],
  send_email_template: [["email.send"]],
  send_email: [["email.send"]],
  send_sms_template: [["sms.send"]],
  send_sms: [["sms.send"]],
  send_whatsapp_template: [["whatsapp.send"]],
  send_whatsapp: [["whatsapp.send"]],
  apply_sequence: [["sequences.apply"]],
};

function isBrowserConnection(system: ConnectedSystemRoute) {
  return system.connectionMethod === "browser" || system.connectionMethod === "sidecar";
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
        productionOperationAvailable(system.learnedOperations, customOperationKey)
    );
  }

  const alternatives = ACTION_CONNECTED_CAPABILITIES[actionType] || [
    ["activities.write"],
  ];
  return alternatives.some(required =>
    required.every(capability => system.verifiedCapabilities.includes(capability))
  );
}

function routedActionType(action: {
  actionType: string;
  payload: Record<string, unknown>;
}) {
  if (action.actionType !== "deterministic_crm_batch")
    return action.actionType;
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
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return action.payload;
  const nestedPayload = (plan as Record<string, unknown>).payload;
  return nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)
    ? (nestedPayload as Record<string, unknown>)
    : action.payload;
}

function connectionCanRoute(status: string) {
  return status === "ready" || status === "limited_permissions";
}

export function routeConnectedSystemActions<
  T extends { actionType: string; payload: Record<string, unknown> },
>(actions: T[], systems: ConnectedSystemRoute[]) {
  const eligibleSystems = systems.filter(system => connectionCanRoute(system.status));
  return actions.map(action => {
    const effectiveActionType = routedActionType(action);
    const effectivePayload = routedPayload(action);
    if (action.actionType === "create_calendar_event") {
      const microsoft = delegatedMailboxReadiness();
      const crmRoute = microsoft.ready
        ? {
            routable: true as const,
            provider: "microsoft_delegated",
            displayName: "Your Microsoft calendar",
            connectionMode: "delegated_oauth",
            requiredCapability: "Calendars.ReadWrite",
          }
        : {
            routable: false as const,
            reason:
              "Personal Microsoft calendar connection is not configured for this deployment. A CRM-native appointment/calendar function may instead be commissioned as a CRM-specific learned action.",
            requiredCapability: "Calendars.ReadWrite",
          };
      return { ...action, payload: { ...action.payload, crmRoute } };
    }

    const customAction = effectiveActionType === "custom_crm_action";
    const customOperationKey =
      customAction && isCustomOperationKey(effectivePayload.actionName)
        ? effectivePayload.actionName.trim()
        : undefined;
    const alternatives = customAction
      ? []
      : ACTION_CONNECTED_CAPABILITIES[effectiveActionType] || [["activities.write"]];
    const preferred =
      typeof effectivePayload.preferredProvider === "string"
        ? effectivePayload.preferredProvider
        : undefined;
    const preferredConnectedSystemId =
      typeof effectivePayload.preferredConnectedSystemId === "number"
        ? effectivePayload.preferredConnectedSystemId
        : undefined;
    const eligible = customAction && !customOperationKey
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
          operationState: customAction ? ("LIVE_PROVEN" as const) : undefined,
          shadowMode: chosen.configuration?.shadowMode === true,
        }
      : {
          routable: false as const,
          reason: customAction
            ? customOperationKey
              ? `No connected CRM has the exact '${customOperationKey}' function commissioned as LIVE_PROVEN for production execution.`
              : "Choose a commissioned CRM-specific function before preparing this action."
            : `No backend-verified organisation CRM connection can perform '${effectiveActionType || action.actionType}' (${requiredCapability}).`,
          requiredCapability,
        };
    return { ...action, payload: { ...action.payload, crmRoute } };
  });
}
