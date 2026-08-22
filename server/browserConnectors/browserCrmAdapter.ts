import { readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertAuthorisedConnectionUrl, loadConnectionSecret } from "../connectedSystems";
import type {
  AdapterConnection,
  AdapterEvidence,
  CapabilityResult,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmAdapter,
  CrmCapability,
  CrmProvider,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
  OutboundMessageInput,
} from "../crm/types";
import { executeSavedBrowserScript, validateSavedBrowserScript, type SavedBrowserScript } from "./scriptEngine";

const DEFAULT_GENIE_OPERATION_MAP: Record<string, string> = {
  searchContacts: "search_candidate",
  getContact: "read_candidate_history",
  createNote: "add_note",
  createTask: "create_next_task",
  completeTask: "complete_active_task",
  updateContact: "update_contact_status",
  updateOpportunity: "update_current_opportunity",
  sendSms: "send_template_sms",
  sendEmail: "send_template_email",
  sendWhatsApp: "send_template_whatsapp",
  applySequence: "apply_sequence",
  healthCheck: "health_check",
};

const CAPABILITY_OPERATIONS: Record<CrmCapability, string[]> = {
  "contacts.read": ["searchContacts", "getContact", "syncContacts"],
  "contacts.write": ["createContact", "updateContact"],
  "companies.read": ["getCompany", "syncCompanies"],
  "companies.write": ["createCompany"],
  "opportunities.read": ["getOpportunity", "syncOpportunities"],
  "opportunities.write": ["createOpportunity", "updateOpportunity"],
  "tasks.read": ["syncTasks", "getContact"],
  "tasks.write": ["createTask", "completeTask"],
  "activities.read": ["syncActivities", "getContact"],
  "activities.write": ["createActivity"],
  "notes.read": ["getContact"],
  "notes.write": ["createNote"],
  "owners.read": ["syncContacts", "syncTasks"],
  "pipelines.read": ["listPipelines", "syncOpportunities"],
  "email.send": ["sendEmail"],
  "sms.send": ["sendSms"],
  "whatsapp.send": ["sendWhatsApp"],
  "sequences.apply": ["applySequence"],
};

type BrowserLoginProfile = { url: string; usernameSelector?: string; passwordSelector?: string; submitSelector?: string; readySelector: string };
type BrowserProfile = {
  browserEndpoint?: string;
  login?: BrowserLoginProfile;
  scripts: Record<string, SavedBrowserScript>;
  operationMap?: Record<string, string>;
  resultKeys?: Record<string, string>;
  artifactDirectory?: string;
};

function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function asProfile(value: unknown): BrowserProfile | undefined {
  if (!isObject(value) || !isObject(value.scripts)) return undefined;
  const scripts: Record<string, SavedBrowserScript> = {};
  for (const [key, script] of Object.entries(value.scripts)) if (isObject(script) && Array.isArray(script.steps)) scripts[key] = validateSavedBrowserScript(script as unknown as SavedBrowserScript);
  if (!Object.keys(scripts).length) return undefined;
  const login = isObject(value.login) && typeof value.login.url === "string" && typeof value.login.readySelector === "string" ? value.login as unknown as BrowserLoginProfile : undefined;
  return {
    browserEndpoint: typeof value.browserEndpoint === "string" ? value.browserEndpoint : undefined,
    login,
    scripts,
    operationMap: isObject(value.operationMap) ? Object.fromEntries(Object.entries(value.operationMap).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined,
    resultKeys: isObject(value.resultKeys) ? Object.fromEntries(Object.entries(value.resultKeys).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined,
    artifactDirectory: typeof value.artifactDirectory === "string" ? value.artifactDirectory : undefined,
  };
}

async function genieProfile(): Promise<BrowserProfile | undefined> {
  const path = process.env.GENIE_SCRIPTS_CONFIG_PATH || "/app/config/genie-scripts.json";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { scripts?: Record<string, SavedBrowserScript> };
    if (!parsed.scripts) return undefined;
    const loginUrl = process.env.GENIE_LOGIN_URL;
    return {
      browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT,
      login: loginUrl ? { url: loginUrl, usernameSelector: process.env.GENIE_USERNAME_SELECTOR || 'input[name="username"]', passwordSelector: process.env.GENIE_PASSWORD_SELECTOR || 'input[type="password"]', submitSelector: process.env.GENIE_LOGIN_SUBMIT_SELECTOR || 'button[type="submit"]', readySelector: process.env.GENIE_DASHBOARD_SELECTOR || "body" } : undefined,
      scripts: Object.fromEntries(Object.entries(parsed.scripts).map(([key, script]) => [key, validateSavedBrowserScript(script)])),
      operationMap: DEFAULT_GENIE_OPERATION_MAP,
      artifactDirectory: process.env.GENIE_ARTIFACT_DIR || "/app/data/genie-artifacts",
    };
  } catch { return undefined; }
}

async function profileFor(connection: AdapterConnection, provider: Extract<CrmProvider, "genie" | "custom_browser">) {
  return asProfile(connection.configuration.browserProfile) || (provider === "genie" ? genieProfile() : undefined);
}
async function browserSecret(connection: AdapterConnection, supplied?: ConnectionSecretPayload) {
  if (supplied && Object.keys(supplied).length) return supplied;
  return (await loadConnectionSecret({ organisationId: connection.organisationId, connectedSystemId: connection.id, secretKind: "browser" })) || {};
}
function credentials(secret?: ConnectionSecretPayload, provider?: string) {
  const fromSecret = secret?.credentials || {};
  if (Object.keys(fromSecret).length) return fromSecret;
  if (provider === "genie") return { username: process.env.GENIE_USERNAME || "", password: process.env.GENIE_PASSWORD || "" };
  return {};
}
function operationScript(profile: BrowserProfile, operation: string) { const key = profile.operationMap?.[operation] || operation; return profile.scripts[key]; }
function artifactDirectory(profile: BrowserProfile, connection: AdapterConnection) { return profile.artifactDirectory || `/app/data/browser-artifacts/${connection.organisationId}/${connection.id}`; }
async function connect(profile: BrowserProfile) { const endpoint = profile.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT; if (!endpoint) throw new Error("No Chromium/CDP endpoint is configured for this browser connector."); return chromium.connectOverCDP(endpoint); }
async function authorizeNavigation(connection: AdapterConnection, rawUrl: string) {
  await assertAuthorisedConnectionUrl({ organisationId: connection.organisationId, connectedSystemId: connection.id, rawUrl });
}
async function authenticate(page: Page, connection: AdapterConnection, profile: BrowserProfile, secret: ConnectionSecretPayload, provider: string) {
  if (!profile.login) return;
  const creds = credentials(secret, provider);
  await authorizeNavigation(connection, profile.login.url);
  await page.goto(profile.login.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await authorizeNavigation(connection, page.url());
  if (profile.login.usernameSelector) { if (!creds.username) throw new Error("Browser connector username is not configured."); await page.locator(profile.login.usernameSelector).fill(creds.username); }
  if (profile.login.passwordSelector) { if (!creds.password) throw new Error("Browser connector password is not configured."); await page.locator(profile.login.passwordSelector).fill(creds.password); }
  if (profile.login.submitSelector) await page.locator(profile.login.submitSelector).click();
  await page.locator(profile.login.readySelector).waitFor({ state: "visible", timeout: 45_000 });
  await authorizeNavigation(connection, page.url());
}
async function withPage<T>(connection: AdapterConnection, secret: ConnectionSecretPayload, provider: string, profile: BrowserProfile, run: (page: Page, context: BrowserContext) => Promise<T>) {
  const browser: Browser = await connect(profile);
  const context = await browser.newContext(secret.browserSession ? { storageState: secret.browserSession as never } : undefined);
  const page = await context.newPage();
  await page.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.continue();
    try {
      await authorizeNavigation(connection, request.url());
      return route.continue();
    } catch {
      return route.abort("blockedbyclient");
    }
  });
  try { await authenticate(page, connection, profile, secret, provider); return await run(page, context); }
  finally { await context.close().catch(() => undefined); await browser.close().catch(() => undefined); }
}
async function runOperation(input: { connection: AdapterConnection; secret: ConnectionSecretPayload; provider: string; operation: string; payload?: Record<string, unknown>; correlationId: string }) {
  const profile = await profileFor(input.connection, input.provider as Extract<CrmProvider, "genie" | "custom_browser">);
  if (!profile) throw new Error("This browser CRM has no calibrated connector profile. Add a reviewed browser profile before verification.");
  const script = operationScript(profile, input.operation);
  if (!script) throw new Error(`The calibrated browser connector does not define '${input.operation}'.`);
  const result = await withPage(input.connection, input.secret, input.provider, profile, page => executeSavedBrowserScript({ page, script, inputs: input.payload || {}, artifactDirectory: artifactDirectory(profile, input.connection), artifactPrefix: `${input.provider}-${input.operation}`, authorizeNavigation: url => authorizeNavigation(input.connection, url) }));
  if (!result.success) throw new Error(result.detail);
  return { result, profile };
}
function evidence(operation: string, correlationId: string, result: { completedAt: string; data: Record<string, string>; screenshotPath?: string }): AdapterEvidence { return { operation, correlationId, completedAt: result.completedAt, providerResult: { data: result.data }, screenshotPath: result.screenshotPath }; }
function rows(result: { data: Record<string, string> }, profile: BrowserProfile, operation: string) {
  const key = profile.resultKeys?.[operation] || "records"; const raw = result.data[key]; if (!raw) return [] as Array<Record<string, string>>;
  const parsed = JSON.parse(raw) as unknown; if (!Array.isArray(parsed)) throw new Error(`Browser connector '${operation}' did not return an array in result key '${key}'.`);
  return parsed.filter(isObject).map(item => Object.fromEntries(Object.entries(item).map(([field, value]) => [field, String(value ?? "")])));
}
function asDate(value?: string) { if (!value) return undefined; const result = new Date(value); return Number.isNaN(result.valueOf()) ? undefined : result; }
function asMinor(value?: string) { const number = Number(value); return value && Number.isFinite(number) ? Math.round(number * 100) : undefined; }
function contact(row: Record<string, string>): NormalizedContact { return { externalId: row.externalId || row.id, companyExternalId: row.companyExternalId || undefined, ownerExternalId: row.ownerExternalId || undefined, firstName: row.firstName || undefined, lastName: row.lastName || undefined, email: row.email || undefined, phone: row.phone || undefined, lifecycleStage: row.lifecycleStage || row.status || undefined, sourceUpdatedAt: asDate(row.sourceUpdatedAt), sourceRevision: row.sourceRevision || row.sourceUpdatedAt, raw: row }; }
function company(row: Record<string, string>): NormalizedCompany { return { externalId: row.externalId || row.id, name: row.name || "Unnamed company", website: row.website || undefined, ownerExternalId: row.ownerExternalId || undefined, sourceUpdatedAt: asDate(row.sourceUpdatedAt), sourceRevision: row.sourceRevision || row.sourceUpdatedAt, raw: row }; }
function opportunity(row: Record<string, string>): NormalizedOpportunity { return { externalId: row.externalId || row.id, companyExternalId: row.companyExternalId || undefined, contactExternalId: row.contactExternalId || undefined, ownerExternalId: row.ownerExternalId || undefined, name: row.name || "Unnamed opportunity", pipeline: row.pipeline || undefined, stage: row.stage || undefined, valueMinor: asMinor(row.value), currency: row.currency || undefined, closeAt: asDate(row.closeAt), lastActivityAt: asDate(row.lastActivityAt), nextStepAt: asDate(row.nextStepAt), sourceUpdatedAt: asDate(row.sourceUpdatedAt), sourceRevision: row.sourceRevision || row.sourceUpdatedAt, raw: row }; }
function task(row: Record<string, string>): NormalizedTask { return { externalId: row.externalId || row.id, contactExternalId: row.contactExternalId || undefined, opportunityExternalId: row.opportunityExternalId || undefined, ownerExternalId: row.ownerExternalId || undefined, title: row.title || "Task", status: row.status || "open", dueAt: asDate(row.dueAt), completedAt: asDate(row.completedAt), sourceUpdatedAt: asDate(row.sourceUpdatedAt), sourceRevision: row.sourceRevision || row.sourceUpdatedAt, raw: row }; }
function activity(row: Record<string, string>): NormalizedActivity { return { externalId: row.externalId || row.id, contactExternalId: row.contactExternalId || undefined, opportunityExternalId: row.opportunityExternalId || undefined, ownerExternalId: row.ownerExternalId || undefined, activityType: row.activityType || row.type || "activity", occurredAt: asDate(row.occurredAt) || new Date(), body: row.body || undefined, sourceRevision: row.sourceRevision || undefined, raw: row }; }
async function messageOperation(operation: "sendEmail" | "sendSms" | "sendWhatsApp", input: OutboundMessageInput, provider: string) { const execution = await runOperation({ connection: input.connection, secret: input.secret, provider, operation, correlationId: input.correlationId, payload: { to: input.to, subject: input.subject || "", body: input.body, message: input.body, templateName: input.templateName || "", contactExternalId: input.contactExternalId || "", opportunityExternalId: input.opportunityExternalId || "" } }); return evidence(operation, input.correlationId, execution.result); }

export function browserCrmAdapter(provider: Extract<CrmProvider, "genie" | "custom_browser">): CrmAdapter {
  const testConnection = async (input: { connection: AdapterConnection; secret?: ConnectionSecretPayload; correlationId: string }): Promise<ConnectionTest> => {
    try {
      const profile = await profileFor(input.connection, provider); if (!profile) throw new Error("No calibrated browser connector profile is configured.");
      const secret = await browserSecret(input.connection, input.secret);
      const healthScript = operationScript(profile, "healthCheck");
      if (healthScript) await runOperation({ connection: input.connection, secret, provider, operation: "healthCheck", correlationId: input.correlationId });
      else if (profile.login) await withPage(input.connection, secret, provider, profile, async page => { await authorizeNavigation(input.connection, page.url()); });
      else throw new Error("A browser CRM requires either an authorised login URL or a reviewed health-check script before it can be verified.");
      const requested = Array.from(new Set([...input.connection.allowedReadCapabilities, ...input.connection.allowedWriteCapabilities]));
      const capabilities = requested.filter((value): value is CrmCapability => value in CAPABILITY_OPERATIONS).map(capability => { const available = CAPABILITY_OPERATIONS[capability].some(operation => Boolean(operationScript(profile, operation))); return { capability, available, detail: available ? "Verified calibrated deterministic browser operation is configured." : "No reviewed deterministic browser operation is mapped for this capability." } satisfies CapabilityResult; });
      const available = capabilities.filter(item => item.available);
      return { status: available.length === capabilities.length && capabilities.length ? "ready" : available.length ? "limited" : "failed", summary: `${available.length} of ${capabilities.length} requested browser CRM capabilities have calibrated operations.`, capabilities, evidence: [{ operation: "browser_connector_health", correlationId: input.correlationId, completedAt: new Date().toISOString(), providerResult: { configuredOperations: Object.keys(profile.operationMap || profile.scripts) } }] };
    } catch (error) { return { status: "failed", summary: error instanceof Error ? error.message : String(error), capabilities: [], evidence: [{ operation: "browser_connector_health", correlationId: input.correlationId, completedAt: new Date().toISOString(), errorClassification: "authentication", retryable: false }] }; }
  };
  const list = async <T>(operation: string, mapper: (row: Record<string, string>) => T, input: { connection: AdapterConnection; secret: ConnectionSecretPayload }) => { const execution = await runOperation({ ...input, provider, operation, correlationId: `sync-${operation}`, payload: {} }); return { records: rows(execution.result, execution.profile, operation).map(mapper) }; };
  return {
    provider,
    disconnect: async input => ({ operation: "disconnect", correlationId: input.correlationId, completedAt: new Date().toISOString(), providerResult: { localBrowserCredentialsCanBeRemoved: true } }),
    refreshAuthentication: async input => input.secret,
    testConnection, discoverCapabilities: async input => (await testConnection(input)).capabilities,
    syncContacts: input => list("syncContacts", contact, input), syncCompanies: input => list("syncCompanies", company, input), syncOpportunities: input => list("syncOpportunities", opportunity, input), syncTasks: input => list("syncTasks", task, input), syncActivities: input => list("syncActivities", activity, input),
    searchContacts: async input => { const execution = await runOperation({ ...input, provider, operation: "searchContacts", correlationId: "search-contacts", payload: { query: input.query, leadLabel: input.query } }); const extracted = rows(execution.result, execution.profile, "searchContacts"); if (extracted.length) return extracted.map(contact); return [{ externalId: input.query, firstName: input.query, raw: { browserText: Object.values(execution.result.data).join("\n").slice(0, 20_000) } }]; },
    getContact: async input => { const execution = await runOperation({ ...input, provider, operation: "getContact", correlationId: "get-contact", payload: { externalId: input.externalId, leadLabel: input.externalId } }); const extracted = rows(execution.result, execution.profile, "getContact"); return extracted[0] ? contact(extracted[0]) : { externalId: input.externalId, raw: { browserText: Object.values(execution.result.data).join("\n").slice(0, 20_000) } }; },
    getCompany: async input => { const execution = await runOperation({ ...input, provider, operation: "getCompany", correlationId: "get-company", payload: { externalId: input.externalId } }); const extracted = rows(execution.result, execution.profile, "getCompany"); return extracted[0] ? company(extracted[0]) : null; },
    getOpportunity: async input => { const execution = await runOperation({ ...input, provider, operation: "getOpportunity", correlationId: "get-opportunity", payload: { externalId: input.externalId } }); const extracted = rows(execution.result, execution.profile, "getOpportunity"); return extracted[0] ? opportunity(extracted[0]) : null; },
    createContact: async input => { const execution = await runOperation({ ...input, provider, operation: "createContact", payload: input.fields }); return evidence("create_contact", input.correlationId, execution.result); },
    createCompany: async input => { const execution = await runOperation({ ...input, provider, operation: "createCompany", payload: input.fields }); return evidence("create_company", input.correlationId, execution.result); },
    createOpportunity: async input => { const execution = await runOperation({ ...input, provider, operation: "createOpportunity", payload: input.fields }); return evidence("create_opportunity", input.correlationId, execution.result); },
    createNote: async input => { const execution = await runOperation({ ...input, provider, operation: "createNote", payload: { externalId: input.externalId, content: input.body, body: input.body, note: input.body } }); return evidence("create_note", input.correlationId, execution.result); },
    createTask: async input => { const execution = await runOperation({ ...input, provider, operation: "createTask", payload: { title: input.title, taskTitle: input.title, dueAt: input.dueAt || "", contactExternalId: input.contactExternalId || "", opportunityExternalId: input.opportunityExternalId || "" } }); return evidence("create_task", input.correlationId, execution.result); },
    completeTask: async input => { const execution = await runOperation({ ...input, provider, operation: "completeTask", payload: { externalId: input.externalId, taskExternalId: input.externalId } }); return evidence("complete_task", input.correlationId, execution.result); },
    updateContact: async input => { const execution = await runOperation({ ...input, provider, operation: "updateContact", payload: { externalId: input.externalId, ...input.patch } }); return evidence("update_contact", input.correlationId, execution.result); },
    updateOpportunity: async input => { const execution = await runOperation({ ...input, provider, operation: "updateOpportunity", payload: { externalId: input.externalId, ...input.patch } }); return evidence("update_opportunity", input.correlationId, execution.result); },
    createActivity: async input => { const execution = await runOperation({ ...input, provider, operation: "createActivity", payload: input.activity }); return evidence("create_activity", input.correlationId, execution.result); },
    sendEmail: input => messageOperation("sendEmail", input, provider), sendSms: input => messageOperation("sendSms", input, provider), sendWhatsApp: input => messageOperation("sendWhatsApp", input, provider),
    applySequence: async input => { const execution = await runOperation({ ...input, provider, operation: "applySequence", payload: { externalId: input.externalId, sequence: input.sequence } }); return evidence("apply_sequence", input.correlationId, execution.result); },
    executeCustomAction: async input => { const execution = await runOperation({ ...input, provider, operation: input.actionName, payload: input.payload }); return evidence(input.actionName, input.correlationId, execution.result); },
    listPipelines: async input => { const execution = await runOperation({ ...input, provider, operation: "listPipelines", correlationId: "list-pipelines", payload: {} }); return rows(execution.result, execution.profile, "listPipelines").map(row => ({ externalId: row.externalId || row.id, label: row.label || row.name || "Pipeline", stages: [] })); },
    healthCheck: testConnection,
  };
}
