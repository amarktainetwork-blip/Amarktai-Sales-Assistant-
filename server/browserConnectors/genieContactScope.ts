import type { Page, Route } from "playwright-core";
import type {
  BrowserScriptResult,
  SavedBrowserScript,
} from "./scriptEngine";

const CONTACT_HOST = "services.leadconnectorhq.com";
const CONTACT_PATH = "/contacts/search";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function identity(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = identity(item);
      if (found) return found;
    }
  }
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  for (const key of ["id", "userId", "ownerId", "assignedTo"]) {
    const found = identity(row[key]);
    if (found) return found;
  }
  return "";
}

export function isGenieContactSearchUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === CONTACT_HOST &&
      url.pathname === CONTACT_PATH
    );
  } catch {
    return false;
  }
}

export function scopeGenieContactSearchBody(
  value: unknown,
  ownerExternalId: string
) {
  const owner = ownerExternalId.trim();
  if (!owner)
    throw new Error(
      "CRM_OWNER_SCOPE_REQUIRED: Genie contact search requires the mapped salesperson owner ID."
    );
  const body = object(value);
  const filters = list(body.filters).filter(item => {
    const filter = object(item);
    return text(filter.field).toLowerCase() !== "assignedto";
  });
  return {
    ...body,
    filters: [
      ...filters,
      { field: "assignedTo", operator: "eq", value: owner },
    ],
  };
}

export function normalizeGenieContactSearchPage(
  value: unknown,
  ownerExternalId: string
) {
  const owner = ownerExternalId.trim();
  const root = object(value);
  const data = object(root.data);
  const source = Array.isArray(root.contacts)
    ? root.contacts
    : Array.isArray(data.contacts)
      ? data.contacts
      : Array.isArray(root.records)
        ? root.records
        : null;
  if (!source)
    throw new Error(
      "GENIE_CONTACT_SEARCH_INVALID: Contacts search returned no structured record collection."
    );
  const records = source.map((item, index) => {
    const raw = object(item);
    const externalId = text(raw.id || raw.contactId);
    if (!externalId)
      throw new Error(
        `INVALID_EXTERNAL_ID: Genie contact search record ${index + 1} had no immutable ID.`
      );
    const recordOwner = identity(raw.assignedTo || raw.owner || raw.ownerId);
    if (!recordOwner)
      throw new Error(
        "CRM_OWNER_SCOPE_REQUIRED: Genie contact search returned a contact without immutable owner identity."
      );
    if (recordOwner !== owner)
      throw new Error(
        "CRM_OWNER_SCOPE_VIOLATION: Genie contact search returned another salesperson's contact."
      );
    return {
      externalId,
      companyExternalId: text(raw.businessId),
      ownerExternalId: recordOwner,
      firstName: text(raw.firstName),
      lastName: text(raw.lastName),
      email: text(raw.email).toLowerCase(),
      phone: text(raw.phone),
      lifecycleStage: text(raw.type),
      sourceUpdatedAt: text(raw.dateUpdated || raw.updatedAt),
      sourceRevision: text(raw.dateUpdated || raw.updatedAt),
    };
  });
  const totalValue = Number(root.total ?? root.count ?? data.total);
  return {
    records,
    total:
      Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : undefined,
  };
}

async function waitForContactPage(page: Page, ownerExternalId: string) {
  const response = await page.waitForResponse(
    candidate =>
      candidate.request().method() === "POST" &&
      isGenieContactSearchUrl(candidate.url()),
    { timeout: 30_000 }
  );
  if (!response.ok())
    throw new Error(
      `GENIE_CONTACT_SEARCH_HTTP_ERROR: Contacts search returned HTTP ${response.status()}.`
    );
  return normalizeGenieContactSearchPage(
    await response.json(),
    ownerExternalId
  );
}

export async function executeOwnerScopedGenieContactRead(input: {
  page: Page;
  script: SavedBrowserScript;
  ownerExternalId: string;
  runScript: (
    page: Page,
    selected: SavedBrowserScript,
    suffix: string
  ) => Promise<BrowserScriptResult>;
  assertControl: () => void;
}) {
  const owner = input.ownerExternalId.trim();
  const routeHandler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    let body: unknown = {};
    const raw = request.postData();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(
          "GENIE_CONTACT_SEARCH_INVALID: Contacts search request body was not JSON."
        );
      }
    }
    const scoped = scopeGenieContactSearchBody(body, owner);
    await route.continue({
      postData: JSON.stringify(scoped),
      headers: {
        ...request.headers(),
        "content-type": "application/json",
      },
    });
  };

  await input.page.route(
    "https://services.leadconnectorhq.com/contacts/search*",
    routeHandler
  );
  try {
    const navigation: SavedBrowserScript = {
      ...input.script,
      steps: input.script.steps.filter(
        step => !["read_rows", "paginate_rows"].includes(step.action)
      ),
    };
    const firstPagePromise = waitForContactPage(input.page, owner);
    const [execution, firstPage] = await Promise.all([
      input.runScript(input.page, navigation, "execute-owner-scoped"),
      firstPagePromise,
    ]);
    if (!execution.success) return execution;

    const byId = new Map(
      firstPage.records.map(record => [record.externalId, record] as const)
    );
    const total = firstPage.total;
    for (let pageNumber = 1; pageNumber < 100; pageNumber += 1) {
      if (total !== undefined && byId.size >= total) break;
      input.assertControl();
      const next = input.page
        .getByRole("button", { name: /^Next$/i })
        .last();
      if (!(await next.count()) || !(await next.isVisible())) break;
      const disabled =
        (await next.isDisabled().catch(() => false)) ||
        (await next.getAttribute("aria-disabled")) === "true";
      if (disabled) break;
      const pagePromise = waitForContactPage(input.page, owner);
      const [, nextPage] = await Promise.all([next.click(), pagePromise]);
      if (!nextPage.records.length) break;
      for (const record of nextPage.records)
        byId.set(record.externalId, record);
    }

    if (total !== undefined && byId.size < total)
      throw new Error(
        `CRM_SYNC_PAGE_LIMIT_REACHED: owner-scoped Genie contact search still has records after the bounded browser drain (${byId.size}/${total}).`
      );
    execution.data.records = JSON.stringify(Array.from(byId.values()));
    execution.data.collectionEvidence =
      total === 0
        ? "Owner-scoped Genie contacts verified zero records."
        : `Owner-scoped Genie contacts returned ${byId.size} structured record(s).`;
    return execution;
  } finally {
    await input.page
      .unroute(
        "https://services.leadconnectorhq.com/contacts/search*",
        routeHandler
      )
      .catch(() => undefined);
  }
}
