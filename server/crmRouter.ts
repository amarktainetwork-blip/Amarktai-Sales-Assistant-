export const CRM_CAPABILITIES = ["contacts", "tasks", "opportunities", "notes", "activities", "email", "calendar"] as const;
export type CrmCapability = (typeof CRM_CAPABILITIES)[number];
export type CrmProvider = "genie" | "hubspot" | "salesforce" | "pipedrive" | "custom_browser";

export type CrmConnectionRoute = {
  provider: CrmProvider;
  displayName: string;
  status: "draft" | "needs_credentials" | "verifying" | "ready" | "paused" | "error" | "connector_not_implemented";
  capabilities: CrmCapability[];
  connectionMode: "api" | "browser_automation" | "custom";
  verificationExpiresAt?: Date | null;
};

export function routeCrmCapability(input: { connections: CrmConnectionRoute[]; requiredCapability: CrmCapability; preferredProvider?: CrmProvider }) {
  const now = Date.now();
  const eligible = input.connections.filter(connection => connection.provider === "genie" && connection.status === "ready" && Boolean(connection.verificationExpiresAt && connection.verificationExpiresAt.getTime() > now) && connection.capabilities.includes(input.requiredCapability));
  const chosen = input.preferredProvider ? eligible.find(connection => connection.provider === input.preferredProvider) : eligible[0];
  if (!chosen) return { routable: false as const, reason: `No currently verified executable CRM connection has the '${input.requiredCapability}' capability.` };
  return { routable: true as const, provider: chosen.provider, displayName: chosen.displayName, connectionMode: chosen.connectionMode };
}

const ACTION_CAPABILITY: Record<string, CrmCapability> = {
  verify_contact_context: "contacts", update_contact_status: "contacts", complete_active_task: "tasks", schedule_callback: "tasks",
  update_current_opportunity: "opportunities", append_contact_note: "notes", apply_sequence: "activities",
  send_sms_template: "activities", send_email_template: "activities", send_whatsapp_template: "activities",
};

export function routeWorkflowActions<T extends { actionType: string; payload: Record<string, unknown> }>(actions: T[], connections: CrmConnectionRoute[]) {
  return actions.map(action => {
    const requiredCapability = ACTION_CAPABILITY[action.actionType] ?? "activities";
    return { ...action, payload: { ...action.payload, crmRoute: { ...routeCrmCapability({ connections, requiredCapability }), requiredCapability } } };
  });
}
