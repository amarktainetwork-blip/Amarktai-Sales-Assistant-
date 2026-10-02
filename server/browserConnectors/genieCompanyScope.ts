import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";

export const GENIE_BUSINESS_SOURCE = "https://backend.leadconnectorhq.com";
export const GENIE_BUSINESS_PATH = "/businesses/search";
export const GENIE_COMPANY_SYNC_IDENTITY = "genie_exact_location_scoped_businesses_search";
export const GENIE_COMPANY_READ_IDENTITY = "genie_exact_location_scoped_business_identity";
const CRM_ORIGIN = "https://genie.entrepreneurscircle.org";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,180}$/;

export type ScopedGenieCompany = {
  externalId: string;
  locationId: string;
  name: string;
  website?: string;
  sourceUpdatedAt?: string;
  sourceRevision?: string;
  sourceKind: "genie_location_scoped_businesses_api";
};

/** Real Genie Businesses API structure only. Never infer a company from a contact tag. */
export function normalizeGenieBusinessSearch(
  value: unknown,
  expectedLocationId: string
): { records: ScopedGenieCompany[]; sourceTotal: number } {
  if (!IDENTIFIER.test(expectedLocationId))
    throw Error("GENIE_COMPANY_LOCATION_SCOPE_REQUIRED");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("GENIE_BUSINESSES_SOURCE_SCHEMA_INVALID");
  const root = value as { count?: unknown; businesses?: unknown };
  if (!Array.isArray(root.businesses) ||
      typeof root.count !== "number" ||
      !Number.isSafeInteger(root.count) ||
      root.count < 0 ||
      root.businesses.length > root.count)
    throw Error("GENIE_BUSINESSES_SOURCE_COUNT_INVALID");
  const ids = new Set<string>();
  const records = root.businesses.map((value, i) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("GENIE_BUSINESSES_SOURCE_RECORD_INVALID");
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!IDENTIFIER.test(id) || !name)
      throw Error("GENIE_COMPANY_IMMUTABLE_ID_AND_NAME_REQUIRED");
    if (row.locationId !== expectedLocationId)
      throw Error("CRM_COMPANY_LOCATION_SCOPE_VIOLATION");
    if (ids.has(id))
      throw Error("GENIE_BUSINESSES_DUPLICATE_SOURCE_ID");
    ids.add(id);
    const sourceUpdatedAt =
      typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt))
        ? new Date(row.updatedAt).toISOString()
        : undefined;
    return {
      externalId: id,
      locationId: expectedLocationId,
      name,
      ...(typeof row.website === "string" && row.website.trim()
        ? { website: row.website.trim() }
        : {}),
      ...(sourceUpdatedAt
        ? { sourceUpdatedAt, sourceRevision: sourceUpdatedAt }
        : {}),
      sourceKind: "genie_location_scoped_businesses_api" as const,
    };
  });
  return { records, sourceTotal: root.count };
}

function companyLocation(pageUrl: string) {
  const url = new URL(pageUrl);
  const locationId =
    url.pathname.match(/^\/v2\/location\/([A-Za-z0-9_-]{1,180})(?:\/|$)/)?.[1];
  if (url.origin !== CRM_ORIGIN || !locationId)
    throw Error("GENIE_COMPANY_AUTHORISED_LOCATION_REQUIRED");
  return { url, locationId };
}

function scopedObservedNavigation(
  current: URL,
  href: string | null,
  locationId: string,
  route: "contacts" | "businesses"
) {
  const expectedPrefix =
    route === "contacts"
      ? `/v2/location/${locationId}/contacts/smart_list/`
      : `/v2/location/${locationId}/businesses/list`;
  // The observed Businesses tab can be a SPA button without an href. It is
  // clicked by its exact reviewed selector, never navigated via a guessed URL;
  // this target is used solely to reject an unexpected resulting location.
  if (!href) {
    if (route === "businesses")
      return new URL(expectedPrefix, current.origin);
    throw Error("GENIE_COMPANY_SOURCE_LINK_REQUIRED");
  }
  const target = new URL(href, current);
  const originVerified = target.origin === CRM_ORIGIN;
  const locationVerified = target.pathname.startsWith(
    `/v2/location/${locationId}/`
  );
  const routeVerified = route === "contacts"
    ? target.pathname.startsWith(expectedPrefix)
    : target.pathname === expectedPrefix;
  const queryVerified = !target.search && !target.hash;
  if (!originVerified || !locationVerified || !routeVerified || !queryVerified)
    throw Error(
      `GENIE_COMPANY_NAVIGATION_SCOPE_MISMATCH_${route.toUpperCase()}_${Number(originVerified)}${Number(locationVerified)}${Number(routeVerified)}${Number(queryVerified)}`
    );
  return target;
}

function businessResponseForLocation(response: {
  url(): string;
  request(): { method(): string };
}, locationId: string) {
  const url = new URL(response.url());
  return (
    url.origin === GENIE_BUSINESS_SOURCE &&
    url.pathname === GENIE_BUSINESS_PATH &&
    url.searchParams.get("locationId") === locationId &&
    Number(url.searchParams.get("skip") || "0") === 0 &&
    response.request().method() === "GET"
  );
}

/** Every invocation independently reads the authenticated, location-filtered
 * Genie Businesses GET source; historical company.sync status proves nothing
 * about company.read. Only UI navigation and GET requests are performed.
 */
export async function readGenieCompanySource(input: {
  page: Page;
  assertControl: () => void;
  verifiedViewerOwnerExternalId: string;
  exactExternalId?: string;
}): Promise<BrowserScriptResult> {
  if (!input.verifiedViewerOwnerExternalId ||
      !IDENTIFIER.test(input.verifiedViewerOwnerExternalId))
    throw Error("CRM_VERIFIED_VIEWER_REQUIRED");
  const initial = companyLocation(input.page.url());
  if (input.exactExternalId !== undefined &&
      !IDENTIFIER.test(input.exactExternalId))
    throw Error("GENIE_EXACT_COMPANY_ID_REQUIRED");
  input.assertControl();
  const businessPath = `/v2/location/${initial.locationId}/businesses/list`;
  const contactsPrefix =
    `/v2/location/${initial.locationId}/contacts/smart_list/`;
  let response: Awaited<ReturnType<Page["waitForResponse"]>>;
  if (initial.url.pathname === businessPath) {
    // The authenticated SPA is already on the observed source screen.
    // Reload its exact current GET route rather than switching through a
    // different workspace or guessing a navigational target.
    const firstResponse = input.page.waitForResponse(
      r => businessResponseForLocation(r, initial.locationId),
      { timeout: 25_000 }
    );
    await input.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await input.page.waitForURL(
      u => u.origin === CRM_ORIGIN && u.pathname === businessPath,
      { timeout: 20_000 }
    );
    response = await firstResponse;
  } else {
    if (!initial.url.pathname.startsWith(contactsPrefix)) {
      const contacts = input.page.locator("#sb_contacts").first();
      const contactsTarget = scopedObservedNavigation(
        initial.url,
        await contacts.getAttribute("href"),
        initial.locationId,
        "contacts"
      );
      await contacts.click({ timeout: 15_000 });
      await input.page.waitForURL(
        u => u.origin === CRM_ORIGIN && u.pathname === contactsTarget.pathname,
        { timeout: 20_000, waitUntil: "domcontentloaded" }
      );
    }
    input.assertControl();
    const businesses = input.page.locator("#tb_business").first();
    const businessesTarget = scopedObservedNavigation(
      new URL(input.page.url()),
      await businesses.getAttribute("href"),
      initial.locationId,
      "businesses"
    );
    const firstResponse = input.page.waitForResponse(
      r => businessResponseForLocation(r, initial.locationId),
      { timeout: 25_000 }
    );
    await businesses.click({ timeout: 15_000 });
    await input.page.waitForURL(
      u => u.origin === CRM_ORIGIN && u.pathname === businessesTarget.pathname,
      { timeout: 20_000, waitUntil: "domcontentloaded" }
    );
    response = await firstResponse;
  }
  input.assertControl();
  if ([401, 403].includes(response.status()))
    throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
  if (!response.ok())
    throw Error(`GENIE_BUSINESSES_SOURCE_HTTP_${response.status()}`);
  const firstUrl = new URL(response.url());
  const first = normalizeGenieBusinessSearch(
    await response.json(), initial.locationId
  );
  if (Number(firstUrl.searchParams.get("skip") || "0") !== 0)
    throw Error("GENIE_BUSINESSES_FIRST_PAGE_REQUIRED");
  const all = [...first.records];
  const seen = new Set(all.map(row => row.externalId));
  const total = first.sourceTotal;
  const pageSize = Math.max(
    1,
    Math.min(100, Number(firstUrl.searchParams.get("limit")) || 20)
  );
  const headers = await response.request().allHeaders();
  const replayHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) =>
      /^(?:accept|authorization|token-id|channel|source|version|x-location-id)$/i.test(key)
    )
  );
  let pages = 1;
  while (all.length < total && pages < 100) {
    input.assertControl();
    const nextUrl = new URL(firstUrl);
    nextUrl.searchParams.set("skip", String(all.length));
    nextUrl.searchParams.set("limit", String(pageSize));
    nextUrl.searchParams.set("locationId", initial.locationId);
    nextUrl.searchParams.set("count", "true");
    const next = await input.page.context().request.get(nextUrl.toString(), {
      headers: replayHeaders,
      maxRedirects: 0,
      timeout: 15_000,
    });
    if ([401, 403].includes(next.status()))
      throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    if (!next.ok())
      throw Error(`GENIE_BUSINESSES_SOURCE_HTTP_${next.status()}`);
    const part = normalizeGenieBusinessSearch(
      await next.json(), initial.locationId
    );
    if (part.sourceTotal !== total || !part.records.length)
      throw Error("GENIE_BUSINESSES_SNAPSHOT_INCOMPLETE");
    for (const row of part.records) {
      if (seen.has(row.externalId))
        throw Error("GENIE_BUSINESSES_PAGINATION_DUPLICATE");
      seen.add(row.externalId);
      all.push(row);
    }
    pages++;
  }
  if (all.length !== total)
    throw Error("GENIE_BUSINESSES_SNAPSHOT_INCOMPLETE");
  let selected = all;
  if (input.exactExternalId !== undefined) {
    selected = all.filter(x => x.externalId === input.exactExternalId);
    if (selected.length !== 1)
      throw Error("GENIE_EXACT_COMPANY_SOURCE_MATCH_REQUIRED");
  }
  return {
    success: true,
    completedAt: new Date().toISOString(),
    detail: input.exactExternalId === undefined
      ? "Complete location-scoped Genie Businesses source verified."
      : "Exact immutable Genie company identity verified against its live source.",
    data: {
      records: JSON.stringify(selected),
      sourceTotal: String(total),
      pagesRead: String(pages),
      locationScopeVerified: "true",
      sourceKind: "genie_location_scoped_businesses_api",
      viewerOwnerVerified: "true",
      ...(input.exactExternalId !== undefined
        ? { actualExternalId: input.exactExternalId }
        : {}),
      collectionEvidence:
        `Verified Businesses API GET source returned ${total} exact location-scoped businesses across ${pages} complete page(s).`,
    },
  };
}
