import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";
const URL = "https://services.leadconnectorhq.com/objects/task/records/search";
export const TASK_PAGE_LIMIT = 100;
export const TASK_MAX_PAGES = 500;
export function genieTaskSearchBody(
  locationId: string,
  ownerExternalId: string,
  page: number,
  searchAfter?: unknown
) {
  if (
    !/^[A-Za-z0-9_-]{1,180}$/.test(ownerExternalId) ||
    !/^[A-Za-z0-9_-]{1,180}$/.test(locationId)
  )
    throw Error(
      "CRM_OWNER_SCOPE_REQUIRED: exact Genie location and owner are required."
    );
  return {
    locationId,
    page,
    pageLimit: TASK_PAGE_LIMIT,
    filters: [
      {
        group: "AND",
        filters: [
          { field: "owners", operator: "eq", value: [ownerExternalId] },
        ],
      },
    ],
    includeTopRelations: true,
    sort: [{ field: "properties.dueDate", direction: "desc" }],
    includeRecurringTaskConfigs: true,
    ...(searchAfter === undefined ? {} : { searchAfter }),
  };
}
export function assertExactGenieTaskOwners(payload: unknown, owner: string) {
  const root = payload as {
    customObjectRecords?: Array<{ owners?: unknown }>;
    total?: unknown;
  };
  if (!root || !Array.isArray(root.customObjectRecords))
    throw Error(
      "GENIE_TASK_GRID_INVALID: structured Tasks collection is required."
    );
  for (const row of root.customObjectRecords) {
    if (
      !row ||
      !Array.isArray(row.owners) ||
      row.owners.length !== 1 ||
      typeof row.owners[0] !== "string"
    )
      throw Error(
        "CRM_OWNER_SCOPE_REQUIRED: every task requires one immutable owner."
      );
    if (row.owners[0] !== owner)
      throw Error(
        "CRM_OWNER_SCOPE_VIOLATION: task owner differs from the mapped salesperson."
      );
  }
  if (root.customObjectRecords.length === 0 && Number(root.total) !== 0)
    throw Error(
      "GENIE_TASK_GRID_INCOMPLETE: an empty page does not prove a zero-task source."
    );
}
export async function readOwnerScopedGenieTasks(input: {
  page: Page;
  ownerExternalId: string;
  assertControl: () => void;
  normalize: (payload: unknown) => {
    records: Array<{ externalId: string }>;
    total?: number;
  };
}): Promise<BrowserScriptResult> {
  const match = input.page
    .url()
    .match(/\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (!match)
    throw Error(
      "GENIE_TASK_GRID_INVALID: authenticated location is unavailable."
    );
  const locationId = match[1];
  const token = async () => {
    const value = await input.page.evaluate(async () => {
      const f = (window as Window & { getToken?: () => unknown }).getToken;
      return typeof f === "function" ? String(await f()) : "";
    });
    if (!value)
      throw Error(
        "CRM_BROWSER_REAUTHENTICATION_REQUIRED: authenticated Genie token is unavailable."
      );
    return value;
  };
  let currentToken = await token();
  let refreshed = false;
  let cursor: unknown;
  let previousCursor = "";
  const records = new Map<string, { externalId: string }>();
  let expectedTotal: number | undefined;
  for (let pageNumber = 1; pageNumber <= TASK_MAX_PAGES; pageNumber++) {
    input.assertControl();
    const request = () =>
      input.page.context().request.post(URL, {
        headers: {
          "content-type": "application/json",
          channel: "APP",
          source: "WEB_USER",
          version: "2021-07-28",
          "token-id": currentToken,
        },
        data: genieTaskSearchBody(
          locationId,
          input.ownerExternalId,
          pageNumber,
          cursor
        ),
        timeout: 30000,
      });
    let response = await request();
    if (response.status() === 401 && !refreshed) {
      refreshed = true;
      currentToken = await token();
      response = await request();
    }
    if (!response.ok())
      throw Error(`GENIE_TASK_GRID_HTTP_ERROR: HTTP ${response.status()}.`);
    const payload = await response.json();
    assertExactGenieTaskOwners(payload, input.ownerExternalId);
    const page = input.normalize(payload);
    if (pageNumber === 1) expectedTotal = page.total;
    if (expectedTotal === undefined || !Number.isInteger(expectedTotal))
      throw Error("GENIE_TASK_GRID_INVALID: exact total is required.");
    const before = records.size;
    for (const row of page.records) records.set(row.externalId, row);
    if (records.size === expectedTotal)
      return {
        success: true,
        completedAt: new Date().toISOString(),
        detail: "Owner-scoped Tasks read verified.",
        data: {
          records: JSON.stringify(Array.from(records.values())),
          collectionEvidence:
            records.size === 0
              ? "Owner-scoped Genie Tasks search verified zero records."
              : `Owner-scoped Genie Tasks search verified ${records.size} records.`,
          ownerExternalId: input.ownerExternalId,
          sourceTotal: String(expectedTotal),
          pagesRead: String(pageNumber),
        },
      };
    if (
      records.size > expectedTotal ||
      page.records.length < TASK_PAGE_LIMIT ||
      records.size === before
    )
      throw Error(
        "GENIE_TASK_GRID_INCOMPLETE: task pagination did not reconcile with the source total."
      );
    cursor = payload.customObjectRecords.at(-1)?.searchAfter;
    const serialized = JSON.stringify(cursor ?? null);
    if (
      !Array.isArray(cursor) ||
      !cursor.length ||
      serialized === previousCursor
    )
      throw Error(
        "CRM_SYNC_CURSOR_STALLED: Tasks search cursor did not advance."
      );
    previousCursor = serialized;
  }
  throw Error(
    "CRM_SYNC_PAGE_LIMIT_REACHED: Tasks search exceeded its bounded drain."
  );
}
