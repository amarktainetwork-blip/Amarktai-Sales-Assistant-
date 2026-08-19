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

const DEFAULT_LOGIN_BASE = "https://login.salesforce.com";
const DEFAULT_API_VERSION = "v67.0";

type SalesforceToken = {
  access_token?: string;
  refresh_token?: string;
  instance_url?: string;
  id?: string;
  scope?: string;
  token_type?: string;
  issued_at?: string;
};

type QueryResponse<T> = { totalSize?: number; done?: boolean; nextRecordsUrl?: string; records?: T[] };
type SfContact = { Id: string; AccountId?: string; OwnerId?: string; FirstName?: string; LastName?: string; Email?: string; Phone?: string; LastModifiedDate?: string };
type SfAccount = { Id: string; OwnerId?: string; Name?: string; Website?: string; LastModifiedDate?: string };
type SfOpportunity = { Id: string; AccountId?: string; OwnerId?: string; Name?: string; StageName?: string; Amount?: number; CurrencyIsoCode?: string; CloseDate?: string; LastActivityDate?: string; NextStep?: string; LastModifiedDate?: string };
type SfTask = { Id: string; WhoId?: string; WhatId?: string; OwnerId?: string; Subject?: string; Status?: string; ActivityDate?: string; CompletedDateTime?: string; LastModifiedDate?: string; Description?: string; TaskSubtype?: string };
type SfEvent = { Id: string; WhoId?: string; WhatId?: string; OwnerId?: string; Subject?: string; StartDateTime?: string; Description?: string; LastModifiedDate?: string };

function clientConfig() {
  const clientId = process.env.SALESFORCE_CLIENT_ID?.trim();
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Salesforce OAuth is not configured. Set SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET.");
  return { clientId, clientSecret, loginBase: (process.env.SALESFORCE_LOGIN_BASE || DEFAULT_LOGIN_BASE).replace(/\/$/, ""), apiVersion: process.env.SALESFORCE_API_VERSION || DEFAULT_API_VERSION };
}

function evidence(operation: string, correlationId: string, providerResult: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult };
}

function date(value?: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function moneyMinor(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

function escapeSoql(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function form<T>(url: string, body: Record<string, string>) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Salesforce OAuth ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function base(secret: ConnectionSecretPayload) {
  const url = secret.instanceUrl || secret.apiBaseUrl;
  if (!url) throw new Error("Salesforce instance URL is unavailable; reconnect the organisation.");
  return url.replace(/\/$/, "");
}

async function request<T>(secret: ConnectionSecretPayload, path: string, init: RequestInit = {}) {
  if (!secret.accessToken) throw new Error("Salesforce access token is unavailable; reconnect the organisation.");
  const response = await fetch(`${base(secret)}${path}`, { ...init, headers: { Authorization: `Bearer ${secret.accessToken}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Salesforce API ${response.status}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function apiPath(suffix: string) {
  return `/services/data/${clientConfig().apiVersion}${suffix}`;
}

async function query<T>(secret: ConnectionSecretPayload, soql: string, cursor?: string) {
  const path = cursor || apiPath(`/query?q=${encodeURIComponent(soql)}`);
  return request<QueryResponse<T>>(secret, path);
}

function mapContact(row: SfContact): NormalizedContact {
  return { externalId: row.Id, companyExternalId: row.AccountId, ownerExternalId: row.OwnerId, firstName: row.FirstName, lastName: row.LastName, email: row.Email, phone: row.Phone, sourceUpdatedAt: date(row.LastModifiedDate), sourceRevision: row.LastModifiedDate, raw: row as unknown as Record<string, unknown> };
}
function mapCompany(row: SfAccount): NormalizedCompany {
  return { externalId: row.Id, ownerExternalId: row.OwnerId, name: row.Name || "Unnamed account", website: row.Website, sourceUpdatedAt: date(row.LastModifiedDate), sourceRevision: row.LastModifiedDate, raw: row as unknown as Record<string, unknown> };
}
function mapOpportunity(row: SfOpportunity): NormalizedOpportunity {
  return { externalId: row.Id, companyExternalId: row.AccountId, ownerExternalId: row.OwnerId, name: row.Name || "Unnamed opportunity", pipeline: "Opportunity", stage: row.StageName, valueMinor: moneyMinor(row.Amount), currency: row.CurrencyIsoCode, closeAt: date(row.CloseDate), lastActivityAt: date(row.LastActivityDate), sourceUpdatedAt: date(row.LastModifiedDate), sourceRevision: row.LastModifiedDate, raw: row as unknown as Record<string, unknown> };
}
function mapTask(row: SfTask): NormalizedTask {
  return { externalId: row.Id, contactExternalId: row.WhoId, opportunityExternalId: row.WhatId, ownerExternalId: row.OwnerId, title: row.Subject || "Task", status: row.Status || "Unknown", dueAt: date(row.ActivityDate), completedAt: date(row.CompletedDateTime), sourceUpdatedAt: date(row.LastModifiedDate), sourceRevision: row.LastModifiedDate, raw: row as unknown as Record<string, unknown> };
}
function mapEvent(row: SfEvent): NormalizedActivity {
  return { externalId: row.Id, contactExternalId: row.WhoId, opportunityExternalId: row.WhatId, ownerExternalId: row.OwnerId, activityType: "event", occurredAt: date(row.StartDateTime) || date(row.LastModifiedDate) || new Date(), body: row.Description || row.Subject, sourceRevision: row.LastModifiedDate, raw: row as unknown as Record<string, unknown> };
}

const supported: CrmCapability[] = [
  "contacts.read", "contacts.write", "companies.read", "companies.write", "opportunities.read", "opportunities.write",
  "tasks.read", "tasks.write", "activities.read", "activities.write", "notes.read", "notes.write", "owners.read", "pipelines.read",
];

function capabilities(connection: Parameters<CrmAdapter["testConnection"]>[0]["connection"]): CapabilityResult[] {
  const requested = new Set([...connection.allowedReadCapabilities, ...connection.allowedWriteCapabilities]);
  return Array.from(requested).filter((item): item is CrmCapability => supported.includes(item as CrmCapability)).map(capability => ({ capability, available: true, detail: "Salesforce API capability is available subject to the connected user's object and field permissions." }));
}

export const salesforceAdapter: CrmAdapter = {
  provider: "salesforce",
  createAuthorizationUrl: ({ state, redirectUri }) => {
    const { clientId, loginBase } = clientConfig();
    const url = new URL(`${loginBase}/services/oauth2/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "api refresh_token offline_access");
    return url.toString();
  },
  exchangeAuthorizationCode: async ({ code, redirectUri }) => {
    const { clientId, clientSecret, loginBase } = clientConfig();
    const token = await form<SalesforceToken>(`${loginBase}/services/oauth2/token`, { grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
    if (!token.access_token || !token.instance_url) throw new Error("Salesforce token exchange returned no access token or instance URL.");
    return { accessToken: token.access_token, refreshToken: token.refresh_token, instanceUrl: token.instance_url, apiBaseUrl: token.instance_url, accountExternalId: token.id, scopes: token.scope?.split(/\s+/).filter(Boolean), tokenType: token.token_type };
  },
  disconnect: async ({ secret, correlationId }) => {
    const { loginBase } = clientConfig();
    if (secret?.accessToken || secret?.refreshToken) {
      const token = secret.refreshToken || secret.accessToken!;
      const response = await fetch(`${loginBase}/services/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
      if (!response.ok && response.status !== 400) throw new Error(`Salesforce token revocation failed with ${response.status}.`);
    }
    return evidence("disconnect", correlationId, { revoked: Boolean(secret?.accessToken || secret?.refreshToken) });
  },
  refreshAuthentication: async ({ secret }) => {
    if (!secret.refreshToken) throw new Error("Salesforce refresh token is unavailable; reconnect the organisation.");
    const { clientId, clientSecret, loginBase } = clientConfig();
    const token = await form<SalesforceToken>(`${loginBase}/services/oauth2/token`, { grant_type: "refresh_token", refresh_token: secret.refreshToken, client_id: clientId, client_secret: clientSecret });
    if (!token.access_token) throw new Error("Salesforce token refresh returned no access token.");
    return { ...secret, accessToken: token.access_token, instanceUrl: token.instance_url || secret.instanceUrl, apiBaseUrl: token.instance_url || secret.apiBaseUrl, tokenType: token.token_type || secret.tokenType };
  },
  testConnection: async ({ connection, secret, correlationId }): Promise<ConnectionTest> => {
    try {
      const limits = await request<Record<string, unknown>>(secret || {}, apiPath("/limits"));
      const caps = capabilities(connection);
      return { status: caps.length ? "ready" : "limited", summary: `${caps.length} requested Salesforce capabilities available; object permissions are enforced by Salesforce.`, capabilities: caps, evidence: [evidence("salesforce_limits", correlationId, { reachable: true, limitKeys: Object.keys(limits).slice(0, 12) })], accountExternalId: secret?.accountExternalId, scopes: secret?.scopes };
    } catch (error) {
      return { status: "failed", summary: error instanceof Error ? error.message : String(error), capabilities: [], evidence: [{ operation: "salesforce_health", correlationId, completedAt: new Date().toISOString(), errorClassification: "authentication", retryable: false }] };
    }
  },
  discoverCapabilities: async ({ connection, secret, correlationId }) => (await salesforceAdapter.testConnection({ connection, secret, correlationId })).capabilities,
  syncContacts: async ({ secret, cursor }) => { const page = await query<SfContact>(secret, "SELECT Id,AccountId,OwnerId,FirstName,LastName,Email,Phone,LastModifiedDate FROM Contact ORDER BY LastModifiedDate ASC LIMIT 200", cursor); return { records: (page.records || []).map(mapContact), cursor: page.done ? undefined : page.nextRecordsUrl }; },
  syncCompanies: async ({ secret, cursor }) => { const page = await query<SfAccount>(secret, "SELECT Id,OwnerId,Name,Website,LastModifiedDate FROM Account ORDER BY LastModifiedDate ASC LIMIT 200", cursor); return { records: (page.records || []).map(mapCompany), cursor: page.done ? undefined : page.nextRecordsUrl }; },
  syncOpportunities: async ({ secret, cursor }) => { const page = await query<SfOpportunity>(secret, "SELECT Id,AccountId,OwnerId,Name,StageName,Amount,CurrencyIsoCode,CloseDate,LastActivityDate,NextStep,LastModifiedDate FROM Opportunity ORDER BY LastModifiedDate ASC LIMIT 200", cursor); return { records: (page.records || []).map(mapOpportunity), cursor: page.done ? undefined : page.nextRecordsUrl }; },
  syncTasks: async ({ secret, cursor }) => { const page = await query<SfTask>(secret, "SELECT Id,WhoId,WhatId,OwnerId,Subject,Status,ActivityDate,CompletedDateTime,LastModifiedDate,Description,TaskSubtype FROM Task ORDER BY LastModifiedDate ASC LIMIT 200", cursor); return { records: (page.records || []).map(mapTask), cursor: page.done ? undefined : page.nextRecordsUrl }; },
  syncActivities: async ({ secret, cursor }) => { const page = await query<SfEvent>(secret, "SELECT Id,WhoId,WhatId,OwnerId,Subject,StartDateTime,Description,LastModifiedDate FROM Event ORDER BY LastModifiedDate ASC LIMIT 200", cursor); return { records: (page.records || []).map(mapEvent), cursor: page.done ? undefined : page.nextRecordsUrl }; },
  searchContacts: async ({ secret, query: term }) => { const escaped = escapeSoql(term.trim()).slice(0, 120); const page = await query<SfContact>(secret, `SELECT Id,AccountId,OwnerId,FirstName,LastName,Email,Phone,LastModifiedDate FROM Contact WHERE Name LIKE '%${escaped}%' OR Email LIKE '%${escaped}%' LIMIT 20`); return (page.records || []).map(mapContact); },
  getContact: async ({ secret, externalId }) => { try { return mapContact(await request<SfContact>(secret, apiPath(`/sobjects/Contact/${encodeURIComponent(externalId)}?fields=Id,AccountId,OwnerId,FirstName,LastName,Email,Phone,LastModifiedDate`))); } catch { return null; } },
  getCompany: async ({ secret, externalId }) => { try { return mapCompany(await request<SfAccount>(secret, apiPath(`/sobjects/Account/${encodeURIComponent(externalId)}?fields=Id,OwnerId,Name,Website,LastModifiedDate`))); } catch { return null; } },
  getOpportunity: async ({ secret, externalId }) => { try { return mapOpportunity(await request<SfOpportunity>(secret, apiPath(`/sobjects/Opportunity/${encodeURIComponent(externalId)}?fields=Id,AccountId,OwnerId,Name,StageName,Amount,CurrencyIsoCode,CloseDate,LastActivityDate,NextStep,LastModifiedDate`))); } catch { return null; } },
  createContact: async ({ secret, fields, correlationId }) => { const result = await request<{ id?: string; success?: boolean }>(secret, apiPath("/sobjects/Contact"), { method: "POST", body: JSON.stringify(fields) }); return evidence("create_contact", correlationId, { id: result.id, success: result.success }); },
  createCompany: async ({ secret, fields, correlationId }) => { const result = await request<{ id?: string; success?: boolean }>(secret, apiPath("/sobjects/Account"), { method: "POST", body: JSON.stringify(fields) }); return evidence("create_company", correlationId, { id: result.id, success: result.success }); },
  createOpportunity: async ({ secret, fields, correlationId }) => { const result = await request<{ id?: string; success?: boolean }>(secret, apiPath("/sobjects/Opportunity"), { method: "POST", body: JSON.stringify(fields) }); return evidence("create_opportunity", correlationId, { id: result.id, success: result.success }); },
  createNote: async ({ secret, externalId, body, correlationId }) => { const result = await request<{ id?: string }>(secret, apiPath("/sobjects/Note"), { method: "POST", body: JSON.stringify({ ParentId: externalId, Title: "Amarktai note", Body: body }) }); return evidence("create_note", correlationId, { id: result.id }); },
  createTask: async ({ secret, title, dueAt, contactExternalId, opportunityExternalId, correlationId }) => { const payload: Record<string, unknown> = { Subject: title, Status: "Not Started", Priority: "Normal" }; if (dueAt) payload.ActivityDate = dueAt.slice(0, 10); if (contactExternalId) payload.WhoId = contactExternalId; if (opportunityExternalId) payload.WhatId = opportunityExternalId; const result = await request<{ id?: string }>(secret, apiPath("/sobjects/Task"), { method: "POST", body: JSON.stringify(payload) }); return evidence("create_task", correlationId, { id: result.id }); },
  completeTask: async ({ secret, externalId, correlationId }) => { await request(secret, apiPath(`/sobjects/Task/${encodeURIComponent(externalId)}`), { method: "PATCH", body: JSON.stringify({ Status: "Completed" }) }); return evidence("complete_task", correlationId, { externalId }); },
  updateContact: async ({ secret, externalId, patch, correlationId }) => { await request(secret, apiPath(`/sobjects/Contact/${encodeURIComponent(externalId)}`), { method: "PATCH", body: JSON.stringify(patch) }); return evidence("update_contact", correlationId, { externalId }); },
  updateOpportunity: async ({ secret, externalId, patch, correlationId }) => { await request(secret, apiPath(`/sobjects/Opportunity/${encodeURIComponent(externalId)}`), { method: "PATCH", body: JSON.stringify(patch) }); return evidence("update_opportunity", correlationId, { externalId }); },
  createActivity: async ({ secret, activity, correlationId }) => { const result = await request<{ id?: string }>(secret, apiPath("/sobjects/Task"), { method: "POST", body: JSON.stringify({ Subject: String(activity.subject || activity.title || "Amarktai activity"), Status: String(activity.status || "Completed"), Description: activity.body || activity.description, WhoId: activity.contactExternalId, WhatId: activity.opportunityExternalId }) }); return evidence("create_activity", correlationId, { id: result.id }); },
  listPipelines: async ({ secret }) => { const describe = await request<{ fields?: Array<{ name?: string; picklistValues?: Array<{ value?: string; label?: string; active?: boolean }> }> }>(secret, apiPath("/sobjects/Opportunity/describe")); const stages = describe.fields?.find(field => field.name === "StageName")?.picklistValues?.filter(value => value.active !== false).map(value => ({ externalId: value.value || "", label: value.label || value.value || "" })) || []; return [{ externalId: "Opportunity", label: "Opportunity", stages }]; },
  healthCheck: async input => salesforceAdapter.testConnection(input),
};
