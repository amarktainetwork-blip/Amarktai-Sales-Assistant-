import type {
  AdapterConnection,
  CapabilityResult,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmAdapter,
  CrmCapability,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedCrmUser,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";
import {
  browserCrmAdapter,
  withAuthenticatedBrowserSessionPage,
} from "../browserConnectors/browserCrmAdapter";

const SERVICES = "https://services.leadconnectorhq.com";
const BACKEND = "https://backend.leadconnectorhq.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

type Json = Record<string, unknown>;
type SessionResponse = { status: number; ok: boolean; text: string };

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function date(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}
function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function locationIdFromUrl(raw: string) {
  const url = new URL(raw);
  const match = url.pathname.match(/\/location\/([^/]+)/);
  const locationId = match?.[1] || url.searchParams.get("locationId") || "";
  if (!locationId) throw new Error("GENIE_LOCATION_ID_UNAVAILABLE");
  return locationId;
}

async function sessionRequest<T>(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  version?: string;
}): Promise<T> {
  return withAuthenticatedBrowserSessionPage({
    connection: input.connection,
    secret: input.secret,
    provider: "genie",
    run: async page => {
      const response = await page.evaluate(
        async request => {
          const token =
            localStorage.getItem("refreshedToken") ||
            sessionStorage.getItem("refreshedToken") ||
            "";
          if (!token) throw new Error("GENIE_SESSION_TOKEN_UNAVAILABLE");
          const make = async (authorization: boolean) => {
            const headers: Record<string, string> = {
              Version: request.version,
              "Content-Type": "application/json",
            };
            if (authorization) headers.Authorization = `Bearer ${token}`;
            else headers["token-id"] = token;
            const result = await fetch(request.url, {
              method: request.method,
              headers,
              credentials: "include",
              body:
                request.method === "POST"
                  ? JSON.stringify(request.body ?? {})
                  : undefined,
            });
            return {
              status: result.status,
              ok: result.ok,
              text: await result.text(),
            };
          };
          const first = await make(false);
          if (![401, 403].includes(first.status)) return first;
          return make(true);
        },
        {
          url: input.url,
          method: input.method || "GET",
          body: input.body,
          version: input.version || "v3",
        }
      );
      const result = response as SessionResponse;
      if (!result.ok)
        throw new Error(
          `GENIE_SESSION_API_${result.status}: ${result.text.slice(0, 400)}`
        );
      return (result.text ? JSON.parse(result.text) : {}) as T;
    },
  });
}

async function sessionContext(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
}) {
  return withAuthenticatedBrowserSessionPage({
    ...input,
    provider: "genie",
    run: async page => {
      const pageUrl = page.url();
      const claims = await page.evaluate(() => {
        const token =
          localStorage.getItem("refreshedToken") ||
          sessionStorage.getItem("refreshedToken") ||
          "";
        if (!token) return {};
        const parts = token.split(".");
        if (parts.length < 2) return {};
        try {
          const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = normalized.padEnd(
            Math.ceil(normalized.length / 4) * 4,
            "="
          );
          const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
          const take = (keys: string[]) => {
            for (const key of keys) {
              const value = parsed[key];
              if (typeof value === "string" && value.trim()) return value.trim();
            }
            return "";
          };
          return {
            userId: take(["userId", "user_id", "sub"]),
            companyId: take(["companyId", "company_id", "agencyId"]),
            email: take(["email", "userEmail", "user_email"]),
          };
        } catch {
          return {};
        }
      });
      return { locationId: locationIdFromUrl(pageUrl), ...claims };
    },
  });
}

function contact(rawValue: unknown): NormalizedContact {
  const raw = record(rawValue);
  return {
    externalId: text(raw.id),
    companyExternalId: text(raw.businessId) || undefined,
    ownerExternalId: text(raw.assignedTo) || undefined,
    firstName: text(raw.firstName) || undefined,
    lastName: text(raw.lastName) || undefined,
    email: text(raw.email) || undefined,
    phone: text(raw.phone) || undefined,
    lifecycleStage: text(raw.type) || undefined,
    sourceUpdatedAt: date(raw.dateUpdated),
    sourceRevision: text(raw.dateUpdated) || undefined,
    raw,
  };
}
function company(rawValue: unknown): NormalizedCompany {
  const raw = record(rawValue);
  const properties = record(raw.properties);
  return {
    externalId: text(raw.id),
    name:
      text(properties.name) || text(raw.name) || text(properties.company_name) || "Unnamed company",
    website: text(properties.website) || text(raw.website) || undefined,
    ownerExternalId:
      text(raw.owner) || text(properties.owner) || text(properties.assignedTo) || undefined,
    sourceUpdatedAt: date(raw.updatedAt || raw.dateUpdated),
    sourceRevision: text(raw.updatedAt || raw.dateUpdated) || undefined,
    raw,
  };
}
function task(rawValue: unknown): NormalizedTask {
  const raw = record(rawValue);
  return {
    externalId: text(raw.id),
    contactExternalId: text(raw.contactId) || undefined,
    opportunityExternalId: text(raw.opportunityId) || undefined,
    ownerExternalId: text(raw.assignedTo) || undefined,
    title: text(raw.title) || "Task",
    status: raw.completed === true ? "completed" : "pending",
    dueAt: date(raw.dueDate),
    completedAt: raw.completed === true ? date(raw.updatedAt || raw.dateUpdated) : undefined,
    sourceUpdatedAt: date(raw.updatedAt || raw.dateUpdated),
    sourceRevision: text(raw.updatedAt || raw.dateUpdated) || undefined,
    raw,
  };
}
function opportunity(rawValue: unknown): NormalizedOpportunity {
  const raw = record(rawValue);
  return {
    externalId: text(raw.id),
    contactExternalId: text(raw.contactId) || undefined,
    ownerExternalId: text(raw.assignedTo) || undefined,
    name: text(raw.name) || "Unnamed opportunity",
    pipeline: text(raw.pipelineId || raw.pipeline) || undefined,
    stage: text(raw.pipelineStageId || raw.stage) || undefined,
    valueMinor:
      number(raw.monetaryValue) !== undefined
        ? Math.round(number(raw.monetaryValue)! * 100)
        : undefined,
    currency: text(raw.currency) || undefined,
    closeAt: date(raw.forecastExpectedCloseDate),
    lastActivityAt: date(raw.lastActivityAt),
    nextStepAt: date(raw.nextStepAt),
    sourceUpdatedAt: date(raw.updatedAt || raw.dateUpdated),
    sourceRevision: text(raw.updatedAt || raw.dateUpdated) || undefined,
    raw,
  };
}
function activity(rawValue: unknown): NormalizedActivity {
  const raw = record(rawValue);
  return {
    externalId: text(raw.id),
    contactExternalId: text(raw.contactId) || undefined,
    ownerExternalId: text(raw.assignedTo) || undefined,
    activityType: text(raw.type || raw.lastMessageType) || "conversation",
    occurredAt:
      date(raw.lastMessageDate || raw.updatedAt || raw.dateUpdated) || new Date(),
    body: text(raw.lastMessageBody || raw.body) || undefined,
    sourceRevision: text(raw.updatedAt || raw.dateUpdated) || undefined,
    raw,
  };
}

function requirePersonalScope(secret: ConnectionSecretPayload) {
  const externalId = secret.crmUserExternalId?.trim();
  if (!externalId)
    throw new Error(
      "CRM_SALESPERSON_IDENTITY_REQUIRED: confirm the signed-in salesperson identity before personal CRM data can sync."
    );
  return externalId;
}

async function discoverCurrentUser(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
}): Promise<NormalizedCrmUser[]> {
  const context = await sessionContext(input);
  if (context.userId) {
    const user = await sessionRequest<Json>({
      ...input,
      url: `${BACKEND}/users/${encodeURIComponent(context.userId)}`,
    }).catch(() => ({}));
    const candidate = record(record(user).user || user);
    const email = text(candidate.email || context.email).trim().toLowerCase();
    const displayName =
      text(candidate.name) ||
      [text(candidate.firstName), text(candidate.lastName)].filter(Boolean).join(" ");
    if (text(candidate.id || context.userId) && displayName && email)
      return [
        {
          externalId: text(candidate.id || context.userId),
          displayName,
          email,
          raw: candidate,
        },
      ];
  }
  if (context.companyId && context.email) {
    const url = new URL(`${BACKEND}/users/search`);
    url.searchParams.set("companyId", context.companyId);
    url.searchParams.set("locationId", context.locationId);
    url.searchParams.set("query", context.email);
    url.searchParams.set("limit", "25");
    const response = await sessionRequest<Json>({ ...input, url: url.toString() });
    const users = array(response.users)
      .map(record)
      .filter(user => text(user.email).trim().toLowerCase() === context.email!.trim().toLowerCase());
    if (users.length !== 1) return [];
    const user = users[0];
    return [
      {
        externalId: text(user.id),
        displayName:
          text(user.name) ||
          [text(user.firstName), text(user.lastName)].filter(Boolean).join(" "),
        email: text(user.email).trim().toLowerCase(),
        raw: user,
      },
    ].filter(user => user.externalId && user.displayName && user.email);
  }
  return [];
}

async function syncContacts(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  cursor?: string;
}) {
  const ownerId = requirePersonalScope(input.secret);
  const context = await sessionContext(input);
  const page = Math.max(1, Number(input.cursor || 1) || 1);
  const response = await sessionRequest<Json>({
    ...input,
    url: `${SERVICES}/contacts/search`,
    method: "POST",
    version: "2021-07-28",
    body: {
      locationId: context.locationId,
      page,
      pageLimit: PAGE_SIZE,
      filters: [{ field: "assignedTo", operator: "eq", value: ownerId }],
      sort: [{ field: "dateUpdated", direction: "desc" }],
      includeTotal: true,
    },
  });
  const records = array(response.contacts).map(contact).filter(item => item.externalId);
  if (records.some(item => item.ownerExternalId && item.ownerExternalId !== ownerId))
    throw new Error("CRM_OWNER_SCOPE_VIOLATION: contact search returned another salesperson's record.");
  const total = number(response.total ?? response.count) ?? records.length;
  const next = page * PAGE_SIZE < total ? String(page + 1) : undefined;
  return { records, cursor: next };
}

async function syncTasks(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  cursor?: string;
}) {
  const ownerId = requirePersonalScope(input.secret);
  const context = await sessionContext(input);
  const skip = Math.max(0, Number(input.cursor || 0) || 0);
  const response = await sessionRequest<Json>({
    ...input,
    url: `${SERVICES}/locations/${encodeURIComponent(context.locationId)}/tasks/search`,
    method: "POST",
    body: {
      completed: false,
      assignedTo: [ownerId],
      limit: PAGE_SIZE,
      skip,
    },
  });
  const records = array(response.tasks).map(task).filter(item => item.externalId);
  if (records.some(item => item.ownerExternalId !== ownerId || item.status !== "pending"))
    throw new Error("CRM_OWNER_SCOPE_VIOLATION: task search returned an unscoped or completed task.");
  return {
    records,
    cursor: records.length === PAGE_SIZE ? String(skip + PAGE_SIZE) : undefined,
  };
}

async function syncCompanies(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  cursor?: string;
}) {
  const context = await sessionContext(input);
  const page = Math.max(1, Number(input.cursor || 1) || 1);
  const response = await sessionRequest<Json>({
    ...input,
    url: `${SERVICES}/objects/business/records/search`,
    method: "POST",
    body: {
      locationId: context.locationId,
      page,
      pageLimit: PAGE_SIZE,
      query: "",
      searchAfter: [],
    },
  });
  const records = array(response.records).map(company).filter(item => item.externalId);
  const total = number(response.total) ?? records.length;
  return {
    records,
    cursor: page * PAGE_SIZE < total ? String(page + 1) : undefined,
  };
}

async function syncOpportunities(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  cursor?: string;
}) {
  const ownerId = requirePersonalScope(input.secret);
  const context = await sessionContext(input);
  const page = Math.max(1, Number(input.cursor || 1) || 1);
  const url = new URL(`${SERVICES}/opportunities/search`);
  url.searchParams.set("locationId", context.locationId);
  url.searchParams.set("assignedTo", ownerId);
  url.searchParams.set("status", "open");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  const response = await sessionRequest<Json>({ ...input, url: url.toString() });
  const records = array(response.opportunities).map(opportunity).filter(item => item.externalId);
  if (records.some(item => item.ownerExternalId && item.ownerExternalId !== ownerId))
    throw new Error("CRM_OWNER_SCOPE_VIOLATION: opportunity search returned another salesperson's record.");
  const meta = record(response.meta);
  const total = number(meta.total ?? response.total) ?? records.length;
  return { records, cursor: page * PAGE_SIZE < total ? String(page + 1) : undefined };
}

async function syncActivities(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  cursor?: string;
}) {
  const ownerId = requirePersonalScope(input.secret);
  const context = await sessionContext(input);
  const url = new URL(`${SERVICES}/conversations/search`);
  url.searchParams.set("locationId", context.locationId);
  url.searchParams.set("assignedTo", ownerId);
  url.searchParams.set("sort", "desc");
  if (input.cursor) url.searchParams.set("startAfterDate", input.cursor);
  const response = await sessionRequest<Json>({ ...input, url: url.toString() });
  const records = array(response.conversations).map(activity).filter(item => item.externalId);
  if (records.some(item => item.ownerExternalId && item.ownerExternalId !== ownerId))
    throw new Error("CRM_OWNER_SCOPE_VIOLATION: conversation search returned another salesperson's record.");
  const next = text(response.nextPage || response.nextCursor || record(response.meta).nextCursor) || undefined;
  return { records, cursor: next };
}

async function listPipelines(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
}) {
  const context = await sessionContext(input);
  const url = new URL(`${SERVICES}/opportunities/pipelines`);
  url.searchParams.set("locationId", context.locationId);
  const response = await sessionRequest<Json>({ ...input, url: url.toString() });
  return array(response.pipelines).map(record).map(pipeline => ({
    externalId: text(pipeline.id),
    label: text(pipeline.name || pipeline.label) || "Pipeline",
    stages: array(pipeline.stages).map(record).map(stage => ({
      externalId: text(stage.id),
      label: text(stage.name || stage.label) || "Stage",
    })).filter(stage => stage.externalId),
  })).filter(pipeline => pipeline.externalId);
}

async function sessionCapabilityChecks(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
}) {
  const requested = Array.from(
    new Set([
      ...input.connection.allowedReadCapabilities,
      ...input.connection.allowedWriteCapabilities,
    ])
  ).filter((value): value is CrmCapability => typeof value === "string");
  const results: CapabilityResult[] = [];
  for (const capability of requested) {
    try {
      if (capability === "companies.read") await syncCompanies(input);
      else if (capability === "pipelines.read") await listPipelines(input);
      else if (capability === "owners.read") {
        const users = await discoverCurrentUser(input);
        if (users.length !== 1) throw new Error("GENIE_CURRENT_USER_NOT_RESOLVED");
      }
      else if (capability === "contacts.read") {
        requirePersonalScope(input.secret);
        await syncContacts(input);
      } else if (capability === "tasks.read") {
        requirePersonalScope(input.secret);
        await syncTasks(input);
      } else if (capability === "opportunities.read") {
        requirePersonalScope(input.secret);
        await syncOpportunities(input);
      } else if (capability === "activities.read") {
        requirePersonalScope(input.secret);
        await syncActivities(input);
      } else {
        results.push({
          capability,
          available: false,
          detail: "This capability remains on the governed browser-action fallback.",
        });
        continue;
      }
      results.push({ capability, available: true, detail: "Authenticated Genie session API verified." });
    } catch (error) {
      results.push({
        capability,
        available: false,
        detail: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220),
      });
    }
  }
  return results;
}

const browserBase = browserCrmAdapter("genie");

export const genieSessionApiAdapter: CrmAdapter = {
  ...browserBase,
  provider: "genie",
  testConnection: async ({ connection, secret, correlationId }): Promise<ConnectionTest> => {
    try {
      if (!secret) throw new Error("Your CRM needs you to sign in again.");
      const capabilities = await sessionCapabilityChecks({ connection, secret });
      const available = capabilities.filter(item => item.available);
      const status: ConnectionTest["status"] =
        capabilities.length > 0 && available.length === capabilities.length
          ? "ready"
          : available.length
            ? "limited"
            : "failed";
      return {
        status,
        summary:
          status === "ready"
            ? `${available.length} requested Genie session-API capabilities verified.`
            : `${available.length} of ${capabilities.length} requested Genie session-API capabilities verified.`,
        capabilities,
        evidence: [
          {
            operation: "genie_session_api_health",
            correlationId,
            completedAt: new Date().toISOString(),
            providerResult: {
              transport: "authenticated_session_api",
              verifiedCapabilities: available.map(item => item.capability),
              browserUsedForAuthenticationOnly: true,
            },
          },
        ],
      };
    } catch (error) {
      return {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        capabilities: [],
        evidence: [
          {
            operation: "genie_session_api_health",
            correlationId,
            completedAt: new Date().toISOString(),
            errorClassification: "authentication",
            retryable: false,
          },
        ],
      };
    }
  },
  discoverCapabilities: async ({ connection, secret, correlationId }) =>
    (await genieSessionApiAdapter.testConnection({ connection, secret, correlationId })).capabilities,
  discoverUsers: discoverCurrentUser,
  syncContacts,
  syncCompanies,
  syncOpportunities,
  syncTasks,
  syncActivities,
  searchContacts: async input => {
    const ownerId = requirePersonalScope(input.secret);
    const context = await sessionContext(input);
    const response = await sessionRequest<Json>({
      ...input,
      url: `${SERVICES}/contacts/search`,
      method: "POST",
      version: "2021-07-28",
      body: {
        locationId: context.locationId,
        page: 1,
        pageLimit: 20,
        query: input.query,
        filters: [{ field: "assignedTo", operator: "eq", value: ownerId }],
        includeTotal: false,
      },
    });
    return array(response.contacts).map(contact).filter(item => item.externalId && (!item.ownerExternalId || item.ownerExternalId === ownerId));
  },
  getContact: async input => {
    const ownerId = requirePersonalScope(input.secret);
    const response = await sessionRequest<Json>({
      ...input,
      url: `${SERVICES}/contacts/${encodeURIComponent(input.externalId)}`,
    });
    const found = contact(record(response.contact || response));
    if (!found.externalId || (found.ownerExternalId && found.ownerExternalId !== ownerId)) return null;
    return found;
  },
  getCompany: async input => {
    const response = await sessionRequest<Json>({
      ...input,
      url: `${SERVICES}/businesses/${encodeURIComponent(input.externalId)}`,
    });
    const found = company(record(response.business || response));
    return found.externalId ? found : null;
  },
  getOpportunity: async input => {
    const ownerId = requirePersonalScope(input.secret);
    const url = new URL(`${SERVICES}/opportunities/search`);
    const context = await sessionContext(input);
    url.searchParams.set("locationId", context.locationId);
    url.searchParams.set("id", input.externalId);
    url.searchParams.set("assignedTo", ownerId);
    url.searchParams.set("limit", "1");
    const response = await sessionRequest<Json>({ ...input, url: url.toString() });
    const found = array(response.opportunities).map(opportunity)[0];
    return found && (!found.ownerExternalId || found.ownerExternalId === ownerId) ? found : null;
  },
  listPipelines,
  healthCheck: async input => genieSessionApiAdapter.testConnection(input),
};
