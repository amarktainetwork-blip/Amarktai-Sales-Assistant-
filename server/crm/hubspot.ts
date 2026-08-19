import type { AdapterConnection, AdapterEvidence, CapabilityResult, ConnectionSecretPayload, ConnectionTest, CrmAdapter, CrmCapability, NormalizedActivity, NormalizedCompany, NormalizedContact, NormalizedOpportunity, NormalizedTask } from "./types";

const HUBSPOT_API = "https://api.hubapi.com";
const HUBSPOT_AUTHORIZE = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN = `${HUBSPOT_API}/oauth/v3/token`;

type HubSpotRecord = { id: string; properties?: Record<string, string | null | undefined>; updatedAt?: string; createdAt?: string };
type HubSpotList = { results?: HubSpotRecord[]; paging?: { next?: { after?: string } } };

function requireHubSpotClient() {
  const clientId = process.env.HUBSPOT_CLIENT_ID?.trim();
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("HubSpot OAuth is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET on the server.");
  return { clientId, clientSecret };
}

function asDate(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function asMinor(value?: string | null) {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : undefined;
}

function apiError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const code = /401|invalid token|expired/i.test(detail) ? "authentication" : /403|scope|permission/i.test(detail) ? "permission" : /429|rate.?limit/i.test(detail) ? "rate_limit" : /5\d\d|network|fetch/i.test(detail) ? "network" : "unknown";
  return { detail, code: code as AdapterEvidence["errorClassification"], retryable: code === "rate_limit" || code === "network" };
}

async function request<T>(secret: ConnectionSecretPayload, path: string, init: RequestInit = {}): Promise<T> {
  if (!secret.accessToken) throw new Error("HubSpot access token is unavailable; reconnect the system.");
  const response = await fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function evidence(operation: string, correlationId: string, result: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult: result };
}

function mapContact(record: HubSpotRecord): NormalizedContact {
  const properties = record.properties ?? {};
  return {
    externalId: record.id,
    firstName: properties.firstname ?? undefined,
    lastName: properties.lastname ?? undefined,
    email: properties.email ?? undefined,
    phone: properties.phone ?? undefined,
    lifecycleStage: properties.lifecyclestage ?? undefined,
    sourceUpdatedAt: asDate(record.updatedAt),
    sourceRevision: record.updatedAt,
    raw: record as unknown as Record<string, unknown>,
  };
}

function mapCompany(record: HubSpotRecord): NormalizedCompany {
  const properties = record.properties ?? {};
  return { externalId: record.id, name: properties.name || "Unnamed company", website: properties.domain ?? undefined, sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}

function mapDeal(record: HubSpotRecord): NormalizedOpportunity {
  const properties = record.properties ?? {};
  return {
    externalId: record.id,
    name: properties.dealname || "Unnamed opportunity",
    pipeline: properties.pipeline ?? undefined,
    stage: properties.dealstage ?? undefined,
    valueMinor: asMinor(properties.amount),
    currency: properties.hs_currency_code ?? undefined,
    closeAt: asDate(properties.closedate),
    sourceUpdatedAt: asDate(record.updatedAt),
    sourceRevision: record.updatedAt,
    raw: record as unknown as Record<string, unknown>,
  };
}

function mapTask(record: HubSpotRecord): NormalizedTask {
  const properties = record.properties ?? {};
  return { externalId: record.id, title: properties.hs_task_subject || "Task", status: properties.hs_task_status || "UNKNOWN", dueAt: asDate(properties.hs_timestamp), completedAt: properties.hs_task_status === "COMPLETED" ? asDate(record.updatedAt) : undefined, sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}

function mapActivity(record: HubSpotRecord): NormalizedActivity {
  const properties = record.properties ?? {};
  return { externalId: record.id, activityType: properties.hs_call_direction || "call", occurredAt: asDate(properties.hs_timestamp) ?? asDate(record.updatedAt) ?? new Date(), body: properties.hs_call_body ?? undefined, sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}

const readCapabilityEndpoints = {
  "contacts.read": "/crm/v3/objects/contacts?limit=1",
  "companies.read": "/crm/v3/objects/companies?limit=1",
  "opportunities.read": "/crm/v3/objects/deals?limit=1",
  "tasks.read": "/crm/v3/objects/tasks?limit=1",
  "pipelines.read": "/crm/v3/pipelines/deals",
} as const satisfies Partial<Record<CrmCapability, string>>;

type HubSpotReadCapability = keyof typeof readCapabilityEndpoints;
const readCapabilities: Array<CapabilityResult & { capability: HubSpotReadCapability }> = (Object.keys(readCapabilityEndpoints) as HubSpotReadCapability[]).map(capability => ({ capability, available: false, detail: "Not tested." }));

async function capabilityChecks(secret: ConnectionSecretPayload, correlationId: string) {
  return Promise.all(readCapabilities.map(async (item) => {
    const path = readCapabilityEndpoints[item.capability];
    try {
      await request(secret, path);
      return { ...item, available: true, detail: "Read capability verified against HubSpot." };
    } catch (error) {
      const failure = apiError(error);
      return { ...item, available: false, detail: `Unavailable: ${failure.detail.slice(0, 220)}` };
    }
  }));
}

export const hubspotAdapter: CrmAdapter = {
  provider: "hubspot",
  createAuthorizationUrl: ({ connection, state, redirectUri }) => {
    const { clientId } = requireHubSpotClient();
    const scopes = connection.allowedReadCapabilities.concat(connection.allowedWriteCapabilities).map(capability => {
      const map: Record<string, string> = { "contacts.read": "crm.objects.contacts.read", "contacts.write": "crm.objects.contacts.write", "companies.read": "crm.objects.companies.read", "companies.write": "crm.objects.companies.write", "opportunities.read": "crm.objects.deals.read", "opportunities.write": "crm.objects.deals.write", "tasks.read": "crm.objects.contacts.read", "tasks.write": "crm.objects.contacts.write", "activities.read": "crm.objects.contacts.read", "activities.write": "crm.objects.contacts.write", "notes.read": "crm.objects.contacts.read", "notes.write": "crm.objects.contacts.write", "owners.read": "crm.objects.owners.read", "pipelines.read": "crm.schemas.deals.read" };
      return map[capability];
    }).filter((scope): scope is string => Boolean(scope));
    const url = new URL(HUBSPOT_AUTHORIZE);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", Array.from(new Set(scopes)).join(" "));
    return url.toString();
  },
  exchangeAuthorizationCode: async ({ code, redirectUri }) => {
    const { clientId, clientSecret } = requireHubSpotClient();
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
    const response = await fetch(HUBSPOT_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!response.ok || !result.access_token || !result.refresh_token) throw new Error("HubSpot OAuth token exchange failed. Reconnect and approve the requested scopes.");
    const tokenInfo = await request<{ hub_id?: number; hubId?: number }>( { accessToken: result.access_token }, `/oauth/v3/access-tokens/${encodeURIComponent(result.access_token)}` );
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in ?? 1800) * 1000).toISOString(), accountExternalId: String(tokenInfo.hub_id ?? tokenInfo.hubId ?? ""), scopes: (result.scope ?? "").split(/\s+/).filter(Boolean) };
  },
  disconnect: async ({ secret, correlationId }) => {
    if (secret?.refreshToken) await fetch(`${HUBSPOT_API}/oauth/v1/refresh-tokens/${encodeURIComponent(secret.refreshToken)}`, { method: "DELETE" });
    return evidence("disconnect", correlationId, { revoked: Boolean(secret?.refreshToken) });
  },
  refreshAuthentication: async ({ secret }) => {
    if (!secret.refreshToken) throw new Error("HubSpot refresh token is unavailable; reconnect the system.");
    const { clientId, clientSecret } = requireHubSpotClient();
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: secret.refreshToken, client_id: clientId, client_secret: clientSecret });
    const response = await fetch(HUBSPOT_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !result.access_token) throw new Error("HubSpot token refresh failed. Reauthenticate the connection.");
    return { ...secret, accessToken: result.access_token, refreshToken: result.refresh_token ?? secret.refreshToken, expiresAt: new Date(Date.now() + (result.expires_in ?? 1800) * 1000).toISOString() };
  },
  testConnection: async ({ secret, correlationId }) => {
    try {
      const capabilities = await capabilityChecks(secret ?? {}, correlationId);
      const available = capabilities.filter(capability => capability.available);
      return { status: available.length ? (available.length === capabilities.length ? "ready" : "limited") : "failed", summary: available.length ? `${available.length} HubSpot read capabilities verified.` : "HubSpot capability checks failed.", capabilities, evidence: [evidence("hubspot_capability_check", correlationId, { availableCapabilities: available.map(item => item.capability) })] };
    } catch (error) {
      const failure = apiError(error);
      return { status: "failed", summary: failure.detail, capabilities: readCapabilities, evidence: [{ operation: "hubspot_capability_check", correlationId, completedAt: new Date().toISOString(), errorClassification: failure.code, retryable: failure.retryable }] };
    }
  },
  discoverCapabilities: async ({ secret, correlationId }) => capabilityChecks(secret ?? {}, correlationId),
  syncContacts: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `/crm/v3/objects/contacts?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=firstname,lastname,email,phone,lifecyclestage`); return { records: (page.results ?? []).map(mapContact), cursor: page.paging?.next?.after }; },
  syncCompanies: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `/crm/v3/objects/companies?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=name,domain`); return { records: (page.results ?? []).map(mapCompany), cursor: page.paging?.next?.after }; },
  syncOpportunities: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `/crm/v3/objects/deals?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=dealname,pipeline,dealstage,amount,hs_currency_code,closedate`); return { records: (page.results ?? []).map(mapDeal), cursor: page.paging?.next?.after }; },
  syncTasks: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `/crm/v3/objects/tasks?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=hs_task_subject,hs_task_status,hs_timestamp`); return { records: (page.results ?? []).map(mapTask), cursor: page.paging?.next?.after }; },
  syncActivities: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `/crm/v3/objects/calls?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=hs_call_direction,hs_call_body,hs_timestamp`); return { records: (page.results ?? []).map(mapActivity), cursor: page.paging?.next?.after }; },
  searchContacts: async ({ secret, query }) => { const page = await request<HubSpotList>(secret, "/crm/v3/objects/contacts/search", { method: "POST", body: JSON.stringify({ query, properties: ["firstname", "lastname", "email", "phone", "lifecyclestage"], limit: 20 }) }); return (page.results ?? []).map(mapContact); },
  getContact: async ({ secret, externalId }) => mapContact(await request<HubSpotRecord>(secret, `/crm/v3/objects/contacts/${encodeURIComponent(externalId)}?properties=firstname,lastname,email,phone,lifecyclestage`)),
  getCompany: async ({ secret, externalId }) => mapCompany(await request<HubSpotRecord>(secret, `/crm/v3/objects/companies/${encodeURIComponent(externalId)}?properties=name,domain`)),
  getOpportunity: async ({ secret, externalId }) => mapDeal(await request<HubSpotRecord>(secret, `/crm/v3/objects/deals/${encodeURIComponent(externalId)}?properties=dealname,pipeline,dealstage,amount,hs_currency_code,closedate`)),
  createNote: async ({ secret, externalId, body, correlationId }) => { const result = await request<{ id?: string }>(secret, "/crm/v3/objects/notes", { method: "POST", body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() }, associations: [{ to: { id: externalId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] }) }); return evidence("create_note", correlationId, { id: result.id }); },
  createTask: async ({ secret, title, dueAt, correlationId }) => { const result = await request<{ id?: string }>(secret, "/crm/v3/objects/tasks", { method: "POST", body: JSON.stringify({ properties: { hs_task_subject: title, hs_task_status: "NOT_STARTED", hs_timestamp: dueAt ?? new Date().toISOString() } }) }); return evidence("create_task", correlationId, { id: result.id }); },
  completeTask: async ({ secret, externalId, correlationId }) => { await request(secret, `/crm/v3/objects/tasks/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: { hs_task_status: "COMPLETED" } }) }); return evidence("complete_task", correlationId, { externalId }); },
  updateContact: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/crm/v3/objects/contacts/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: patch }) }); return evidence("update_contact", correlationId, { externalId }); },
  updateOpportunity: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/crm/v3/objects/deals/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: patch }) }); return evidence("update_opportunity", correlationId, { externalId }); },
  createActivity: async ({ secret, activity, correlationId }) => { const result = await request<{ id?: string }>(secret, "/crm/v3/objects/calls", { method: "POST", body: JSON.stringify({ properties: activity }) }); return evidence("create_activity", correlationId, { id: result.id }); },
  listPipelines: async ({ secret }) => { const response = await request<{ results?: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string }> }> }>(secret, "/crm/v3/pipelines/deals"); return (response.results ?? []).map(pipeline => ({ externalId: pipeline.id, label: pipeline.label, stages: (pipeline.stages ?? []).map(stage => ({ externalId: stage.id, label: stage.label })) })); },
  healthCheck: async input => hubspotAdapter.testConnection(input),
};
