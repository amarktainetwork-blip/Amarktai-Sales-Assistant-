import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";

const GENIE_ORIGIN = "https://genie.entrepreneurscircle.org";
const SCOPE = /^\/v2\/location\/([A-Za-z0-9_-]{1,180})(?:\/|$)/;

export function exactGenieSidebarReadTarget(
  currentPageUrl: string,
  href: string,
  route: "dashboard" | "tasks"
) {
  const current = new URL(currentPageUrl);
  const match = current.pathname.match(SCOPE);
  if (current.origin !== GENIE_ORIGIN || !match)
    throw Error("GENIE_SIDEBAR_LOCATION_REQUIRED");
  if (!href) throw Error("GENIE_SIDEBAR_SOURCE_LINK_REQUIRED");
  const destination = new URL(href, current);
  if (
    destination.origin !== GENIE_ORIGIN ||
    destination.pathname !== `/v2/location/${match[1]}/${route}` ||
    destination.search ||
    destination.hash
  )
    throw Error("GENIE_SIDEBAR_TARGET_SCOPE_MISMATCH");
  return { locationId: match[1], destination };
}

/** Only the observed scoped Genie sidebar href can initiate this UI read.
 * No form submission, customer mutation, or external CRM send is performed.
 */
export async function openExactGenieSidebarRead(input: {
  page: Page;
  selector: "#sb_dashboard" | "#tb_tasks";
  route: "dashboard" | "tasks";
  assertControl: () => void;
}) {
  input.assertControl();
  const link = input.page.locator(input.selector).first();
  const href = (await link.getAttribute("href")) || "";
  const target = exactGenieSidebarReadTarget(input.page.url(), href, input.route);
  input.assertControl();
  await link.click({ timeout: 15_000 });
  await input.page.waitForURL(
    url => url.origin === GENIE_ORIGIN && url.pathname === target.destination.pathname,
    { timeout: 20_000, waitUntil: "domcontentloaded" }
  );
  input.assertControl();
  if (new URL(input.page.url()).pathname !== target.destination.pathname)
    throw Error("GENIE_SIDEBAR_NAVIGATION_UNVERIFIED");
  return { locationId: target.locationId, pathname: target.destination.pathname };
}

export async function readGenieHome(input: {
  page: Page;
  ownerExternalId: string;
  assertControl: () => void;
}): Promise<BrowserScriptResult> {
  if (!input.ownerExternalId) throw Error("CRM_OWNER_SCOPE_REQUIRED");
  const source = await openExactGenieSidebarRead({
    page: input.page,
    selector: "#sb_dashboard",
    route: "dashboard",
    assertControl: input.assertControl,
  });
  return {
    success: true,
    completedAt: new Date().toISOString(),
    detail: "Observed Genie Home sidebar link opened the exact authenticated location dashboard.",
    data: {
      actualPageUrl: source.pathname,
      ownerExternalId: input.ownerExternalId,
      records: JSON.stringify([{
        externalId: source.locationId,
        ownerExternalId: input.ownerExternalId,
        route: source.pathname,
        sourceKind: "genie_location_scoped_home_navigation",
      }]),
      collectionEvidence: "Observed scoped sidebar href and actual location dashboard URL both verified.",
    },
  };
}
