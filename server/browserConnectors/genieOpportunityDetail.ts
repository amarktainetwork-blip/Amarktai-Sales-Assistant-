import type { Page } from "playwright-core";
import type { NormalizedOpportunity } from "../crm/types";
import { normalizeGenieOpportunities } from "./genieOpportunityScope";

const ORIGIN = "https://genie.entrepreneurscircle.org";
const SERVICES = "https://services.leadconnectorhq.com";
const SOURCE_ID = /^[A-Za-z0-9_-]{1,180}$/;

export function exactGenieOpportunityScope(
  currentPageUrl: string,
  externalId: string,
  ownerExternalId: string
) {
  const page = new URL(currentPageUrl);
  const locationId = page.pathname.match(
    /^\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/
  )?.[1];
  if (
    page.origin !== ORIGIN ||
    !locationId ||
    !SOURCE_ID.test(externalId) ||
    !SOURCE_ID.test(ownerExternalId)
  )
    throw Error("GENIE_EXACT_OPPORTUNITY_SCOPE_REQUIRED");
  return { locationId, externalId, ownerExternalId };
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : undefined;
}

/** Reject any wrong contact/owner/location before normalizing even one field. */
export function exactGenieOpportunityRecord(
  source: unknown,
  expected: { locationId: string; externalId: string; ownerExternalId: string },
  pipelines: unknown
): NormalizedOpportunity {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error("GENIE_EXACT_OPPORTUNITY_SCHEMA_REQUIRED");
  const row = source as Record<string, unknown>;
  if (
    row.id !== expected.externalId ||
    row.assignedTo !== expected.ownerExternalId ||
    row.locationId !== expected.locationId
  )
    throw Error("CRM_OWNER_SCOPE_VIOLATION");
  if (
    !Array.isArray(pipelines) ||
    pipelines.some(
      item =>
        !item ||
        typeof item !== "object" ||
        (item as Record<string, unknown>).locationId !== expected.locationId
    )
  )
    throw Error("GENIE_PIPELINE_LOCATION_INVALID");
  const [normalized] = normalizeGenieOpportunities(
    { opportunities: [row] },
    expected.ownerExternalId,
    expected.locationId,
    pipelines
  );
  if (normalized.externalId !== expected.externalId)
    throw Error("GENIE_EXACT_OPPORTUNITY_TARGET_MISMATCH");
  const amount = Number(normalized.value);
  return {
    externalId: normalized.externalId,
    ownerExternalId: expected.ownerExternalId,
    contactExternalId: normalized.contactExternalId || undefined,
    companyExternalId:
      typeof row.companyId === "string" ? row.companyId : undefined,
    name: normalized.name || "Unnamed opportunity",
    pipeline: normalized.pipeline || undefined,
    stage: normalized.stage || undefined,
    valueMinor:
      normalized.value !== "" && Number.isFinite(amount)
        ? Math.round(amount * 100)
        : undefined,
    currency: typeof row.currency === "string" ? row.currency : undefined,
    closeAt: asDate(normalized.closeAt),
    sourceUpdatedAt: asDate(normalized.sourceUpdatedAt),
    sourceRevision: normalized.sourceRevision || undefined,
    raw: { ...normalized, sourceKind: "genie_exact_owner_scoped_get" },
  };
}

/** GET-only exact opportunity read. No SPA navigation, form actions or Genie writes. */
export async function readOwnerScopedGenieOpportunityDetail(input: {
  page: Page;
  externalId: string;
  ownerExternalId: string;
  assertControl: () => void;
}): Promise<NormalizedOpportunity | null> {
  const expected = exactGenieOpportunityScope(
    input.page.url(),
    input.externalId,
    input.ownerExternalId
  );
  const tokenOnPage = () =>
    input.page.evaluate(async () => {
      const getter = (window as any).getToken;
      let live = "";
      try {
        const raw = typeof getter === "function" ? await getter() : "";
        live = typeof raw === "string" ? raw.trim() : "";
      } catch {
        // Old sessions can be storage-backed.
      }
      return (
        live ||
        localStorage.getItem("refreshedToken")?.trim() ||
        sessionStorage.getItem("refreshedToken")?.trim() ||
        ""
      );
    });
  let token = await tokenOnPage();
  if (!token) {
    await new Promise(resolve => setTimeout(resolve, 250));
    token = await tokenOnPage();
  }
  if (!token) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
  const get = async (url: string) => {
    input.assertControl();
    const request = () =>
      input.page.context().request.get(url, {
        headers: {
          "token-id": token,
          version: "2021-07-28",
          channel: "APP",
          source: "WEB_USER",
        },
        timeout: 12_000,
      });
    let response = await request();
    for (const waitMs of [250, 500]) {
      if (![401, 403].includes(response.status())) break;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      token = await tokenOnPage();
      if (!token) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
      response = await request();
    }
    if ([401, 403].includes(response.status()))
      throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    return response;
  };
  const exact = await get(
    SERVICES + "/opportunities/" + encodeURIComponent(expected.externalId)
  );
  if (exact.status() === 404) return null;
  if (!exact.ok()) throw Error("GENIE_OPPORTUNITY_HTTP_" + exact.status());
  const detail = await exact.json();
  // Validate immutable identity BEFORE any additional lookup or data use.
  const source = detail?.opportunity;
  if (
    !source ||
    source.id !== expected.externalId ||
    source.assignedTo !== expected.ownerExternalId ||
    source.locationId !== expected.locationId
  )
    throw Error("CRM_OWNER_SCOPE_VIOLATION");
  const pipelineResponse = await get(
    SERVICES +
      "/opportunities/pipelines?locationId=" +
      encodeURIComponent(expected.locationId)
  );
  if (!pipelineResponse.ok())
    throw Error("GENIE_PIPELINE_HTTP_" + pipelineResponse.status());
  const metadata = await pipelineResponse.json();
  input.assertControl();
  return exactGenieOpportunityRecord(source, expected, metadata?.pipelines);
}
