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

const DEFAULT_ACCOUNTS = "https://accounts.zoho.com";
const DEFAULT_API = "https://www.zohoapis.com";
const VERSION = "v8";

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string; token_type?: string; scope?: string };
type ZohoList<T> = { data?: T[]; info?: { more_records?: boolean; page?: number; per_page?: number; count?: number } };
type ZohoRecordResponse = { data?: Array<{ details?: { id?: string }; status?: string; code?: string; message?: string }> };
type Owner = { id?: string; name?: string; email?: string };
type Contact = { id: string; Account_Name?: { id?: string }; Owner?: Owner; First_Name?: string; Last_Name?: string; Email?: string; Phone?: string; Modified_Time?: string };
type Account = { id: string; Owner?: Owner; Account_Name?: string; Website?: string; Modified_Time?: string };
type Deal = { id: string; Account_Name?: { id?: string }; Contact_Name?: { id?: string }; Owner?: Owner; Deal_Name?: string; Pipeline?: string; Stage?: string; Amount?: number; Currency?: string; Closing_Date?: string; Last_Activity_Time?: string; Next_Step?: string; Modified_Time?: string };
type Task = { id: string; Who_Id?: { id?: string }; What_Id?: { id?: string }; Owner?: Owner; Subject?: string; Status?: string; Due_Date?: string; Closed_Time?: string; Modified_Time?: string; Description?: string };
type Call = { id: string; Who_Id?: { id?: string }; What_Id?: { id?: string }; Owner?: Owner; Subject?: string; Call_Type?: string; Call_Start_Time?: string; Description?: string; Modified_Time?: string };

function clientConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Zoho OAuth is not configured. Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET.");
  return { clientId, clientSecret, accountsUrl: (process.env.ZOHO_ACCOUNTS_URL || DEFAULT_ACCOUNTS).replace(/\/$/, "") };
}

function evidence(operation: string, correlationId: string, providerResult: Record<string, unknown>): AdapterEvidence {
  return { operation, correlationId, completedAt: new Date().toISOString(), providerResult };
}
function date(value?: string | null) { if (!value) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? undefined : parsed; }
function moneyMinor(value?: number | null) { return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined; }

async function tokenRequest(accountsUrl: string, values: Record<string, string>) {
  const response = await fetch(`${accountsUrl.replace(/\/$/, "")}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(values) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Zoho OAuth ${response.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as TokenResponse;
}

function apiBase(secret: ConnectionSecretPayload) { return (secret.apiBaseUrl || DEFAULT_API).replace(/\/$/, ""); }
async function request<T>(secret: ConnectionSecretPayload, path: string, init: RequestInit = {}) {
  if (!secret.accessToken) throw new Error("Zoho access token is unavailable; reconnect the organisation.");
  const response = await fetch(`${apiBase(secret)}${path}`, { ...init, headers: { Authorization: `Zoho-oauthtoken ${secret.accessToken}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Zoho CRM API ${response.status}: ${text.slice(0, 800)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function pageFromCursor(cursor?: string) { const page = Number(cursor || "1"); return Number.isInteger(page) && page > 0 ? page : 1; }
function nextPage<T>(response: ZohoList<T>, page: number) { return response.info?.more_records ? String(page + 1) : undefined; }
function mapContact(row: Contact): NormalizedContact { return { externalId: row.id, companyExternalId: row.Account_Name?.id, ownerExternalId: row.Owner?.id, firstName: row.First_Name, lastName: row.Last_Name, email: row.Email, phone: row.Phone, sourceUpdatedAt: date(row.Modified_Time), sourceRevision: row.Modified_Time, raw: row as unknown as Record<string, unknown> }; }
function mapAccount(row: Account): NormalizedCompany { return { externalId: row.id, ownerExternalId: row.Owner?.id, name: row.Account_Name || "Unnamed account", website: row.Website, sourceUpdatedAt: date(row.Modified_Time), sourceRevision: row.Modified_Time, raw: row as unknown as Record<string, unknown> }; }
function mapDeal(row: Deal): NormalizedOpportunity { return { externalId: row.id, companyExternalId: row.Account_Name?.id, contactExternalId: row.Contact_Name?.id, ownerExternalId: row.Owner?.id, name: row.Deal_Name || "Unnamed deal", pipeline: row.Pipeline, stage: row.Stage, valueMinor: moneyMinor(row.Amount), currency: row.Currency, closeAt: date(row.Closing_Date), lastActivityAt: date(row.Last_Activity_Time), sourceUpdatedAt: date(row.Modified_Time), sourceRevision: row.Modified_Time, raw: row as unknown as Record<string, unknown> }; }
function mapTask(row: Task): NormalizedTask { return { externalId: row.id, contactExternalId: row.Who_Id?.id, opportunityExternalId: row.What_Id?.id, ownerExternalId: row.Owner?.id, title: row.Subject || "Task", status: row.Status || "Unknown", dueAt: date(row.Due_Date), completedAt: date(row.Closed_Time), sourceUpdatedAt: date(row.Modified_Time), sourceRevision: row.Modified_Time, raw: row as unknown as Record<string, unknown> }; }
function mapCall(row: Call): NormalizedActivity { return { externalId: row.id, contactExternalId: row.Who_Id?.id, opportunityExternalId: row.What_Id?.id, ownerExternalId: row.Owner?.id, activityType: row.Call_Type || "call", occurredAt: date(row.Call_Start_Time) || date(row.Modified_Time) || new Date(), body: row.Description || row.Subject, sourceRevision: row.Modified_Time, raw: row as unknown as Record<string, unknown> }; }

const supported: CrmCapability[] = [
  "contacts.read", "contacts.write", "companies.read", "companies.write", "opportunities.read", "opportunities.write",
  "tasks.read", "tasks.write", "activities.read", "activities.write", "notes.read", "notes.write", "owners.read", "pipelines.read",
];
function capabilities(connection: Parameters<CrmAdapter["testConnection"]>[0]["connection"]): CapabilityResult[] {
  return Array.from(new Set([...connection.allowedReadCapabilities, ...connection.allowedWriteCapabilities])).filter((cap): cap is CrmCapability => supported.includes(cap as CrmCapability)).map(capability => ({ capability, available: true, detail: "Zoho CRM V8 module capability available subject to OAuth scope and CRM profile permissions." }));
}

function recordId(response: ZohoRecordResponse) { return response.data?.[0]?.details?.id; }

export const zohoAdapter: CrmAdapter = {
  provider: "zoho",
  createAuthorizationUrl: ({ state, redirectUri }) => {
    const { clientId, accountsUrl } = clientConfig();
    const url = new URL(`${accountsUrl}/oauth/v2/auth`);
    url.searchParams.set("scope", "ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.users.READ");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  },
  exchangeAuthorizationCode: async ({ code, redirectUri, callbackParams }) => {
    const { clientId, clientSecret, accountsUrl: configuredAccounts } = clientConfig();
    const accountsUrl = callbackParams?.["accounts-server"] || configuredAccounts;
    const result = await tokenRequest(accountsUrl, { grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
    if (!result.access_token) throw new Error("Zoho token exchange returned no access token.");
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(), apiBaseUrl: result.api_domain || DEFAULT_API, accountsUrl, tokenType: result.token_type, scopes: result.scope?.split(/[ ,]+/).filter(Boolean) };
  },
  disconnect: async ({ correlationId }) => evidence("disconnect", correlationId, { localCredentialsRemoved: true, note: "Revoke the Zoho grant in the Zoho account security console when provider-side revocation is required." }),
  refreshAuthentication: async ({ secret }) => {
    if (!secret.refreshToken) throw new Error("Zoho refresh token is unavailable; reconnect the organisation.");
    const { clientId, clientSecret, accountsUrl } = clientConfig();
    const result = await tokenRequest(secret.accountsUrl || accountsUrl, { grant_type: "refresh_token", refresh_token: secret.refreshToken, client_id: clientId, client_secret: clientSecret });
    if (!result.access_token) throw new Error("Zoho token refresh returned no access token.");
    return { ...secret, accessToken: result.access_token, expiresAt: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(), apiBaseUrl: result.api_domain || secret.apiBaseUrl, tokenType: result.token_type || secret.tokenType };
  },
  testConnection: async ({ connection, secret, correlationId }): Promise<ConnectionTest> => {
    try {
      const users = await request<{ users?: Array<{ id?: string; full_name?: string; status?: string }> }>(secret || {}, `/crm/${VERSION}/users?type=CurrentUser`);
      const current = users.users?.[0];
      if (!current?.id) throw new Error("Zoho did not return the current CRM user.");
      const caps = capabilities(connection);
      return { status: caps.length ? "ready" : "limited", summary: `${caps.length} requested Zoho CRM V8 capabilities available.`, capabilities: caps, accountExternalId: secret?.accountExternalId || current.id, scopes: secret?.scopes, evidence: [evidence("zoho_current_user", correlationId, { userId: current.id, name: current.full_name, status: current.status })] };
    } catch (error) {
      return { status: "failed", summary: error instanceof Error ? error.message : String(error), capabilities: [], evidence: [{ operation: "zoho_health", correlationId, completedAt: new Date().toISOString(), errorClassification: "authentication", retryable: false }] };
    }
  },
  discoverCapabilities: async ({ connection, secret, correlationId }) => (await zohoAdapter.testConnection({ connection, secret, correlationId })).capabilities,
  syncContacts: async ({ secret, cursor }) => { const page = pageFromCursor(cursor); const result = await request<ZohoList<Contact>>(secret, `/crm/${VERSION}/Contacts?fields=id,Account_Name,Owner,First_Name,Last_Name,Email,Phone,Modified_Time&per_page=200&page=${page}`); return { records: (result.data || []).map(mapContact), cursor: nextPage(result, page) }; },
  syncCompanies: async ({ secret, cursor }) => { const page = pageFromCursor(cursor); const result = await request<ZohoList<Account>>(secret, `/crm/${VERSION}/Accounts?fields=id,Owner,Account_Name,Website,Modified_Time&per_page=200&page=${page}`); return { records: (result.data || []).map(mapAccount), cursor: nextPage(result, page) }; },
  syncOpportunities: async ({ secret, cursor }) => { const page = pageFromCursor(cursor); const result = await request<ZohoList<Deal>>(secret, `/crm/${VERSION}/Deals?fields=id,Account_Name,Contact_Name,Owner,Deal_Name,Pipeline,Stage,Amount,Currency,Closing_Date,Last_Activity_Time,Next_Step,Modified_Time&per_page=200&page=${page}`); return { records: (result.data || []).map(mapDeal), cursor: nextPage(result, page) }; },
  syncTasks: async ({ secret, cursor }) => { const page = pageFromCursor(cursor); const result = await request<ZohoList<Task>>(secret, `/crm/${VERSION}/Tasks?fields=id,Who_Id,What_Id,Owner,Subject,Status,Due_Date,Closed_Time,Modified_Time,Description&per_page=200&page=${page}`); return { records: (result.data || []).map(mapTask), cursor: nextPage(result, page) }; },
  syncActivities: async ({ secret, cursor }) => { const page = pageFromCursor(cursor); const result = await request<ZohoList<Call>>(secret, `/crm/${VERSION}/Calls?fields=id,Who_Id,What_Id,Owner,Subject,Call_Type,Call_Start_Time,Description,Modified_Time&per_page=200&page=${page}`); return { records: (result.data || []).map(mapCall), cursor: nextPage(result, page) }; },
  searchContacts: async ({ secret, query }) => { const escaped = query.trim().replace(/[()]/g, " ").slice(0, 120); const result = await request<ZohoList<Contact>>(secret, `/crm/${VERSION}/Contacts/search?word=${encodeURIComponent(escaped)}&fields=id,Account_Name,Owner,First_Name,Last_Name,Email,Phone,Modified_Time&per_page=20`); return (result.data || []).map(mapContact); },
  getContact: async ({ secret, externalId }) => { const result = await request<ZohoList<Contact>>(secret, `/crm/${VERSION}/Contacts/${encodeURIComponent(externalId)}?fields=id,Account_Name,Owner,First_Name,Last_Name,Email,Phone,Modified_Time`); return result.data?.[0] ? mapContact(result.data[0]) : null; },
  getCompany: async ({ secret, externalId }) => { const result = await request<ZohoList<Account>>(secret, `/crm/${VERSION}/Accounts/${encodeURIComponent(externalId)}?fields=id,Owner,Account_Name,Website,Modified_Time`); return result.data?.[0] ? mapAccount(result.data[0]) : null; },
  getOpportunity: async ({ secret, externalId }) => { const result = await request<ZohoList<Deal>>(secret, `/crm/${VERSION}/Deals/${encodeURIComponent(externalId)}?fields=id,Account_Name,Contact_Name,Owner,Deal_Name,Pipeline,Stage,Amount,Currency,Closing_Date,Last_Activity_Time,Next_Step,Modified_Time`); return result.data?.[0] ? mapDeal(result.data[0]) : null; },
  createContact: async ({ secret, fields, correlationId }) => { const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Contacts`, { method: "POST", body: JSON.stringify({ data: [fields] }) }); return evidence("create_contact", correlationId, { id: recordId(result) }); },
  createCompany: async ({ secret, fields, correlationId }) => { const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Accounts`, { method: "POST", body: JSON.stringify({ data: [fields] }) }); return evidence("create_company", correlationId, { id: recordId(result) }); },
  createOpportunity: async ({ secret, fields, correlationId }) => { const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Deals`, { method: "POST", body: JSON.stringify({ data: [fields] }) }); return evidence("create_opportunity", correlationId, { id: recordId(result) }); },
  createNote: async ({ secret, externalId, body, correlationId }) => { const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Contacts/${encodeURIComponent(externalId)}/Notes`, { method: "POST", body: JSON.stringify({ data: [{ Note_Title: "Amarktai note", Note_Content: body }] }) }); return evidence("create_note", correlationId, { id: recordId(result) }); },
  createTask: async ({ secret, title, dueAt, contactExternalId, opportunityExternalId, correlationId }) => { const fields: Record<string, unknown> = { Subject: title, Status: "Not Started" }; if (dueAt) fields.Due_Date = dueAt.slice(0, 10); if (contactExternalId) fields.Who_Id = contactExternalId; if (opportunityExternalId) fields.What_Id = opportunityExternalId; const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Tasks`, { method: "POST", body: JSON.stringify({ data: [fields] }) }); return evidence("create_task", correlationId, { id: recordId(result) }); },
  completeTask: async ({ secret, externalId, correlationId }) => { await request(secret, `/crm/${VERSION}/Tasks/${encodeURIComponent(externalId)}`, { method: "PUT", body: JSON.stringify({ data: [{ Status: "Completed" }] }) }); return evidence("complete_task", correlationId, { externalId }); },
  updateContact: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/crm/${VERSION}/Contacts/${encodeURIComponent(externalId)}`, { method: "PUT", body: JSON.stringify({ data: [patch] }) }); return evidence("update_contact", correlationId, { externalId }); },
  updateOpportunity: async ({ secret, externalId, patch, correlationId }) => { await request(secret, `/crm/${VERSION}/Deals/${encodeURIComponent(externalId)}`, { method: "PUT", body: JSON.stringify({ data: [patch] }) }); return evidence("update_opportunity", correlationId, { externalId }); },
  createActivity: async ({ secret, activity, correlationId }) => { const result = await request<ZohoRecordResponse>(secret, `/crm/${VERSION}/Calls`, { method: "POST", body: JSON.stringify({ data: [activity] }) }); return evidence("create_activity", correlationId, { id: recordId(result) }); },
  listPipelines: async ({ secret, connection }) => {
    const layoutId = typeof connection.configuration.zohoDealsLayoutId === "string" ? connection.configuration.zohoDealsLayoutId : undefined;
    if (layoutId) {
      const response = await request<{ pipeline?: Array<{ id?: string; display_value?: string; maps?: Array<{ id?: string; display_value?: string; actual_value?: string }> }> }>(secret, `/crm/${VERSION}/settings/pipeline?layout_id=${encodeURIComponent(layoutId)}`);
      return (response.pipeline || []).map(pipeline => ({ externalId: pipeline.id || pipeline.display_value || "pipeline", label: pipeline.display_value || "Deals", stages: (pipeline.maps || []).map(stage => ({ externalId: stage.id || stage.actual_value || stage.display_value || "stage", label: stage.display_value || stage.actual_value || "Stage" })) }));
    }
    return [{ externalId: "Deals", label: "Deals", stages: [] }];
  },
  healthCheck: async input => zohoAdapter.testConnection(input),
};
