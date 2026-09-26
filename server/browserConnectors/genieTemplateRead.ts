import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";

const ROOT = "https://services.leadconnectorhq.com";
export const GENIE_TEMPLATE_PAGE_LIMIT = 100;
export const GENIE_TEMPLATE_MAX_PAGES = 50;

export type GenieCommunicationTemplate = {
  externalId: string;
  name: string;
  type: "email" | "sms" | "whatsapp";
  body: string;
  subject?: string;
  locationId: string;
  sourceUpdatedAt?: string;
};

export function normalizeGenieTemplates(
  payload: unknown,
  locationId: string
): { records: GenieCommunicationTemplate[]; totalCount: number } {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const templates = Array.isArray(root.templates) ? root.templates : null;
  const totalCount = Number(root.totalCount);
  if (!templates || !Number.isInteger(totalCount) || totalCount < 0)
    throw new Error("GENIE_TEMPLATE_SCHEMA_REQUIRED");

  const records = templates.map(value => {
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, any>)
        : {};
    const externalId = String(row.id || "").trim();
    const name = String(row.name || "").trim();
    const type = String(row.type || "").trim().toLowerCase();
    const sourceLocationId = String(row.locationId || "").trim();
    if (
      !externalId ||
      !name ||
      !["email", "sms", "whatsapp"].includes(type) ||
      sourceLocationId !== locationId
    )
      throw new Error("GENIE_TEMPLATE_SCOPE_VIOLATION");

    const template =
      row.template && typeof row.template === "object"
        ? row.template
        : {};
    const body = String(
      type === "email"
        ? template.html || template.body || ""
        : template.body || template.message || ""
    ).trim();
    if (!body) throw new Error("GENIE_TEMPLATE_CONTENT_REQUIRED");

    return {
      externalId,
      name,
      type: type as GenieCommunicationTemplate["type"],
      body,
      subject:
        type === "email"
          ? String(template.subject || row.subject || "").trim() || undefined
          : undefined,
      locationId: sourceLocationId,
      sourceUpdatedAt: String(
        row.updatedAt || row.dateUpdated || row.dateAdded || ""
      ).trim() || undefined,
    };
  });
  return { records, totalCount };
}

export function normalizeGenieSnippets(
  payload: unknown,
  locationId: string
): GenieCommunicationTemplate[] {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  if (!Array.isArray(root.snippets))
    throw new Error("GENIE_SNIPPET_SCHEMA_REQUIRED");
  if (root.snippets.length > 2_000)
    throw new Error("GENIE_SNIPPET_BOUND_EXCEEDED");

  return root.snippets
    .filter(value => value && typeof value === "object" && !Array.isArray(value))
    .filter(value => !(value as Record<string, unknown>).isFolder)
    .map(value => {
      const row = value as Record<string, any>;
      const explicitLocationId = String(row.locationId || "").trim();
      const sourceLocationId = explicitLocationId || locationId;
      const externalId = String(row._id || row.id || "").trim();
      const name = String(row.name || "").trim();
      const type = String(row.type || "").trim().toLowerCase();
      const template =
        row.template && typeof row.template === "object" ? row.template : {};
      const body = String(
        type === "email"
          ? template.html || template.body || ""
          : template.body || template.message || ""
      ).trim();
      if (explicitLocationId && explicitLocationId !== locationId)
        throw new Error("GENIE_SNIPPET_SCOPE_VIOLATION: foreign location.");
      if (!externalId)
        throw new Error("GENIE_SNIPPET_SCHEMA_REQUIRED: immutable id missing.");
      if (!name)
        throw new Error("GENIE_SNIPPET_SCHEMA_REQUIRED: name missing.");
      if (!["email", "sms", "whatsapp"].includes(type))
        throw new Error(
          "GENIE_SNIPPET_TYPE_UNSUPPORTED: " +
            (type || "(empty)") +
            "; rowKeys=" +
            Object.keys(row).sort().join(",") +
            "; templateKeys=" +
            Object.keys(template).sort().join(",")
        );
      if (!body)
        throw new Error(
          "GENIE_SNIPPET_CONTENT_REQUIRED: template keys=" +
            Object.keys(template).sort().join(",")
        );
      return {
        externalId,
        name,
        type: type as GenieCommunicationTemplate["type"],
        body,
        subject:
          type === "email"
            ? String(template.subject || "").trim() || undefined
            : undefined,
        locationId: sourceLocationId,
        sourceUpdatedAt:
          String(row.updatedAt || row.dateUpdated || row.dateAdded || "").trim() ||
          undefined,
      };
    });
}

export async function readGenieCommunicationTemplates(input: {
  page: Page;
  assertControl: () => void;
}): Promise<BrowserScriptResult> {
  const locationId = input.page
    .url()
    .match(/\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!locationId)
    throw new Error(
      "GENIE_TEMPLATE_LOCATION_REQUIRED: authenticated Genie location is unavailable."
    );

  const browserToken = async () => {
    const value = await input.page.evaluate(async () => {
      const getToken = (window as Window & { getToken?: () => unknown }).getToken;
      if (typeof getToken === "function") {
        const fresh = String(await getToken());
        if (fresh) return fresh;
      }
      return (
        localStorage.getItem("refreshedToken") ||
        sessionStorage.getItem("refreshedToken") ||
        ""
      );
    });
    if (!value)
      throw new Error(
        "CRM_BROWSER_REAUTHENTICATION_REQUIRED: authenticated Genie token is unavailable."
      );
    return value;
  };

  let token = await browserToken();
  const records = new Map<string, GenieCommunicationTemplate>();
  const legacyRecords = new Map<string, GenieCommunicationTemplate>();

  input.assertControl();
  const snippetRequest = () =>
    input.page.context().request.get(
      ROOT + "/snippets/" + encodeURIComponent(locationId) + "?all=true",
      {
        headers: {
          "token-id": token,
          version: "2021-07-28",
          channel: "APP",
          source: "WEB_USER",
        },
        timeout: 30_000,
      }
    );
  let snippetResponse = await snippetRequest();
  for (
    let retry = 0;
    [401, 403].includes(snippetResponse.status()) && retry < 3;
    retry++
  ) {
    await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
    token = await browserToken();
    snippetResponse = await snippetRequest();
  }
  if (!snippetResponse.ok())
    throw new Error(
      "GENIE_SNIPPET_HTTP_ERROR: HTTP " + snippetResponse.status() + "."
    );
  const snippets = normalizeGenieSnippets(
    await snippetResponse.json(),
    locationId
  );
  for (const row of snippets) records.set(row.externalId, row);

  let expectedTotal: number | undefined;

  for (let pageNumber = 0; pageNumber < GENIE_TEMPLATE_MAX_PAGES; pageNumber++) {
    input.assertControl();
    const skip = pageNumber * GENIE_TEMPLATE_PAGE_LIMIT;
    const request = () => {
      const params = new URLSearchParams({
        deleted: "false",
        skip: String(skip),
        limit: String(GENIE_TEMPLATE_PAGE_LIMIT),
        originId: locationId,
      });
      return input.page.context().request.get(
        `${ROOT}/locations/${encodeURIComponent(locationId)}/templates?${params}`,
        {
          headers: {
            "token-id": token,
            version: "2021-04-15",
            channel: "APP",
            source: "WEB_USER",
          },
          timeout: 30_000,
        }
      );
    };

    let response = await request();
    for (
      let retry = 0;
      [401, 403].includes(response.status()) && retry < 3;
      retry++
    ) {
      await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
      token = await browserToken();
      response = await request();
    }
    for (
      let retry = 0;
      [429, 502, 503, 504, 520, 521, 522, 523, 524].includes(
        response.status()
      ) && retry < 2;
      retry++
    ) {
      await new Promise(resolve => setTimeout(resolve, 500 * (retry + 1)));
      response = await request();
    }
    if (!response.ok())
      throw new Error(
        `GENIE_TEMPLATE_HTTP_ERROR: HTTP ${response.status()}.`
      );

    const normalized = normalizeGenieTemplates(
      await response.json(),
      locationId
    );
    if (pageNumber === 0) expectedTotal = normalized.totalCount;
    if (expectedTotal !== normalized.totalCount)
      throw new Error("GENIE_TEMPLATE_TOTAL_CHANGED_DURING_READ");

    const before = legacyRecords.size;
    for (const row of normalized.records) {
      legacyRecords.set(row.externalId, row);
      records.set(row.externalId, row);
    }
    if (legacyRecords.size === expectedTotal) {
      return {
        success: true,
        completedAt: new Date().toISOString(),
        detail: "Genie communication template catalogue read verified.",
        data: {
          records: JSON.stringify(Array.from(records.values())),
          sourceTotal: String(records.size),
          pagesRead: String(pageNumber + 1),
          snippetTotal: String(snippets.length),
          legacyTemplateTotal: String(expectedTotal),
          collectionEvidence:
            "Genie template catalogue verified " +
            records.size +
            " reusable sales templates.",
        },
      };
    }

    if (
      legacyRecords.size > expectedTotal! ||
      normalized.records.length < GENIE_TEMPLATE_PAGE_LIMIT ||
      legacyRecords.size === before
    )
      throw new Error("GENIE_TEMPLATE_DRAIN_INCOMPLETE");
  }

  throw new Error(
    "CRM_SYNC_PAGE_LIMIT_REACHED: Genie templates exceeded the bounded drain."
  );
}
