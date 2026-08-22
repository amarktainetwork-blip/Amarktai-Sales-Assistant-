import type {
  AdapterEvidence,
  CapabilityResult,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmAdapter,
  CrmCapability,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";

const OAUTH_BASE = "https://oauth.pipedrive.com";
const DEFAULT_API_BASE = "https://api.pipedrive.com";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string; api_domain?: string };
type ListResponse<T> = { success?: boolean; data?: T[] | null; additional_data?: { next_cursor?: string; pagination?: { next_start?: number; more_items_in_collection?: boolean } } };
type ItemResponse<T> = { success?: boolean; data?: T | null };
type Person = { id: number; org_id?: number | { value?: number }; owner_id?: number; name?: string; first_name?: string; last_name?: string; emails?: Array<{ value?: string; primary?: boolean }>; phones?: Array<{ value?: string; primary?: boolean }>; update_time?: string };
type Organization = { id: number; owner_id?: number; name?: string; website?: string; update_time?: string };
type Deal = { id: number; org_id?: number; person_id?: number; owner_id?: number; title?: string; pipeline_id?: number; stage_id?: number; value?: number; currency?: string; expected_close_date?: string; update_time?: string; status?: string };
type Activity = { id: number; owner_id?: number; user_id?: number; person_id?: number; deal_id?: number; subject?: string; type?: string; done?: boolean; due_date?: string; due_time?: string; marked_as_done_time?: string; update_time?: string; note?: string };
type Pipeline = { id: number; name?: string };
type Stage = { id: number; name?: string; pipeline_id?: number };

function clientConfig() {
  const clientId = process.env.PIPEDRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.PIPEDRIVE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Pipedrive OAuth is not configured. Set PIPEDRIVE_CLIENT_ID and PIPEDRIVE_CLIENT_SECRET.");
  return { clientId, clientSecret };
}

function evidence(operation: string, correlationId: string, providerResult: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult };
}
function date(value?: string | null) { if (!value) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? undefined : parsed; }
function moneyMinor(value?: number | null) { return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined; }
function id(value?: number | { value?: number } | null) { return typeof value === "number" ? String(value) : value?.value ? String(value.value) : undefined; }
function primary(values?: Array<{ value?: string; primary?: boolean }>) { return values?.find(item => item.primary)?.value || values?.[0]?.value; }

async function tokenRequest(body: Record<string, string>) {
  const { clientId, clientSecret } = clientConfig();
  const response = await fetch(`${OAUTH_BASE}/oauth/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pipedrive OAuth ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as TokenResponse;
}

function apiBase(secret: ConnectionSecretPayload) { return (secret.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, ""); }
async function request<T>(secret: ConnectionSecretPayload, path: string, init: RequestInit = {}) {
  if (!secret.accessToken) throw new Error("Pipedrive access token is unavailable; reconnect the organisation.");
  const response = await fetch(`${apiBase(secret)}${path}`, { ...init, headers: { Authorization: `Bearer ${secret.accessToken}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pipedrive API ${response.status}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function nextCursor(response: ListResponse<unknown>) {
  return response.additional_data?.next_cursor || (response.additional_data?.pagination?.more_items_in_collection && response.additional_data.pagination.next_start !== undefined ? `start:${response.additional_data.pagination.next_start}` : undefined);
}
function cursorQuery(cursor?: string) {
  if (!cursor) return "";
  if (cursor.startsWith("start:")) return `&start=${encodeURIComponent(cursor.slice(6))}`;
  return `&cursor=${encodeURIComponent(cursor)}`;
}

function mapPerson(row: Person): NormalizedContact {
  const parts = (row.name || "").trim().split(/\s+/);
  return { externalId: String(row.id), companyExternalId: id(row.org_id), ownerExternalId: id(row.owner_id), firstName: row.first_name || parts[0], lastName: row.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : undefined), email: primary(row.emails), phone: primary(row.phones), sourceUpdatedAt: date(row.update_time), sourceRevision: row.update_time, raw: row as unknown as Record<string, unknown> };
}
function mapOrganization(row: Organization): NormalizedCompany {
  return { externalId: String(row.id), ownerExternalId: id(row.owner_id), name: row.name || "Unnamed organization", website: row.website, sourceUpdatedAt: date(row.update_time), sourceRevision: row.update_time, raw: row as unknown as Record<string, unknown> };
}
function mapDeal(row: Deal): NormalizedOpportunity {
  return { externalId: String(row.id), companyExternalId: id(row.org_id), contactExternalId: id(row.person_id), ownerExternalId: id(row.owner_id), name: row.title || "Unnamed deal", pipeline: id(row.pipeline_id), stage: id(row.stage_id) || row.status, valueMinor: moneyMinor(row.value), currency: row.currency, closeAt: date(row.expected_close_date), sourceUpdatedAt: date(row.update_time), sourceRevision: row.update_time, raw: row as unknown as Record<string, unknown> };
}
function mapTask(row: Activity): NormalizedTask {
  const due = row.due_date ? `${row.due_date}T${row.due_time || "23:59:00"}` : undefined;
  return { externalId: String(row.id), contactExternalId: id(row.person_id), opportunityExternalId: id(row.deal_id), ownerExternalId: id(row.owner_id || row.user_id), title: row.subject || "Activity", status: row.done ? "completed" : "open", dueAt: date(due), completedAt: date(row.marked_as_done_time), sourceUpdatedAt: date(row.update_time), sourceRevision: row.update_time, raw: row as unknown as Record<string, unknown> };
}
function mapActivity(row: Activity): NormalizedActivity {
  return { externalId: String(row.id), contactExternalId: id(row.person_id), opportunityExternalId: id(row.deal_id), ownerExternalId: id(row.owner_id || row.user_id), activityType: row.type || "activity", occurredAt: date(row.marked_as_done_time) || date(row.due_date) || date(row.update_time) || new Date(), body: row.note || row.subject, sourceRevision: row.update_time, raw: row as unknown as Record<string, unknown> };
}

const supported: CrmCapability[] = [
  "contacts.read", "contacts.write", "companies.read", "companies.write", "opportunities.read", "opportunities.write",
  "tasks.read", "tasks.write", "activities.read", "activities.write", "notes.read", "notes.write", "owners.read", "pipelines.read",
];
function capabilities(connection: Parameters<CrmAdapter["testConnection"]>[0]["connection"]): CapabilityResult[] {
  return Array.from(new Set([...connection.allowedReadCapabilities, ...connection.allowedWriteCapabilities])).filter((cap): cap is CrmCapability => supported.includes(cap as CrmCapability)).map(capability => ({ capability, available: true, detail: "Pipedrive OAuth/API capability available subject to the app scopes and user permissions." }));
}

export const pipedriveAdapter: CrmAdapter = {
  provider: "pipedrive",
  createAuthorizationUrl: ({ state, redirectUri }) => {
    const { clientId } = clientConfig();
    const url = new URL(`${OAUTH_BASE}/oauth/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchangeAuthorizationCode: async ({ code, redirectUri }) => {
    const result = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    if (!result.access_token || !result.refresh_token) throw new Error("Pipedrive token exchange returned incomplete credentials.");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(), apiBaseUrl: result.api_domain || DEFAULT_API_BASE, tokenType: result.token_type, scopes: result.scope?.split(/\s+/).filter(Boolean) };
  },
  disconnect: async ({ correlationId }) => evidence("disconnect", correlationId, { localCredentialsRemoved: true, note: "Pipedrive access is disabled in Amarktai; revoke the app in Pipedrive when complete provider revocation is required." }),
  refreshAuthentication: async ({ secret }) => {
    if (!secret.refreshToken) throw new Error("Pipedrive refresh token is unavailable; reconnect the organisation.");
    const result = await tokenRequest({ grant_type: "refresh_token", refresh_token: secret.refreshToken });
    if (!result.access_token) throw new Error("Pipedrive token refresh returned no access token.");
    return { ...secret, accessToken: result.access_token, refreshToken: result.refresh_token || secret.refreshToken, expiresAt: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(), apiBaseUrl: result.api_domain || secret.apiBaseUrl, tokenType: result.token_type || secret.tokenType, scopes: result.scope?.split(/\s+/).filter(Boolean) || secret.scopes };
  },
  testConnection: async ({ connection, secret, correlationId }): Promise<ConnectionTest> => {
    try {
      const me = await request<ItemResponse<{ id?: number; name?: string; company_id?: number }>>(secret || {}, "/api/v1/users/me");
      if (!me.success) throw new Error("Pipedrive returned an unsuccessful current-user response.");
      const caps = capabilities(connection);
      return { status: caps.length ? "ready" : "limited", summary: `${caps.length} requested Pipedrive capabilities available.`, capabilities: caps, accountExternalId: me.data?.company_id ? String(me.data.company_id) : secret?.accountExternalId, scopes: secret?.scopes, evidence: [evidence("pipedrive_users_me", correlationId, { userId: me.data?.id, name: me.data?.name })] };
    } catch (error) {
      return { status: "failed", summary: error instanceof Error ? error.message : String(error), capabilities: [], evidence: [{ operation: "pipedrive_health", correlationId, completedAt: new Date().toISOString(), errorClassification: "authentication", retryable: false }] };
    }
  },
  discoverCapabilities: async ({ connection, secret, correlationId }) => (await pipedriveAdapter.testConnection({ connection, secret, correlationId })).capabilities,
  syncContacts: async ({ secret, cursor }) => { const page = await request<ListResponse<Person>>(secret, `/api/v2/persons?limit=500${cursorQuery(cursor)}`); return { records: (page.data || []).map(mapPerson), cursor: nextCursor(page) }; },
  syncCompanies: async ({ secret, cursor }) => { const page = await request<ListResponse<Organization>>(secret, `/api/v2/organizations?limit=500${cursorQuery(cursor)}`); return { records: (page.data || []).map(mapOrganization), cursor: nextCursor(page) }; },
  syncOpportunities: async ({ secret, cursor }) => { const page = await request<ListResponse<Deal>>(secret, `/api/v2/deals?limit=500${cursorQuery(cursor)}`); return { records: (page.data || []).map(mapDeal), cursor: nextCursor(page) }; },
  syncTasks: async ({ secret, cursor }) => { const page = await request<ListResponse<Activity>>(secret, `/api/v2/activities?limit=500${cursorQuery(cursor)}`); return { records: (page.data || []).map(mapTask), cursor: nextCursor(page) }; },
  syncActivities: async ({ secret, cursor }) => { const page = await request<ListResponse<Activity>>(secret, `/api/v2/activities?limit=500${cursorQuery(cursor)}`); return { records: (page.data || []).map(mapActivity), cursor: nextCursor(page) }; },
  searchContacts: async ({ secret, query }) => { const response = await request<{ success?: boolean; data?: { items?: Array<{ item?: Person }> } }>(secret, `/api/v2/persons/search?term=${encodeURIComponent(query.trim())}&limit=20`); return (response.data?.items || []).map(entry => entry.item).filter((item): item is Person => Boolean(item)).map(mapPerson); },
  getContact: async ({ secret, externalId }) => { const result = await request<ItemResponse<Person>>(secret, `/api/v2/persons/${encodeURIComponent(externalId)}`); return result.data ? mapPerson(result.data) : null; },
  getCompany: async ({ secret, externalId }) => { const result = await request<ItemResponse<Organization>>(secret, `/api/v2/organizations/${encodeURIComponent(externalId)}`); return result.data ? mapOrganization(result.data) : null; },
  getOpportunity: async ({ secret, externalId }) => { const result = await request<ItemResponse<Deal>>(secret, `/api/v2/deals/${encodeURIComponent(externalId)}`); return result.data ? mapDeal(result.data) : null; },
  createContact: async ({ secret, fields, correlationId }) => { const result = await request<ItemResponse<Person>>(secret, "/api/v2/persons", { method: "POST", body: JSON.stringify(fields) }); return evidence("create_contact", correlationId, { id: result.data?.id }); },
  createCompany: async ({ secret, fields, correlationId }) => { const result = await request<ItemResponse<Organization>>(secret, "/api/v2/organizations", { method: "POST", body: JSON.stringify(fields) }); return evidence("create_company", correlationId, { id: result.data?.id }); },
  createOpportunity: async ({ secret, fields, correlationId }) => { const result = await request<ItemResponse<Deal>>(secret, "/api/v2/deals", { method: "POST", body: JSON.stringify(fields) }); return evidence("create_opportunity", correlationId, { id: result.data?.id }); },
  createNote: async ({ secret, externalId, body, correlationId }) => { const result = await request<ItemResponse<{ id?: number }>>(secret, "/api/v1/notes", { method: "POST", body: JSON.stringify({ content: body, person_id: Number(externalId) }) }); return evidence("create_note", correlationId, { id: result.data?.id }); },
  createTask: async ({ secret, title, dueAt, contactExternalId, opportunityExternalId, correlationId }) => { const when = dueAt ? new Date(dueAt) : undefined; const payload: Record<string, unknown> = { subject: title, type: "task", done: false }; if (when && !Number.isNaN(when.valueOf())) { payload.due_date = when.toISOString().slice(0, 10); payload.due_time = when.toISOString().slice(11, 19); } if (contactExternalId) payload.person_id = Number(contactExternalId); if (opportunityExternalId) payload.deal_id = Number(opportunityExternalId); const result = await request<ItemResponse<Activity>>(secret, "/api/v2/activities", { method: "POST", body: JSON.stringify(payload) }); return evidence("create_task", correlationId, { id: result.data?.id }); },
  completeTask: async ({ secret, externalId, correlationId }) => { await request(secret, `/api/v2/activities/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify({ done: true }) }); return evidence("complete_task", correlationId, { externalId }); },
  updateContact: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/api/v2/persons/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify(patch) }); return evidence("update_contact", correlationId, { externalId }); },
  updateOpportunity: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/api/v2/deals/${encodeURIComponent(externalId)}`, { method: "PATCH", body: JSON.stringify(patch) }); return evidence("update_opportunity", correlationId, { externalId }); },
  createActivity: async ({ secret, activity, correlationId }) => { const result = await request<ItemResponse<Activity>>(secret, "/api/v2/activities", { method: "POST", body: JSON.stringify(activity) }); return evidence("create_activity", correlationId, { id: result.data?.id }); },
  listPipelines: async ({ secret }) => { const [pipelines, stages] = await Promise.all([request<ListResponse<Pipeline>>(secret, "/api/v2/pipelines?limit=500"), request<ListResponse<Stage>>(secret, "/api/v2/stages?limit=500")]); const allStages = stages.data || []; return (pipelines.data || []).map(pipeline => ({ externalId: String(pipeline.id), label: pipeline.name || `Pipeline ${pipeline.id}`, stages: allStages.filter(stage => stage.pipeline_id === pipeline.id).map(stage => ({ externalId: String(stage.id), label: stage.name || `Stage ${stage.id}` })) })); },
  healthCheck: async input => pipedriveAdapter.testConnection(input),
};
