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
