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
  if (!chosen) return { routable: false as const, reason: `No ready CRM connection has the '${input.requiredCapability}' capability.` };
  return { routable: true as const, provider: chosen.provider, displayName: chosen.displayName, connectionMode: chosen.connectionMode };
}
