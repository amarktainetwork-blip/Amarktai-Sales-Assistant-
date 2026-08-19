import { hubspotAdapter } from "./hubspot";
import type { AdapterEvidence, ConnectionSecretPayload, CrmAdapter } from "./types";

const API = "https://api.hubapi.com";
const VERSION = "2026-03";

async function request<T>(secret: ConnectionSecretPayload, objectType: string, fields: Record<string, unknown>) {
  if (!secret.accessToken) throw new Error("HubSpot access token is unavailable; reconnect the organisation.");
  const response = await fetch(`${API}/crm/objects/${VERSION}/${objectType}`, { method: "POST", headers: { Authorization: `Bearer ${secret.accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ properties: fields }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function evidence(operation: string, correlationId: string, providerResult: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult };
}

export const hubspotExtendedAdapter: CrmAdapter = {
  ...hubspotAdapter,
  createContact: async ({ secret, fields, correlationId }) => {
    const result = await request<{ id?: string }>(secret, "contacts", fields);
    return evidence("create_contact", correlationId, { id: result.id });
  },
  createCompany: async ({ secret, fields, correlationId }) => {
    const result = await request<{ id?: string }>(secret, "companies", fields);
    return evidence("create_company", correlationId, { id: result.id });
  },
  createOpportunity: async ({ secret, fields, correlationId }) => {
    const result = await request<{ id?: string }>(secret, "deals", fields);
    return evidence("create_opportunity", correlationId, { id: result.id });
  },
};
