import type { AdapterEvidence, CapabilityResult, ConnectionSecretPayload, ConnectionTest, CrmAdapter, CrmCapability, NormalizedActivity, NormalizedCompany, NormalizedContact, NormalizedOpportunity, NormalizedTask } from "./types";

const HUBSPOT_API = "https://api.hubapi.com";
const HUBSPOT_AUTHORIZE = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_VERSION = "2026-03";
const HUBSPOT_TOKEN = `${HUBSPOT_API}/oauth/${HUBSPOT_VERSION}/token`;
const HUBSPOT_INTROSPECT = `${HUBSPOT_TOKEN}/introspect`;
const HUBSPOT_REVOKE = `${HUBSPOT_TOKEN}/revoke`;

type HubSpotRecord = { id: string; properties?: Record<string, string | null | undefined>; updatedAt?: string; createdAt?: string };
type HubSpotList = { results?: HubSpotRecord[]; paging?: { next?: { after?: string } } };
type HubSpotTokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; hub_id?: number; scopes?: string[]; scope?: string };
type HubSpotTokenInfo = { active?: boolean; hub_id?: number; scopes?: string[]; expires_in?: number };

const objectPath = (objectType: string, suffix = "") => `/crm/objects/${HUBSPOT_VERSION}/${objectType}${suffix}`;
const pipelinePath = (objectType: string) => `/crm/pipelines/${HUBSPOT_VERSION}/${objectType}`;

const capabilityScope: Partial<Record<CrmCapability, string>> = {
  "contacts.read": "crm.objects.contacts.read",
  "contacts.write": "crm.objects.contacts.write",
  "companies.read": "crm.objects.companies.read",
  "companies.write": "crm.objects.companies.write",
  "opportunities.read": "crm.objects.deals.read",
  "opportunities.write": "crm.objects.deals.write",
  "tasks.read": "crm.objects.contacts.read",
  "tasks.write": "crm.objects.contacts.write",
  "activities.read": "crm.objects.contacts.read",
  "activities.write": "crm.objects.contacts.write",
  "notes.read": "crm.objects.contacts.read",
  "notes.write": "crm.objects.contacts.write",
  "owners.read": "crm.objects.owners.read",
  "pipelines.read": "crm.schemas.deals.read",
};

const readEndpoint: Partial<Record<CrmCapability, string>> = {
  "contacts.read": `${objectPath("contacts")}?limit=1`,
  "companies.read": `${objectPath("companies")}?limit=1`,
  "opportunities.read": `${objectPath("deals")}?limit=1`,
  "tasks.read": `${objectPath("tasks")}?limit=1`,
  "activities.read": `${objectPath("calls")}?limit=1`,
  "notes.read": `${objectPath("notes")}?limit=1`,
  "pipelines.read": pipelinePath("deals"),
};

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
  const code = /401|invalid[_ ]?grant|invalid token|expired|bad_refresh/i.test(detail) ? "authentication" : /403|scope|permission/i.test(detail) ? "permission" : /429|rate.?limit/i.test(detail) ? "rate_limit" : /5\d\d|network|fetch/i.test(detail) ? "network" : "unknown";
  return { detail, code: code as AdapterEvidence["errorClassification"], retryable: code === "rate_limit" || code === "network" };
}

async function formRequest<T>(url: string, values: Record<string, string>): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HubSpot OAuth ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function introspect(token: string, tokenType: "access_token" | "refresh_token" = "access_token") {
  const { clientId, clientSecret } = requireHubSpotClient();
  return formRequest<HubSpotTokenInfo>(HUBSPOT_INTROSPECT, { client_id: clientId, client_secret: clientSecret, token, token_type_hint: tokenType });
}

async function request<T>(secret: ConnectionSecretPayload, path: string, init: RequestInit = {}): Promise<T> {
  if (!secret.accessToken) throw new Error("HubSpot access token is unavailable; reconnect the system.");
  const response = await fetch(`${HUBSPOT_API}${path}`, { ...init, headers: { Authorization: `Bearer ${secret.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HubSpot API ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function evidence(operation: string, correlationId: string, result: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult: result };
}

function mapContact(record: HubSpotRecord): NormalizedContact {
  const p = record.properties ?? {};
  return { externalId: record.id, ownerExternalId: p.hubspot_owner_id ?? undefined, firstName: p.firstname ?? undefined, lastName: p.lastname ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined, lifecycleStage: p.lifecyclestage ?? undefined, sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}
function mapCompany(record: HubSpotRecord): NormalizedCompany {
  const p = record.properties ?? {};
  return { externalId: record.id, name: p.name || "Unnamed company", website: p.domain ?? undefined, ownerExternalId: p.hubspot_owner_id ?? undefined, sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}
function mapDeal(record: HubSpotRecord): NormalizedOpportunity {
  const p = record.properties ?? {};
  return { externalId: record.id, ownerExternalId: p.hubspot_owner_id ?? undefined, name: p.dealname || "Unnamed opportunity", pipeline: p.pipeline ?? undefined, stage: p.dealstage ?? undefined, valueMinor: asMinor(p.amount), currency: p.hs_currency_code ?? undefined, closeAt: asDate(p.closedate), lastActivityAt: asDate(p.notes_last_updated), nextStepAt: asDate(p.hs_next_step), sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}
function mapTask(record: HubSpotRecord): NormalizedTask {
  const p = record.properties ?? {};
  return { externalId: record.id, ownerExternalId: p.hubspot_owner_id ?? undefined, title: p.hs_task_subject || "Task", status: p.hs_task_status || "UNKNOWN", dueAt: asDate(p.hs_timestamp), completedAt: p.hs_task_status === "COMPLETED" ? asDate(record.updatedAt) : undefined, sourceUpdatedAt: asDate(record.updatedAt), sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}
function mapActivity(record: HubSpotRecord): NormalizedActivity {
  const p = record.properties ?? {};
  return { externalId: record.id, ownerExternalId: p.hubspot_owner_id ?? undefined, activityType: p.hs_call_direction || "call", occurredAt: asDate(p.hs_timestamp) ?? asDate(record.updatedAt) ?? new Date(), body: p.hs_call_body ?? undefined, sourceRevision: record.updatedAt, raw: record as unknown as Record<string, unknown> };
}

async function capabilityChecks(connection: Parameters<CrmAdapter["testConnection"]>[0]["connection"], secret: ConnectionSecretPayload, correlationId: string): Promise<{ capabilities: CapabilityResult[]; tokenInfo: HubSpotTokenInfo }> {
  if (!secret.accessToken) throw new Error("HubSpot access token is unavailable; reconnect the system.");
  const tokenInfo = await introspect(secret.accessToken);
  if (tokenInfo.active === false) throw new Error("HubSpot access token is inactive; reconnect the system.");
  const granted = new Set(tokenInfo.scopes ?? secret.scopes ?? []);
  const requested = Array.from(new Set([...connection.allowedReadCapabilities, ...connection.allowedWriteCapabilities])).filter((value): value is CrmCapability => value in capabilityScope || value in readEndpoint);
  const capabilities = await Promise.all(requested.map(async capability => {
    const requiredScope = capabilityScope[capability];
    if (requiredScope && !granted.has(requiredScope)) return { capability, available: false, detail: `Missing HubSpot scope ${requiredScope}.` } satisfies CapabilityResult;
    const endpoint = readEndpoint[capability];
    if (!endpoint) return { capability, available: Boolean(requiredScope), detail: requiredScope ? "OAuth scope verified; mutating verification is deferred until an approved action." : "Capability is not supported by this adapter." } satisfies CapabilityResult;
    try {
      await request(secret, endpoint);
      return { capability, available: true, detail: "HubSpot scope and read endpoint verified." } satisfies CapabilityResult;
    } catch (error) {
      return { capability, available: false, detail: `Unavailable: ${apiError(error).detail.slice(0, 220)}` } satisfies CapabilityResult;
    }
  }));
  return { capabilities, tokenInfo };
}

export const hubspotAdapter: CrmAdapter = {
  provider: "hubspot",
  createAuthorizationUrl: ({ connection, state, redirectUri }) => {
    const { clientId } = requireHubSpotClient();
    const scopes = Array.from(new Set(connection.allowedReadCapabilities.concat(connection.allowedWriteCapabilities).map(capability => capabilityScope[capability as CrmCapability]).filter((scope): scope is string => Boolean(scope))));
    if (!scopes.length) throw new Error("Select at least one supported HubSpot capability before connecting.");
    const url = new URL(HUBSPOT_AUTHORIZE);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scopes.join(" "));
    return url.toString();
  },
  exchangeAuthorizationCode: async ({ code, redirectUri }) => {
    const { clientId, clientSecret } = requireHubSpotClient();
    const result = await formRequest<HubSpotTokenResponse>(HUBSPOT_TOKEN, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret });
    if (!result.access_token || !result.refresh_token) throw new Error("HubSpot OAuth token exchange did not return both access and refresh tokens.");
    const scopes = result.scopes ?? result.scope?.split(/\s+/).filter(Boolean) ?? [];
    let hubId = result.hub_id;
    if (!hubId) hubId = (await introspect(result.access_token)).hub_id;
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in ?? 1800) * 1000).toISOString(), accountExternalId: hubId ? String(hubId) : undefined, scopes };
  },
  disconnect: async ({ secret, correlationId }) => {
    if (secret?.refreshToken) {
      const { clientId, clientSecret } = requireHubSpotClient();
      await formRequest<Record<string, unknown>>(HUBSPOT_REVOKE, { client_id: clientId, client_secret: clientSecret, token: secret.refreshToken, token_type_hint: "refresh_token" });
    }
    return evidence("disconnect", correlationId, { revoked: Boolean(secret?.refreshToken) });
  },
  refreshAuthentication: async ({ secret }) => {
    if (!secret.refreshToken) throw new Error("HubSpot refresh token is unavailable; reconnect the system.");
    const { clientId, clientSecret } = requireHubSpotClient();
    const result = await formRequest<HubSpotTokenResponse>(HUBSPOT_TOKEN, { grant_type: "refresh_token", refresh_token: secret.refreshToken, client_id: clientId, client_secret: clientSecret });
    if (!result.access_token) throw new Error("HubSpot token refresh returned no access token.");
    return { ...secret, accessToken: result.access_token, refreshToken: result.refresh_token ?? secret.refreshToken, expiresAt: new Date(Date.now() + (result.expires_in ?? 1800) * 1000).toISOString(), scopes: result.scopes ?? secret.scopes };
  },
  testConnection: async ({ connection, secret, correlationId }) => {
    try {
      const checked = await capabilityChecks(connection, secret ?? {}, correlationId);
      const available = checked.capabilities.filter(capability => capability.available);
      const status: ConnectionTest["status"] = checked.capabilities.length > 0 && available.length === checked.capabilities.length ? "ready" : available.length ? "limited" : "failed";
      return { status, summary: status === "ready" ? `${available.length} requested HubSpot capabilities verified.` : `${available.length} of ${checked.capabilities.length} requested HubSpot capabilities verified.`, capabilities: checked.capabilities, accountExternalId: checked.tokenInfo.hub_id ? String(checked.tokenInfo.hub_id) : secret?.accountExternalId, scopes: checked.tokenInfo.scopes ?? secret?.scopes, evidence: [evidence("hubspot_capability_check", correlationId, { availableCapabilities: available.map(item => item.capability), apiVersion: HUBSPOT_VERSION })] };
    } catch (error) {
      const failure = apiError(error);
      return { status: "failed", summary: failure.detail, capabilities: [], evidence: [{ operation: "hubspot_capability_check", correlationId, completedAt: new Date().toISOString(), errorClassification: failure.code, retryable: failure.retryable }] };
    }
  },
  discoverCapabilities: async ({ connection, secret, correlationId }) => (await capabilityChecks(connection, secret ?? {}, correlationId)).capabilities,
  syncContacts: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `${objectPath("contacts")}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=firstname,lastname,email,phone,lifecyclestage,hubspot_owner_id`); return { records: (page.results ?? []).map(mapContact), cursor: page.paging?.next?.after }; },
  syncCompanies: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `${objectPath("companies")}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=name,domain,hubspot_owner_id`); return { records: (page.results ?? []).map(mapCompany), cursor: page.paging?.next?.after }; },
  syncOpportunities: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `${objectPath("deals")}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=dealname,pipeline,dealstage,amount,hs_currency_code,closedate,hubspot_owner_id,notes_last_updated,hs_next_step`); return { records: (page.results ?? []).map(mapDeal), cursor: page.paging?.next?.after }; },
  syncTasks: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `${objectPath("tasks")}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=hs_task_subject,hs_task_status,hs_timestamp,hubspot_owner_id`); return { records: (page.results ?? []).map(mapTask), cursor: page.paging?.next?.after }; },
  syncActivities: async ({ secret, cursor }) => { const page = await request<HubSpotList>(secret, `${objectPath("calls")}?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}&properties=hs_call_direction,hs_call_body,hs_timestamp,hubspot_owner_id`); return { records: (page.results ?? []).map(mapActivity), cursor: page.paging?.next?.after }; },
  searchContacts: async ({ secret, query }) => { const page = await request<HubSpotList>(secret, `${objectPath("contacts")}/search`, { method: "POST", body: JSON.stringify({ query, properties: ["firstname", "lastname", "email", "phone", "lifecyclestage", "hubspot_owner_id"], limit: 20 }) }); return (page.results ?? []).map(mapContact); },
  getContact: async ({ secret, externalId }) => mapContact(await request<HubSpotRecord>(secret, `${objectPath("contacts")}/${encodeURIComponent(externalId)}?properties=firstname,lastname,email,phone,lifecyclestage,hubspot_owner_id`)),
  getCompany: async ({ secret, externalId }) => mapCompany(await request<HubSpotRecord>(secret, `${objectPath("companies")}/${encodeURIComponent(externalId)}?properties=name,domain,hubspot_owner_id`)),
  getOpportunity: async ({ secret, externalId }) => mapDeal(await request<HubSpotRecord>(secret, `${objectPath("deals")}/${encodeURIComponent(externalId)}?properties=dealname,pipeline,dealstage,amount,hs_currency_code,closedate,hubspot_owner_id,notes_last_updated,hs_next_step`)),
  createNote: async ({ secret, externalId, body, correlationId }) => { const result = await request<{ id?: string }>(secret, objectPath("notes"), { method: "POST", body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() }, associations: [{ to: { id: externalId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }] }) }); return evidence("create_note", correlationId, { id: result.id }); },
  createTask: async ({ secret, title, dueAt, correlationId }) => { const result = await request<{ id?: string }>(secret, objectPath("tasks"), { method: "POST", body: JSON.stringify({ properties: { hs_task_subject: title, hs_task_status: "NOT_STARTED", hs_timestamp: dueAt ?? new Date().toISOString() } }) }); return evidence("create_task", correlationId, { id: result.id }); },
  completeTask: async ({ secret, externalId, correlationId }) => { await request(secret, `${objectPath("tasks")}/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: { hs_task_status: "COMPLETED" } }) }); return evidence("complete_task", correlationId, { externalId }); },
  updateContact: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `${objectPath("contacts")}/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: patch }) }); return evidence("update_contact", correlationId, { externalId }); },
  updateOpportunity: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `${objectPath("deals")}/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ properties: patch }) }); return evidence("update_opportunity", correlationId, { externalId }); },
  createActivity: async ({ secret, activity, correlationId }) => { const result = await request<{ id?: string }>(secret, objectPath("calls"), { method: "POST", body: JSON.stringify({ properties: activity }) }); return evidence("create_activity", correlationId, { id: result.id }); },
  listPipelines: async ({ secret }) => { const response = await request<{ results?: Array<{ id: string; label: string; stages?: Array<{ id: string; label: string }> }> }>(secret, pipelinePath("deals")); return (response.results ?? []).map(pipeline => ({ externalId: pipeline.id, label: pipeline.label, stages: (pipeline.stages ?? []).map(stage => ({ externalId: stage.id, label: stage.label })) })); },
  healthCheck: async input => hubspotAdapter.testConnection(input),
};
