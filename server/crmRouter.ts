export const CRM_CAPABILITIES = ["contacts", "tasks", "opportunities", "notes", "activities", "email", "calendar"] as const;
export type CrmCapability = (typeof CRM_CAPABILITIES)[number];
export type CrmProvider = "genie" | "hubspot" | "salesforce" | "pipedrive" | "custom_browser";

export type CrmConnectionRoute = {
  provider: CrmProvider;
  displayName: string;
  status: "draft" | "needs_credentials" | "ready" | "paused" | "error";
  capabilities: CrmCapability[];
  connectionMode: "api" | "browser_automation" | "custom";
};

export function routeCrmCapability(input: { connections: CrmConnectionRoute[]; requiredCapability: CrmCapability; preferredProvider?: CrmProvider }) {
  const eligible = input.connections.filter(connection => connection.status === "ready" && connection.capabilities.includes(input.requiredCapability));
  const chosen = input.preferredProvider ? eligible.find(connection => connection.provider === input.preferredProvider) : eligible[0];
  if (!chosen) return { routable: false as const, reason: `No ready legacy CRM connection has the '${input.requiredCapability}' capability.` };
  return { routable: true as const, provider: chosen.provider, displayName: chosen.displayName, connectionMode: chosen.connectionMode };
}

const ACTION_CAPABILITY: Record<string, CrmCapability> = {
  verify_contact_context: "contacts", update_contact_status: "contacts", complete_active_task: "tasks", schedule_callback: "tasks",
  update_current_opportunity: "opportunities", append_contact_note: "notes", apply_sequence: "activities",
  send_sms_template: "activities", send_email_template: "activities", send_whatsapp_template: "activities",
};

/**
 * Existing hard-coded playbooks pre-date organisation-scoped Connected Systems.
 * When no legacy per-user route exists, preserve a reviewable proposal and let
 * execution resolve a verified organisation connector. Execution still fails
 * closed if no backend-verified connector can satisfy the action.
 */
export function routeWorkflowActions<T extends { actionType: string; payload: Record<string, unknown> }>(actions: T[], connections: CrmConnectionRoute[]) {
  return actions.map(action => {
    const requiredCapability = ACTION_CAPABILITY[action.actionType] ?? "activities";
    const legacy = routeCrmCapability({ connections, requiredCapability });
    const crmRoute = legacy.routable ? { ...legacy, requiredCapability } : { routable: true as const, provider: "auto", deferredToOrganisationConnector: true, requiredCapability, legacyReason: legacy.reason };
    return { ...action, payload: { ...action.payload, crmRoute } };
  });
}

export type ConnectedSystemRoute = {
  id: number;
  provider: string;
  displayName: string;
  status: string;
  connectionMethod: string;
  verifiedCapabilities: string[];
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
  send_email_template: [["email.send"], ["activities.write"]],
  send_email: [["email.send"], ["activities.write"]],
  send_sms_template: [["sms.send"], ["activities.write"]],
  send_sms: [["sms.send"], ["activities.write"]],
  send_whatsapp_template: [["whatsapp.send"], ["activities.write"]],
  send_whatsapp: [["whatsapp.send"], ["activities.write"]],
  apply_sequence: [["sequences.apply"], ["activities.write"]],
  custom_crm_action: [["activities.write"]],
};

export function connectedSystemSupportsAction(system: ConnectedSystemRoute, actionType: string) {
  const alternatives = ACTION_CONNECTED_CAPABILITIES[actionType] || [["activities.write"]];
  return alternatives.some(required => required.every(capability => system.verifiedCapabilities.includes(capability)));
}

export function routeConnectedSystemActions<T extends { actionType: string; payload: Record<string, unknown> }>(actions: T[], systems: ConnectedSystemRoute[]) {
  const ready = systems.filter(system => system.status === "ready");
  return actions.map(action => {
    const alternatives = ACTION_CONNECTED_CAPABILITIES[action.actionType] || [["activities.write"]];
    const preferred = typeof action.payload.preferredProvider === "string" ? action.payload.preferredProvider : undefined;
    const eligible = ready.filter(system => connectedSystemSupportsAction(system, action.actionType));
    const chosen = preferred ? eligible.find(system => system.provider === preferred) : eligible[0];
    const requiredCapability = alternatives.map(set => set.join("+")).join(" OR ");
    const crmRoute = chosen
      ? { routable: true as const, provider: chosen.provider, displayName: chosen.displayName, connectionMode: chosen.connectionMethod, connectedSystemId: chosen.id, requiredCapability }
      : { routable: false as const, reason: `No backend-verified organisation CRM connection can perform '${action.actionType}' (${requiredCapability}).`, requiredCapability };
    return { ...action, payload: { ...action.payload, crmRoute } };
  });
}
