import type { Browser, BrowserContext, Page } from "playwright-core";
import {
  claimPersistentGenieProfileBinding,
  type PersistentProfileBinding,
} from "./geniePersistentProfile";

const SESSION_KIND = "amarktai.browser-session";
const SESSION_VERSION = 2;
const MAX_ORIGINS = 12;
const MAX_KEYS_PER_ORIGIN = 256;
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 256 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const SESSION_SETTLE_INITIAL_MS = 2_000;
const SESSION_SETTLE_RECHECK_MS = 750;
const SESSION_SETTLE_CHANGED_MS = 1_250;

export type PersistentPageMode = "promote_after_auth" | "retain_live_page";

export type BrowserSessionPackage = {
  kind: typeof SESSION_KIND;
  version: typeof SESSION_VERSION;
  storageState: Record<string, unknown>;
  sessionStorageByOrigin: Record<string, Record<string, string>>;
  authorisedOrigins: string[];
  capturedAt: string;
  authenticatedUrl: string;
  persistenceMode?: "persistent_cdp";
  persistentProfileBinding?: PersistentProfileBinding;
  persistentPageMode?: PersistentPageMode;
};

type PersistentBorrowMetadata = {
  binding: PersistentProfileBinding;
  pageMode?: PersistentPageMode;
  promoted: boolean;
  authenticatedOrigin?: string;
};

const persistentBorrowedContexts = new WeakMap<
  BrowserContext,
  PersistentBorrowMetadata
>();
const persistentSessionStorageInstallVersion = new WeakMap<
  BrowserContext,
  string
>();

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPersistentProfileBinding(
  value: unknown
): value is PersistentProfileBinding {
  return (
    isObject(value) &&
    value.version === 1 &&
    Number.isInteger(value.organisationId) &&
    Number.isInteger(value.connectedSystemId)
  );
}

function isPersistentPageMode(value: unknown): value is PersistentPageMode {
  return value === "promote_after_auth" || value === "retain_live_page";
}

function normaliseOrigin(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("BROWSER_SESSION_ORIGIN_INVALID");
  return url.origin;
}

function sameAbsoluteUrl(left: string, right: string) {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return left === right;
  }
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
    typeof value.authenticatedUrl === "string" &&
    (value.persistenceMode === undefined ||
      value.persistenceMode === "persistent_cdp") &&
    (value.persistentProfileBinding === undefined ||
      isPersistentProfileBinding(value.persistentProfileBinding)) &&
    (value.persistentPageMode === undefined ||
      isPersistentPageMode(value.persistentPageMode))
  );
}

export function validateBrowserSessionPackage(value: BrowserSessionPackage) {
  if (
    value.persistenceMode === "persistent_cdp" &&
    !value.persistentProfileBinding
  )
    throw new Error("BROWSER_SESSION_PERSISTENT_BINDING_REQUIRED");
  if (
    value.persistentPageMode &&
    value.persistenceMode !== "persistent_cdp"
  )
    throw new Error("BROWSER_SESSION_PERSISTENT_PAGE_MODE_INVALID");
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

async function installSessionStorageRestoration(
  context: BrowserContext,
  completeSession: BrowserSessionPackage,
  persistent = false
) {
  if (
    persistent &&
    persistentSessionStorageInstallVersion.get(context) ===
      completeSession.capturedAt
  )
    return;

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

  if (persistent)
    persistentSessionStorageInstallVersion.set(
      context,
      completeSession.capturedAt
    );
}

function retainedPageProxy(page: Page, authenticatedUrl: string) {
  return new Proxy(page, {
    get(target, property) {
      if (property === "goto")
        return async (rawUrl: string, options?: Parameters<Page["goto"]>[1]) => {
          if (sameAbsoluteUrl(target.url(), rawUrl)) return null;
          return target.goto(rawUrl, options);
        };
      if (property === "close") return async () => undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Page;
}

function borrowPersistentContext(
  context: BrowserContext,
  binding: PersistentProfileBinding,
  pageMode?: PersistentPageMode,
  authenticatedUrl?: string
) {
  const ownedPages = new Set<Page>();
  const metadata: PersistentBorrowMetadata = {
    binding,
    pageMode,
    promoted: pageMode === "retain_live_page",
    authenticatedOrigin: authenticatedUrl
      ? normaliseOrigin(authenticatedUrl)
      : undefined,
  };
  const borrowed = new Proxy(context, {
    get(target, property) {
      if (property === "newPage")
        return async () => {
          if (metadata.promoted || metadata.pageMode === "retain_live_page") {
            const existing = target.pages().find(page => {
              if (page.isClosed() || page.url() === "about:blank") return false;
              if (!metadata.authenticatedOrigin) return true;
              try {
                return normaliseOrigin(page.url()) === metadata.authenticatedOrigin;
              } catch {
                return false;
              }
            });
            if (!existing)
              throw new Error(
                "GENIE_AUTHENTICATED_PAGE_UNAVAILABLE: The exact MFA-approved Genie tab is no longer available. Amarktai will not create a replacement page or request repeated verification codes."
              );
            return retainedPageProxy(
              existing,
              authenticatedUrl || existing.url()
            );
          }
          const page = await target.newPage();
          ownedPages.add(page);
          page.once("close", () => ownedPages.delete(page));
          return page;
        };
      if (property === "close")
        return async () => {
          if (metadata.promoted || metadata.pageMode === "retain_live_page")
            return;
          const pages = Array.from(ownedPages);
          ownedPages.clear();
          await Promise.all(
            pages.map(page => page.close().catch(() => undefined))
          );
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as BrowserContext;
  persistentBorrowedContexts.set(borrowed, metadata);
  return borrowed;
}

export async function createContextWithBrowserSession(input: {
  browser: Browser;
  browserSession?: Record<string, unknown>;
}) {
  const completeSession =
    input.browserSession && isBrowserSessionPackage(input.browserSession)
      ? validateBrowserSessionPackage(input.browserSession)
      : undefined;

  if (completeSession?.persistenceMode === "persistent_cdp") {
    const binding = completeSession.persistentProfileBinding!;
    await claimPersistentGenieProfileBinding(binding);
    const contexts = input.browser.contexts();
    if (contexts.length !== 1)
      throw new Error(
        `GENIE_PERSISTENT_PROFILE_UNAVAILABLE: Expected exactly one persistent Chromium context, found ${contexts.length}.`
      );
    await installSessionStorageRestoration(
      contexts[0],
      completeSession,
      true
    );
    return borrowPersistentContext(
      contexts[0],
      binding,
      completeSession.persistentPageMode,
      completeSession.authenticatedUrl
    );
  }

  const storageState = storageStateFromBrowserSession(input.browserSession);
  const context = await input.browser.newContext(
    storageState ? { storageState: storageState as never } : undefined
  );
  if (completeSession)
    await installSessionStorageRestoration(context, completeSession);
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

async function settleAuthenticatedSession(input: {
  context: BrowserContext;
  authenticatedUrl: string;
  authorise: (url: string) => Promise<void>;
  pages?: Page[];
}) {
  const initialPages = input.pages || input.context.pages();
  const authenticatedOrigin = normaliseOrigin(input.authenticatedUrl);
  const primaryPage =
    initialPages.find(
      page =>
        !page.isClosed() &&
        page.url() !== "about:blank" &&
        (() => {
          try {
            return normaliseOrigin(page.url()) === authenticatedOrigin;
          } catch {
            return false;
          }
        })()
    ) ||
    initialPages.find(page => !page.isClosed() && page.url() !== "about:blank");

  let settledUrl = input.authenticatedUrl;
  let settledStorageState = (await input.context.storageState({
    indexedDB: true,
  })) as unknown as Record<string, unknown>;

  if (!primaryPage) {
    await input.authorise(settledUrl);
    return { authenticatedUrl: settledUrl, storageState: settledStorageState };
  }

  const firstFingerprint = JSON.stringify({
    url: primaryPage.url(),
    storageState: settledStorageState,
    sessionStorage: await readSessionStorage(primaryPage).catch(() => ({})),
  });

  await primaryPage.waitForTimeout(SESSION_SETTLE_INITIAL_MS);
  if (!primaryPage.isClosed() && primaryPage.url() !== "about:blank") {
    settledUrl = primaryPage.url();
    await input.authorise(settledUrl);
  }
  settledStorageState = (await input.context.storageState({
    indexedDB: true,
  })) as unknown as Record<string, unknown>;
  const secondFingerprint = JSON.stringify({
    url: settledUrl,
    storageState: settledStorageState,
    sessionStorage: await readSessionStorage(primaryPage).catch(() => ({})),
  });

  await primaryPage.waitForTimeout(
    firstFingerprint === secondFingerprint
      ? SESSION_SETTLE_RECHECK_MS
      : SESSION_SETTLE_CHANGED_MS
  );
  if (!primaryPage.isClosed() && primaryPage.url() !== "about:blank") {
    settledUrl = primaryPage.url();
    await input.authorise(settledUrl);
  }
  settledStorageState = (await input.context.storageState({
    indexedDB: true,
  })) as unknown as Record<string, unknown>;

  return { authenticatedUrl: settledUrl, storageState: settledStorageState };
}

export async function captureBrowserSessionPackage(input: {
  context: BrowserContext;
  authenticatedUrl: string;
  authorise: (url: string) => Promise<void>;
  pages?: Page[];
}): Promise<BrowserSessionPackage> {
  await input.authorise(input.authenticatedUrl);
  const settled = await settleAuthenticatedSession(input);
  const sessionStorageByOrigin: Record<string, Record<string, string>> = {};
  const pages = input.pages || input.context.pages();
  for (const page of pages.slice(0, MAX_ORIGINS)) {
    if (page.isClosed() || page.url() === "about:blank") continue;
    await input.authorise(page.url());
    const origin = normaliseOrigin(page.url());
    if (sessionStorageByOrigin[origin]) continue;
    const entries = await readSessionStorage(page);
    sessionStorageByOrigin[origin] = entries;
  }
  const authenticatedOrigin = normaliseOrigin(settled.authenticatedUrl);
  if (!sessionStorageByOrigin[authenticatedOrigin])
    sessionStorageByOrigin[authenticatedOrigin] = {};
  const persistent = persistentBorrowedContexts.get(input.context);
  if (persistent?.pageMode === "promote_after_auth")
    persistent.promoted = true;
  const browserPackage: BrowserSessionPackage = {
    kind: SESSION_KIND,
    version: SESSION_VERSION,
    storageState: settled.storageState,
    sessionStorageByOrigin,
    authorisedOrigins: Object.keys(sessionStorageByOrigin),
    capturedAt: new Date().toISOString(),
    authenticatedUrl: settled.authenticatedUrl,
    ...(persistent
      ? {
          persistenceMode: "persistent_cdp" as const,
          persistentProfileBinding: persistent.binding,
          persistentPageMode: "retain_live_page" as const,
        }
      : {}),
  };
  return validateBrowserSessionPackage(browserPackage);
}
