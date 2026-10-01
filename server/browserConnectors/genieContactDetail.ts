import type { Page } from "playwright-core";
import type { BrowserScriptResult } from "./scriptEngine";

const ORIGIN = "https://genie.entrepreneurscircle.org";
const SERVICES = "https://services.leadconnectorhq.com";

/** A read-only detail lookup, independent of Genie SPA rendering. */
export function exactGenieContactTarget(currentUrl: string, requested: string) {
  const current = new URL(currentUrl);
  const scope = current.pathname.match(
    /^\/v2\/location\/([A-Za-z0-9_-]+)(?:\/|$)/
  );
  if (current.origin !== ORIGIN || !scope)
    throw new Error("GENIE_CONTACT_TARGET_SCOPE_REQUIRED");
  // Runtime getContact uses an immutable ID; commissioning uses a verified URL.
  if (/^[A-Za-z0-9_-]{1,180}$/.test(requested))
    return { locationId: scope[1], externalId: requested };
  const target = new URL(requested, current);
  const match = target.pathname.match(
    /^\/v2\/location\/([A-Za-z0-9_-]+)\/contacts\/detail\/([A-Za-z0-9_-]+)\/?$/
  );
  if (
    current.origin !== ORIGIN ||
    target.origin !== ORIGIN ||
    !scope ||
    !match ||
    match[1] !== scope[1] ||
    target.search ||
    target.hash
  )
    throw new Error("GENIE_CONTACT_TARGET_SCOPE_REQUIRED");
  return { locationId: scope[1], externalId: match[2] };
}

export function exactGenieContactRecord(
  value: unknown,
  expected: { locationId: string; externalId: string; ownerExternalId: string }
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GENIE_CONTACT_SCHEMA_REQUIRED");
  const contact = value as Record<string, unknown>;
  if (
    contact.id !== expected.externalId ||
    contact.locationId !== expected.locationId ||
    contact.assignedTo !== expected.ownerExternalId
  )
    throw new Error("CRM_OWNER_SCOPE_VIOLATION");
  return {
    externalId: expected.externalId,
    ownerExternalId: expected.ownerExternalId,
    firstName: typeof contact.firstName === "string" ? contact.firstName : "",
    lastName: typeof contact.lastName === "string" ? contact.lastName : "",
    email: typeof contact.email === "string" ? contact.email : "",
    phone: typeof contact.phone === "string" ? contact.phone : "",
  };
}

export async function readOwnerScopedGenieContactDetail(input: {
  page: Page;
  requested: string;
  ownerExternalId: string;
  assertControl: () => void;
}): Promise<BrowserScriptResult> {
  if (!input.ownerExternalId) throw new Error("CRM_OWNER_SCOPE_REQUIRED");
  const target = exactGenieContactTarget(input.page.url(), input.requested);
  const readToken = () =>
    input.page.evaluate(async () => {
      const getter = (window as any).getToken;
      const raw = typeof getter === "function" ? await getter() : "";
      return typeof raw === "string" ? raw.trim() : "";
    });
  let token = await readToken();
  if (!token) {
    await new Promise(resolve => setTimeout(resolve, 250));
    token = await readToken();
  }
  if (!token) throw new Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
  const get = () => {
    input.assertControl();
    return input.page
      .context()
      .request.get(
        SERVICES + "/contacts/" + encodeURIComponent(target.externalId),
        {
          headers: {
            "token-id": token,
            version: "2021-07-28",
            channel: "APP",
            source: "WEB_USER",
          },
          timeout: 12000,
        }
      );
  };
  let response = await get();
  if (response.status() === 401) {
    const refreshed = await readToken();
    if (!refreshed || refreshed === token)
      throw new Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    token = refreshed;
    response = await get();
  }
  if (!response.ok())
    throw new Error(
      response.status() === 401
        ? "CRM_BROWSER_REAUTHENTICATION_REQUIRED"
        : `GENIE_CONTACT_HTTP_${response.status()}`
    );
  const payload = await response.json();
  input.assertControl();
  const record = exactGenieContactRecord(payload?.contact, {
    ...target,
    ownerExternalId: input.ownerExternalId,
  });
  return {
    success: true,
    completedAt: new Date().toISOString(),
    detail: "Exact owner-scoped contact read verified with GET only.",
    data: {
      records: JSON.stringify([record]),
      actualExternalId: target.externalId,
      ownerExternalId: input.ownerExternalId,
      collectionEvidence:
        "Exact owner and location verified in live contact response.",
    },
  };
}
