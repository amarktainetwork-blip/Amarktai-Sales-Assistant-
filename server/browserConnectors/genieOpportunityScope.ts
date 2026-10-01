import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";
const BASE = "https://services.leadconnectorhq.com";
export function normalizeGenieOpportunities(
  payload: any,
  owner: string,
  location: string,
  pipelines: any[]
) {
  if (!owner || !Array.isArray(payload.opportunities))
    throw Error("GENIE_OPPORTUNITY_SCHEMA_REQUIRED");
  return payload.opportunities.map((row: any) => {
    if (!row.id || row.assignedTo !== owner || row.locationId !== location)
      throw Error("CRM_OWNER_SCOPE_VIOLATION");
    const pipeline = pipelines.find(p => p.id === row.pipelineId);
    const stage = pipeline?.stages?.find(
      (s: any) => s.id === row.pipelineStageId
    );
    return {
      externalId: row.id,
      contactExternalId: row.contactId || row.contact?.id || "",
      ownerExternalId: owner,
      name: row.name || "",
      pipeline: pipeline?.name || row.pipelineId || "",
      stage: stage?.name || row.pipelineStageId || "",
      status: row.status || "unknown",
      pipelineExternalId: row.pipelineId || "",
      stageExternalId: row.pipelineStageId || "",
      value:
        typeof row.monetaryValue === "number" ? String(row.monetaryValue) : "",
      closeAt:
        row.status === "won"
          ? row.lastStatusChangeAt || row.updatedAt || ""
          : "",
      lastStatusChangeAt: row.lastStatusChangeAt || "",
      lastStageChangeAt: row.lastStageChangeAt || "",
      createdAt: row.createdAt || "",
      sourceUpdatedAt: row.updatedAt || "",
      sourceRevision: row.updatedAt || "",
    };
  });
}
/** A compact cursor for a bounded, resumable, exact-owner opportunity snapshot. */
export type GenieOpportunityContinuation = {
  version: 1;
  after: [string | number, string];
  seen: number;
  sourceTotal: number;
};

export function parseGenieOpportunityContinuation(value?: string) {
  if (!value) return undefined;
  let parsed: Partial<GenieOpportunityContinuation>;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw Error("GENIE_OPPORTUNITY_CONTINUATION_INVALID");
  }
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.after) ||
    parsed.after.length !== 2 ||
    !["string", "number"].includes(typeof parsed.after[0]) ||
    typeof parsed.after[1] !== "string" ||
    !parsed.after[1] ||
    !Number.isSafeInteger(parsed.seen) ||
    !Number.isSafeInteger(parsed.sourceTotal) ||
    Number(parsed.seen) < 0 ||
    Number(parsed.sourceTotal) <= Number(parsed.seen)
  )
    throw Error("GENIE_OPPORTUNITY_CONTINUATION_INVALID");
  return parsed as GenieOpportunityContinuation;
}

/** GET-only owner-scoped reader. Default remains the fully verified source drain.
 * The bounded mode publishes only a continuation until the complete count is proven.
 */
export async function readOwnerScopedGenieOpportunities(input: {
  page: Page;
  ownerExternalId: string;
  assertControl: () => void;
  continuation?: string;
  maxPages?: number;
}): Promise<BrowserScriptResult> {
  const location = input.page
    .url()
    .match(/\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!location || !input.ownerExternalId)
    throw Error("CRM_OWNER_SCOPE_REQUIRED");
  // Read only the browser's existing authenticated token, including the
  // retained token used by older Genie sessions when SPA getToken is missing.
  // Never invent a token or accept an expired one merely because it is stored.
  const token = async () => {
    const readToken = () =>
      input.page.evaluate(async () => {
        const f = (window as any).getToken;
        let liveToken = "";
        try {
          const value = typeof f === "function" ? await f() : "";
          liveToken = typeof value === "string" ? value.trim() : "";
        } catch {
          // A retained authenticated browser session may still have its token.
        }
        return (
          liveToken ||
          localStorage.getItem("refreshedToken")?.trim() ||
          sessionStorage.getItem("refreshedToken")?.trim() ||
          ""
        );
      });
    let value = await readToken();
    if (!value) {
      await new Promise(resolve => setTimeout(resolve, 250));
      value = await readToken();
    }
    if (!value) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    return value;
  };
  let current = await token();
  const get = async (path: string) => {
    const request = () => {
      input.assertControl();
      return input.page.context().request.get(BASE + path, {
        headers: {
          "token-id": current,
          version: "2021-07-28",
          channel: "APP",
          source: "WEB_USER",
        },
        timeout: input.maxPages === undefined ? 30000 : 12000,
      });
    };
    let r = await request();
    // Genie may rotate token-id after a successful prior page. Retry only
    // the exact GET, bounded and per-request; never widen owner/location scope.
    for (const delayMs of [250, 500]) {
      if (![401, 403].includes(r.status())) break;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      current = await token();
      r = await request();
    }
    if ([401, 403].includes(r.status()))
      throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    if (!r.ok()) {
      const error = await r.json().catch(() => ({}));
      throw Error(
        `GENIE_OPPORTUNITY_HTTP_${r.status()} ${JSON.stringify(error.message || "")}`
      );
    }
    input.assertControl();
    return r.json();
  };
  const metadata = await get(
    `/opportunities/pipelines?locationId=${encodeURIComponent(location)}`
  );
  if (
    !Array.isArray(metadata.pipelines) ||
    metadata.pipelines.some((p: any) => p.locationId !== location)
  )
    throw Error("GENIE_PIPELINE_LOCATION_INVALID");
  const records = new Map<
    string,
    ReturnType<typeof normalizeGenieOpportunities>[number]
  >();
  const continuation = parseGenieOpportunityContinuation(input.continuation);
  const pageLimit =
    input.maxPages === undefined
      ? 500
      : Math.min(12, Math.max(1, Math.floor(input.maxPages)));
  let total: number | undefined = continuation?.sourceTotal;
  const alreadySeen = continuation?.seen ?? 0;
  let cursor = continuation ? JSON.stringify(continuation.after) : "";
  let previous = cursor;
  for (let page = 1; page <= pageLimit; page++) {
    const params = new URLSearchParams({
      location_id: location,
      assigned_to: input.ownerExternalId,
      limit: "100",
      page: String(page),
    });
    if (cursor) {
      params.delete("page");
      const c = JSON.parse(cursor);
      params.set("startAfter", String(c[0]));
      params.set("startAfterId", String(c[1]));
    }
    const body = await get("/opportunities/search?" + params);
    const rows = normalizeGenieOpportunities(
      body,
      input.ownerExternalId,
      location,
      metadata.pipelines
    );
    const observedTotal = Number(body.meta?.total);
    if (!Number.isSafeInteger(observedTotal) || observedTotal < 0)
      throw Error("GENIE_OPPORTUNITY_TOTAL_REQUIRED");
    if (total !== undefined && total !== observedTotal)
      throw Error("GENIE_OPPORTUNITY_SNAPSHOT_CHANGED");
    total = observedTotal;
    const before = records.size;
    for (const row of rows) records.set(row.externalId, row);
    const cumulative = alreadySeen + records.size;
    if (cumulative === total)
      return {
        success: true,
        completedAt: new Date().toISOString(),
        detail: "Owner-scoped opportunities read verified.",
        data: {
          records: JSON.stringify(Array.from(records.values())),
          sourceTotal: String(total),
          pagesRead: String(page),
          ownerExternalId: input.ownerExternalId,
          collectionEvidence: `Owner-scoped Genie search verified ${total} opportunities.`,
          snapshotComplete: "true",
          pipelineMetadata: JSON.stringify(
            metadata.pipelines.map((p: any) => ({
              externalId: p.id,
              name: p.name,
              stages: p.stages.map((s: any) => ({
                externalId: s.id,
                name: s.name,
              })),
            }))
          ),
        },
      };
    if (cumulative > total! || rows.length < 100 || records.size === before)
      throw Error("GENIE_OPPORTUNITY_DRAIN_INCOMPLETE");
    const next =
      body.meta?.startAfter !== undefined && body.meta?.startAfterId
        ? [body.meta.startAfter, body.meta.startAfterId]
        : body.opportunities.at(-1)?.sort;
    if (!Array.isArray(next) || next.length < 2)
      throw Error("GENIE_OPPORTUNITY_CURSOR_REQUIRED");
    cursor = JSON.stringify(next);
    if (cursor === previous) throw Error("CRM_SYNC_CURSOR_STALLED");
    previous = cursor;
    if (input.maxPages !== undefined && page >= pageLimit) {
      const nextCursor: GenieOpportunityContinuation = {
        version: 1,
        after: next as [string | number, string],
        seen: cumulative,
        sourceTotal: total,
      };
      return {
        success: true,
        completedAt: new Date().toISOString(),
        detail: "Owner-scoped opportunity snapshot is still in progress.",
        data: {
          records: JSON.stringify(Array.from(records.values())),
          sourceTotal: String(total),
          pagesRead: String(page),
          ownerExternalId: input.ownerExternalId,
          snapshotComplete: "false",
          nextCursor: JSON.stringify(nextCursor),
          collectionEvidence: `Bounded batch: ${cumulative} of ${total} owner-scoped opportunities read; snapshot not complete.`,
        },
      };
    }
  }
  throw Error("CRM_SYNC_PAGE_LIMIT_REACHED");
}
