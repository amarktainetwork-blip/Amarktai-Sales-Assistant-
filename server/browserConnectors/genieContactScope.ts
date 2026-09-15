import type { Page } from "playwright-core";
import type {
  BrowserScriptResult,
  SavedBrowserScript,
} from "./scriptEngine";

const CONTACT_SEARCH_URL =
  "https://backend.leadconnectorhq.com/contacts/search/2";
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
function contactLocationId(script: SavedBrowserScript, page: Page) {
  const candidates = [
    page.url(),
    ...script.steps.flatMap(step => [
      typeof step.value === "string" ? step.value : "",
      typeof step.fallbackUrl === "string" ? step.fallbackUrl : "",
    ]).filter(Boolean),
  ];
  for (const raw of candidates) {
    const match = raw.match(/\/v2\/location\/([^/]+)/i);
    if (match?.[1]) return match[1];
  }
  throw new Error(
    "GENIE_CONTACT_SEARCH_INVALID: could not resolve the Genie location ID."
  );
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
  return {
    ...body,
    filters: [
      { field: "assigned_to", operator: "eq", value: owner },
    ],
  };
}
export function normalizeGenieContactSearchPage(
  value: unknown,
  ownerExternalId: string
) {
  const owner = ownerExternalId.trim();
  const root = object(value);
  const source = Array.isArray(root.contacts) ? root.contacts : null;
  if (!source)
    throw new Error(
      "GENIE_CONTACT_SEARCH_INVALID: Contacts search returned no structured contact collection."
    );

  const records = source.map((item, index) => {
    const raw = object(item);
    const externalId = text(raw.id || raw.contactId);
    if (!externalId)
      throw new Error(
        `INVALID_EXTERNAL_ID: Genie contact search record ${index + 1} had no immutable ID.`
      );
    const recordOwner = identity(
      raw.assignedTo || raw.assigned_to || raw.owner || raw.ownerId
    );
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

  const totalValue = Number(root.total ?? root.totalCount ?? root.count);
  return {
    records,
    total:
      Number.isFinite(totalValue) && totalValue >= 0
        ? totalValue
        : undefined,
  };
}

async function browserToken(page: Page) {
  const token = await page.evaluate(async () => {
    const getToken = (window as Window & { getToken?: () => unknown }).getToken;
    if (typeof getToken !== "function") return "";
    return String(await getToken());
  });
  if (!token)
    throw new Error(
      "CRM_BROWSER_REAUTHENTICATION_REQUIRED: Genie session token is unavailable."
    );
  return token;
}
async function fetchOwnerScopedContactPage(input: {
  page: Page;
  token: string;
  locationId: string;
  ownerExternalId: string;
  pageNumber: number;
}) {
  const response = await input.page.context().request.post(
    CONTACT_SEARCH_URL,
    {
      headers: {
        "content-type": "application/json",
        channel: "APP",
        source: "WEB_USER",
        version: "2021-07-28",
        "token-id": input.token,
      },
      data: scopeGenieContactSearchBody(
        {
          locationId: input.locationId,
          page: input.pageNumber,
          pageLimit: PAGE_LIMIT,
          sort: [],
          query: "",
        },
        input.ownerExternalId
      ),
    }
  );
  if (!response.ok())
    throw new Error(
      `GENIE_CONTACT_SEARCH_HTTP_ERROR: Contacts search returned HTTP ${response.status()}.`
    );
  return normalizeGenieContactSearchPage(
    await response.json(),
    input.ownerExternalId
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
  const navigation: SavedBrowserScript = {
    ...input.script,
    steps: input.script.steps.filter(
      step =>
        !["expect_visible", "read_rows", "paginate_rows"].includes(
          step.action
        )
    ),
  };

  const execution = await input.runScript(
    input.page,
    navigation,
    "execute-owner-scoped"
  );
  if (!execution.success) return execution;

  const token = await browserToken(input.page);
  const locationId = contactLocationId(input.script, input.page);
  const byId = new Map<string, ReturnType<
    typeof normalizeGenieContactSearchPage
  >["records"][number]>();
  let total: number | undefined;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    input.assertControl();
    const pageResult = await fetchOwnerScopedContactPage({
      page: input.page,
      token,
      locationId,
      ownerExternalId: owner,
      pageNumber,
    });
    if (total === undefined) total = pageResult.total;
    for (const record of pageResult.records)
      byId.set(record.externalId, record);

    if (!pageResult.records.length) break;
    if (pageResult.records.length < PAGE_LIMIT) break;
    if (total !== undefined && byId.size >= total) break;
  }

  if (total !== undefined && byId.size < total)
    throw new Error(
      `CRM_SYNC_PAGE_LIMIT_REACHED: owner-scoped Genie contact search still has records after the bounded API drain (${byId.size}/${total}).`
    );

  execution.data.records = JSON.stringify(Array.from(byId.values()));
  execution.data.collectionEvidence =
    total === 0 || byId.size === 0
      ? "Owner-scoped Genie contacts verified zero records."
      : `Owner-scoped Genie contacts returned ${byId.size} structured record(s).`;
  return execution;
}
