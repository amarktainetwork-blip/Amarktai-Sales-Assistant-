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
      sourceUpdatedAt: row.updatedAt || "",
      sourceRevision: row.updatedAt || "",
    };
  });
}
/** Only GET reads, exact owner and location checked on every record, bounded complete drain. */
export async function readOwnerScopedGenieOpportunities(input: {
  page: Page;
  ownerExternalId: string;
  assertControl: () => void;
}): Promise<BrowserScriptResult> {
  const location = input.page
    .url()
    .match(/\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!location || !input.ownerExternalId)
    throw Error("CRM_OWNER_SCOPE_REQUIRED");
  const token = async () => {
    const value = await input.page.evaluate(async () => {
      const f = (window as any).getToken;
      return typeof f === "function" ? String(await f()) : "";
    });
    if (!value) throw Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    return value;
  };
  let current = await token();
  let refreshed = false;
  const get = async (path: string) => {
    input.assertControl();
    const request = () =>
      input.page
        .context()
        .request.get(BASE + path, {
          headers: {
            "token-id": current,
            version: "2021-07-28",
            channel: "APP",
            source: "WEB_USER",
          },
          timeout: 30000,
        });
    let r = await request();
    if (r.status() === 401 && !refreshed) {
      refreshed = true;
      current = await token();
      r = await request();
    }
    if (!r.ok()) {
      const error = await r.json();
      throw Error(
        `GENIE_OPPORTUNITY_HTTP_${r.status()} ${JSON.stringify(error.message)}`
      );
    }
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
  let total: number | undefined;
  let cursor = "";
  let previous = "";
  for (let page = 1; page <= 500; page++) {
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
    if (page === 1) total = Number(body.meta?.total);
    if (!Number.isInteger(total) || total! < 0)
      throw Error("GENIE_OPPORTUNITY_TOTAL_REQUIRED");
    const before = records.size;
    for (const row of rows) records.set(row.externalId, row);
    if (records.size === total)
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
    if (records.size > total! || rows.length < 100 || records.size === before)
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
  }
  throw Error("CRM_SYNC_PAGE_LIMIT_REACHED");
}
