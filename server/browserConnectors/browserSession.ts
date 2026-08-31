import type { Browser, BrowserContext, Page } from "playwright-core";

const SESSION_KIND = "amarktai.crm-browser-session";
const SESSION_VERSION = 3;
const MAX_ORIGINS = 16;
const MAX_KEYS_PER_ORIGIN = 256;
const MAX_VALUE_LENGTH = 256 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;

export type BrowserSessionPackage = {
  kind: typeof SESSION_KIND;
  version: typeof SESSION_VERSION;
  organisationId: number;
  connectedSystemId: number;
  storageState: Record<string, unknown>;
  sessionStorageByOrigin: Record<string, Record<string, string>>;
  authorisedOrigins: string[];
  capturedAt: string;
  authenticatedUrl: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function origin(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:")
    throw new Error("BROWSER_SESSION_ORIGIN_INVALID");
  return url.origin;
}

export function isBrowserSessionPackage(
  value: unknown
): value is BrowserSessionPackage {
  return Boolean(
    isObject(value) &&
      value.kind === SESSION_KIND &&
      value.version === SESSION_VERSION &&
      Number.isInteger(value.organisationId) &&
      Number.isInteger(value.connectedSystemId) &&
      isObject(value.storageState) &&
      isObject(value.sessionStorageByOrigin) &&
      Array.isArray(value.authorisedOrigins) &&
      typeof value.capturedAt === "string" &&
      typeof value.authenticatedUrl === "string"
  );
}

export function validateBrowserSessionPackage(
  value: BrowserSessionPackage,
  expected?: { organisationId: number; connectedSystemId: number }
) {
  if (
    expected &&
    (value.organisationId !== expected.organisationId ||
      value.connectedSystemId !== expected.connectedSystemId)
  )
    throw new Error("BROWSER_SESSION_OWNERSHIP_MISMATCH");
  if (value.authorisedOrigins.length > MAX_ORIGINS)
    throw new Error("BROWSER_SESSION_ORIGIN_LIMIT_EXCEEDED");
  const allowed = new Set(value.authorisedOrigins.map(origin));
  for (const [rawOrigin, entries] of Object.entries(
    value.sessionStorageByOrigin
  )) {
    if (!allowed.has(origin(rawOrigin)) || !isObject(entries))
      throw new Error("BROWSER_SESSION_ORIGIN_NOT_AUTHORISED");
    if (Object.keys(entries).length > MAX_KEYS_PER_ORIGIN)
      throw new Error("BROWSER_SESSION_STORAGE_LIMIT_EXCEEDED");
    for (const entry of Object.values(entries))
      if (typeof entry !== "string" || entry.length > MAX_VALUE_LENGTH)
        throw new Error("BROWSER_SESSION_STORAGE_INVALID");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PACKAGE_BYTES)
    throw new Error("BROWSER_SESSION_PACKAGE_TOO_LARGE");
  return value;
}

export async function createContextWithBrowserSession(input: {
  browser: Browser;
  browserSession?: Record<string, unknown>;
  organisationId?: number;
  connectedSystemId?: number;
}) {
  const complete = isBrowserSessionPackage(input.browserSession)
    ? validateBrowserSessionPackage(
        input.browserSession,
        input.organisationId && input.connectedSystemId
          ? {
              organisationId: input.organisationId,
              connectedSystemId: input.connectedSystemId,
            }
          : undefined
      )
    : undefined;
  // Credential-era and old global-profile packages stay encrypted for safe
  // operator-led deprecation, but are never used as a browser identity.
  const context = await input.browser.newContext(
    complete ? { storageState: complete.storageState as never } : undefined
  );
  if (complete)
    await context.addInitScript(
      ({ values }) => {
        const entries = values[location.origin];
        if (!entries) return;
        for (const [key, value] of Object.entries(entries))
          try {
            sessionStorage.setItem(key, value);
          } catch {
            /* verified after load */
          }
      },
      { values: complete.sessionStorageByOrigin }
    );
  return context;
}

async function readSessionStorage(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) || "";
        return [key, sessionStorage.getItem(key) || ""];
      }).filter(([key]) => Boolean(key))
    )
  );
}

export async function captureBrowserSessionPackage(input: {
  context: BrowserContext;
  organisationId: number;
  connectedSystemId: number;
  authenticatedUrl: string;
  authorise: (url: string) => Promise<void>;
  pages?: Page[];
}): Promise<BrowserSessionPackage> {
  await input.authorise(input.authenticatedUrl);
  const sessionStorageByOrigin: Record<string, Record<string, string>> = {};
  for (const page of (input.pages || input.context.pages()).slice(
    0,
    MAX_ORIGINS
  )) {
    if (page.isClosed() || page.url() === "about:blank") continue;
    await input.authorise(page.url());
    const pageOrigin = origin(page.url());
    sessionStorageByOrigin[pageOrigin] ||= await readSessionStorage(page).catch(
      () => ({})
    );
  }
  sessionStorageByOrigin[origin(input.authenticatedUrl)] ||= {};
  return validateBrowserSessionPackage({
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    storageState: (await input.context.storageState({
      indexedDB: true,
    })) as unknown as Record<string, unknown>,
    sessionStorageByOrigin,
    authorisedOrigins: Object.keys(sessionStorageByOrigin),
    capturedAt: new Date().toISOString(),
    authenticatedUrl: input.authenticatedUrl,
  });
}
