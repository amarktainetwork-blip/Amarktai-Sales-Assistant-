import type { Browser, BrowserContext, Page } from "playwright-core";

const SESSION_KIND = "amarktai.browser-session";
const SESSION_VERSION = 2;
const MAX_ORIGINS = 12;
const MAX_KEYS_PER_ORIGIN = 256;
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 256 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;

export type BrowserSessionPackage = {
  kind: typeof SESSION_KIND;
  version: typeof SESSION_VERSION;
  storageState: Record<string, unknown>;
  sessionStorageByOrigin: Record<string, Record<string, string>>;
  authorisedOrigins: string[];
  capturedAt: string;
  authenticatedUrl: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normaliseOrigin(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("BROWSER_SESSION_ORIGIN_INVALID");
  return url.origin;
}

function packageSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function isBrowserSessionPackage(
  value: unknown
): value is BrowserSessionPackage {
  return (
    isObject(value) &&
    value.kind === SESSION_KIND &&
    value.version === SESSION_VERSION &&
    isObject(value.storageState) &&
    isObject(value.sessionStorageByOrigin) &&
    Array.isArray(value.authorisedOrigins) &&
    typeof value.capturedAt === "string" &&
    typeof value.authenticatedUrl === "string"
  );
}

export function validateBrowserSessionPackage(value: BrowserSessionPackage) {
  if (value.authorisedOrigins.length > MAX_ORIGINS)
    throw new Error("BROWSER_SESSION_ORIGIN_LIMIT_EXCEEDED");
  const allowed = new Set(
    value.authorisedOrigins.map(origin => normaliseOrigin(origin))
  );
  for (const [origin, entries] of Object.entries(
    value.sessionStorageByOrigin
  )) {
    if (!allowed.has(normaliseOrigin(origin)) || !isObject(entries))
      throw new Error("BROWSER_SESSION_ORIGIN_NOT_AUTHORISED");
    const pairs = Object.entries(entries);
    if (pairs.length > MAX_KEYS_PER_ORIGIN)
      throw new Error("BROWSER_SESSION_STORAGE_LIMIT_EXCEEDED");
    for (const [key, entryValue] of pairs) {
      if (
        key.length > MAX_KEY_LENGTH ||
        typeof entryValue !== "string" ||
        entryValue.length > MAX_VALUE_LENGTH
      )
        throw new Error("BROWSER_SESSION_STORAGE_INVALID");
    }
  }
  if (packageSize(value) > MAX_PACKAGE_BYTES)
    throw new Error("BROWSER_SESSION_PACKAGE_TOO_LARGE");
  return value;
}

/**
 * Old encrypted browser secrets contained storageState directly. They remain
 * readable for one migration attempt, but only a v2 package can be approved
 * after the mandatory replay gate.
 */
export function storageStateFromBrowserSession(
  value?: Record<string, unknown>
) {
  if (!value) return undefined;
  return isBrowserSessionPackage(value) ? value.storageState : value;
}

export async function createContextWithBrowserSession(input: {
  browser: Browser;
  browserSession?: Record<string, unknown>;
}) {
  const completeSession = input.browserSession && isBrowserSessionPackage(input.browserSession)
    ? validateBrowserSessionPackage(input.browserSession)
    : undefined;
  const storageState = storageStateFromBrowserSession(input.browserSession);
  const context = await input.browser.newContext(
    storageState ? { storageState: storageState as never } : undefined
  );
  if (completeSession) {
    await context.addInitScript(
      ({ sessionStorageByOrigin }) => {
        const entries = sessionStorageByOrigin[location.origin];
        if (!entries) return;
        for (const [key, value] of Object.entries(entries)) {
          try {
            sessionStorage.setItem(key, value);
          } catch {
            // A malformed/over-quota origin fails closed in the app verifier.
          }
        }
      },
      { sessionStorageByOrigin: completeSession.sessionStorageByOrigin }
    );
  }
  return context;
}

export async function captureBrowserSessionPackage(input: {
  context: BrowserContext;
  authenticatedUrl: string;
  authorise: (url: string) => Promise<void>;
  pages?: Page[];
}): Promise<BrowserSessionPackage> {
  await input.authorise(input.authenticatedUrl);
  const sessionStorageByOrigin: Record<string, Record<string, string>> = {};
  const pages = input.pages || input.context.pages();
  for (const page of pages.slice(0, MAX_ORIGINS)) {
    if (page.isClosed() || page.url() === "about:blank") continue;
    await input.authorise(page.url());
    const origin = normaliseOrigin(page.url());
    if (sessionStorageByOrigin[origin]) continue;
    const entries = await page.evaluate(() =>
      Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, index) => {
          const key = sessionStorage.key(index) || "";
          return [key, sessionStorage.getItem(key) || ""];
        }).filter(([key]) => Boolean(key))
      )
    );
    sessionStorageByOrigin[origin] = entries;
  }
  const authenticatedOrigin = normaliseOrigin(input.authenticatedUrl);
  if (!sessionStorageByOrigin[authenticatedOrigin])
    sessionStorageByOrigin[authenticatedOrigin] = {};
  const browserPackage: BrowserSessionPackage = {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    storageState: (await input.context.storageState({
      indexedDB: true,
    })) as unknown as Record<string, unknown>,
    sessionStorageByOrigin,
    authorisedOrigins: Object.keys(sessionStorageByOrigin),
    capturedAt: new Date().toISOString(),
    authenticatedUrl: input.authenticatedUrl,
  };
  return validateBrowserSessionPackage(browserPackage);
}
