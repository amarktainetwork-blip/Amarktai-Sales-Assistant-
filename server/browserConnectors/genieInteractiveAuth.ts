import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { assertAuthorisedConnectionUrl } from "../connectedSystems";
import type { AdapterConnection, ConnectionSecretPayload } from "../crm/types";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  isBrowserSessionPackage,
  type BrowserSessionPackage,
} from "./browserSession";

const USERNAME_SELECTOR = [
  "#email",
  'input[type="email"]',
  'input[autocomplete="username" i]',
  'input[name*="email" i]',
  'input[name*="user" i]',
].join(", ");
const PASSWORD_SELECTOR = '#password, input[type="password"]';
const LOGIN_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';
export const GENIE_MFA_SELECTOR = [
  'input[autocomplete="one-time-code" i]',
  "input.otp-input",
  'input[name*="otp" i]',
  'input[name*="mfa" i]',
  'input[name*="verification" i]',
  'input[name*="code" i]',
  'input[name*="token" i]',
  'input[id*="otp" i]',
  'input[id*="verification" i]',
  'input[id*="code" i]',
  'input[id*="token" i]',
  'input[placeholder*="code" i]',
  'input[aria-label*="code" i]',
  'input[inputmode="numeric"]',
].join(", ");
const READY_SELECTORS = [
  '[data-testid*="dashboard" i]',
  '[aria-label*="dashboard" i]',
  '[class*="crm-shell" i]',
  'a[href*="/contacts" i]',
  'a[href*="/opportunities" i]',
  'a[href*="/pipelines" i]',
  '[role="navigation"] a[href]',
  'nav a[href]',
  'aside a[href]',
] as const;
const LOADER_SELECTOR = ".hl-loader-container, .lds-ring";
const AUTHENTICATED_STRUCTURE_SELECTOR = READY_SELECTORS.join(", ");
const STRONG_AUTHENTICATED_SELECTOR = '[data-testid*="dashboard" i], [aria-label*="dashboard" i], [class*="crm-shell" i]';
const MFA_CONTAINER_SELECTOR = [
  '[data-testid*="otp" i]',
  '[data-testid*="verification" i]',
  '[class*="otp" i]',
  '[class*="verification" i]',
  '[role="dialog"][aria-label*="verification" i]',
].join(", ");
const AUTH_FEEDBACK_SELECTOR = '#error, [role="alert"], [aria-live="assertive"], [data-testid*="error" i], .error, [class*="error-message" i]';
const INTERACTIVE_AUTH_TTL_MS = 15 * 60_000;
const LOGIN_RENDER_TIMEOUT_MS = 15_000;
const VERIFICATION_RENDER_TIMEOUT_MS = 15_000;

type BlockedNavigation = { url: string; detail: string };

type BrowserHandle = {
  context: BrowserContext;
  page: Page;
  blocked: () => BlockedNavigation | undefined;
};

type LiveGenieChallenge = BrowserHandle & {
  challengeId: string;
  connectionKey: string;
  expiresAt: number;
  inUse: boolean;
  timer: ReturnType<typeof setTimeout>;
};

const liveChallenges = new Map<string, LiveGenieChallenge>();
const liveChallengeByConnection = new Map<string, string>();
let sharedCdpBrowser: Browser | undefined;
let sharedCdpBrowserConnecting: Promise<Browser> | undefined;

export type PendingGenieInteractiveAuth = {
  browserSession: Record<string, unknown>;
  challengeUrl: string;
  challengeId?: string;
  createdAt: string;
};

export type GenieBrowserSecret = ConnectionSecretPayload & {
  pendingInteractiveAuth?: PendingGenieInteractiveAuth;
};

type LoginCalibration = {
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  readySelector?: string;
};

type AuthenticatedResult = {
  status: "authenticated";
  browserSession: BrowserSessionPackage;
  authenticatedUrl: string;
  loginCalibration: LoginCalibration;
};

type VerificationRequiredResult = {
  status: "verification_required";
  pendingInteractiveAuth: PendingGenieInteractiveAuth;
};

export type GenieAuthenticationResult =
  | AuthenticatedResult
  | VerificationRequiredResult;

export type GenieInitialRenderState =
  | "login"
  | "verification"
  | "authenticated"
  | "waiting";

export function classifyGenieInitialRenderState(input: {
  usernameVisible: boolean;
  passwordVisible: boolean;
  submitVisible: boolean;
  interactive: boolean;
  ready: boolean;
  sessionAvailable: boolean;
  urlChanged: boolean;
}): GenieInitialRenderState {
  if (input.interactive) return "verification";
  if (input.usernameVisible && input.passwordVisible && input.submitVisible)
    return "login";
  if (
    !input.usernameVisible &&
    !input.passwordVisible &&
    input.ready &&
    (input.sessionAvailable || input.urlChanged)
  )
    return "authenticated";
  return "waiting";
}

function connectionKey(connection: AdapterConnection) {
  return `${connection.organisationId}:${connection.id}`;
}

function clearLiveChallengesAfterBrowserDisconnect() {
  const affectedChallenges = liveChallenges.size;
  liveChallenges.forEach(live => clearTimeout(live.timer));
  liveChallenges.clear();
  liveChallengeByConnection.clear();
  console.error(
    JSON.stringify({
      event: "genie_cdp_browser_disconnected",
      affectedChallenges,
    })
  );
}

async function getSharedCdpBrowser() {
  if (sharedCdpBrowser?.isConnected()) return sharedCdpBrowser;
  if (sharedCdpBrowserConnecting) return sharedCdpBrowserConnecting;

  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT;
  if (!endpoint)
    throw new Error(
      "No Chromium/CDP endpoint is configured for the Genie connector."
    );

  sharedCdpBrowserConnecting = chromium
    .connectOverCDP(endpoint)
    .then(browser => {
      sharedCdpBrowser = browser;
      browser.on("disconnected", () => {
        if (sharedCdpBrowser === browser) sharedCdpBrowser = undefined;
        clearLiveChallengesAfterBrowserDisconnect();
      });
      return browser;
    })
    .finally(() => {
      sharedCdpBrowserConnecting = undefined;
    });

  return sharedCdpBrowserConnecting;
}

async function closeBrowserHandle(handle: BrowserHandle) {
  await handle.context.close().catch(() => undefined);
}

async function disposeLiveChallenge(challengeId: string) {
  const live = liveChallenges.get(challengeId);
  if (!live) return;
  liveChallenges.delete(challengeId);
  if (liveChallengeByConnection.get(live.connectionKey) === challengeId)
    liveChallengeByConnection.delete(live.connectionKey);
  clearTimeout(live.timer);
  await closeBrowserHandle(live);
}

async function disposeConnectionChallenge(connection: AdapterConnection) {
  const key = connectionKey(connection);
  const challengeId = liveChallengeByConnection.get(key);
  if (challengeId) await disposeLiveChallenge(challengeId);
}

function armChallengeExpiry(live: LiveGenieChallenge) {
  clearTimeout(live.timer);
  const remaining = Math.max(1, live.expiresAt - Date.now());
  live.timer = setTimeout(() => {
    void disposeLiveChallenge(live.challengeId);
  }, remaining);
  live.timer.unref?.();
}

async function visibleLocators(locator: Locator) {
  const result: Locator[] = [];
  const count = Math.min(await locator.count(), 16);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) result.push(candidate);
  }
  return result;
}

async function oneVisible(page: Page, selector: string, label: string) {
  const matches = await visibleLocators(page.locator(selector));
  if (matches.length !== 1)
    throw new Error(
      `GENIE_LOGIN_CALIBRATION_REQUIRED: Genie showed ${matches.length} visible ${label} controls; exactly one is required.`
    );
  return matches[0];
}

async function hasVisible(page: Page, selector: string) {
  return (await visibleLocators(page.locator(selector))).length > 0;
}

async function pageSuggestsInteractiveAuth(page: Page) {
  if (await hasVisible(page, GENIE_MFA_SELECTOR).catch(() => false)) return true;
  return hasVisible(page, MFA_CONTAINER_SELECTOR).catch(() => false);
}

async function authFeedbackText(page: Page) {
  const alerts = await visibleLocators(page.locator(AUTH_FEEDBACK_SELECTOR)).catch(() => []);
  const text: string[] = [];
  for (const alert of alerts.slice(0, 4))
    text.push(await alert.innerText({ timeout: 500 }).catch(() => ""));
  return text.join(" ").slice(0, 2_000);
}

async function pageSuggestsRejectedCredentials(page: Page) {
  return /invalid (?:username|email|password|credentials)|incorrect (?:username|email|password)|sign[- ]in failed|login failed|credentials (?:were )?rejected/i.test(
    await authFeedbackText(page)
  );
}

async function pageSuggestsRejectedCode(page: Page) {
  return /invalid (?:verification|security|one[- ]time|otp)? ?code|incorrect (?:verification|security|one[- ]time|otp)? ?code|code (?:is )?invalid|code (?:has )?expired|verification failed/i.test(
    await authFeedbackText(page)
  );
}

async function readySelector(page: Page) {
  for (const selector of READY_SELECTORS) {
    const matches = await visibleLocators(page.locator(selector)).catch(() => []);
    if (matches.length >= 1) return selector;
  }
  return undefined;
}

export type GenieAppState = "login" | "verification" | "loading" | "authenticated" | "waiting";

export function classifyGenieAppState(input: {
  loginVisible: boolean;
  verificationVisible: boolean;
  loaderVisible: boolean;
  authenticatedStructureVisible: boolean;
}): GenieAppState {
  if (input.verificationVisible) return "verification";
  if (input.loginVisible) return "login";
  if (input.loaderVisible) return "loading";
  if (input.authenticatedStructureVisible) return "authenticated";
  return "waiting";
}

async function genieAppState(page: Page): Promise<GenieAppState> {
  const [username, password, submit, verification, loader, strongStructure, structures] = await Promise.all([
    hasVisible(page, USERNAME_SELECTOR).catch(() => false),
    hasVisible(page, PASSWORD_SELECTOR).catch(() => false),
    hasVisible(page, LOGIN_SUBMIT_SELECTOR).catch(() => false),
    pageSuggestsInteractiveAuth(page).catch(() => false),
    hasVisible(page, LOADER_SELECTOR).catch(() => false),
    hasVisible(page, STRONG_AUTHENTICATED_SELECTOR).catch(() => false),
    visibleLocators(page.locator(AUTHENTICATED_STRUCTURE_SELECTOR)).catch(() => []),
  ]);
  return classifyGenieAppState({
    loginVisible: username && password && submit,
    verificationVisible: verification,
    loaderVisible: loader,
    authenticatedStructureVisible: strongStructure || structures.length >= 2,
  });
}

async function waitForAuthenticatedGenieApp(input: {
  connection: AdapterConnection;
  page: Page;
  blocked: () => BlockedNavigation | undefined;
  replay: boolean;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (input.timeoutMs || 60_000);
  let lastState: GenieAppState = "waiting";
  while (Date.now() < deadline) {
    const denied = input.blocked();
    if (denied) throw blockedNavigationError(denied);
    await authorise(input.connection, input.page.url());
    lastState = await genieAppState(input.page);
    if (lastState === "authenticated") return await readySelector(input.page);
    if (input.replay && lastState === "login")
      throw new Error("GENIE_SESSION_REPLAY_FAILED: The saved Genie session returned to sign-in in a fresh browser context. Request one new verification code.");
    if (input.replay && lastState === "verification")
      throw new Error("GENIE_SESSION_REPLAY_FAILED: The saved Genie session still requires interactive verification in a fresh browser context. Request one new code.");
    await input.page.waitForTimeout(250);
  }
  throw new Error(`GENIE_SESSION_REPLAY_FAILED: Genie did not finish authenticated application bootstrap in a fresh browser context (last structural state: ${lastState}).`);
}

export async function verifyApprovedGenieSession(input: {
  connection: AdapterConnection;
  page: Page;
  blocked: () => { url: string; detail: string } | undefined;
  timeoutMs?: number;
}) {
  return waitForAuthenticatedGenieApp({ ...input, replay: true });
}

function loginCalibration(ready?: string): LoginCalibration {
  return {
    usernameSelector: "#email",
    passwordSelector: "#password",
    submitSelector: 'button[type="submit"]',
    readySelector: ready,
  };
}

function cleanLoginUrl(connection: AdapterConnection) {
  if (!connection.baseUrl)
    throw new Error(
      "GENIE_LOGIN_URL_REQUIRED: Save the authorised Genie sign-in URL before connecting."
    );
  const url = new URL(connection.baseUrl);
  url.searchParams.delete("logout");
  return url.toString();
}

async function authorise(connection: AdapterConnection, rawUrl: string) {
  await assertAuthorisedConnectionUrl({
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
    rawUrl,
  });
}

async function createContext(
  connection: AdapterConnection,
  browserSession?: Record<string, unknown>
): Promise<BrowserHandle> {
  const browser = await getSharedCdpBrowser();
  const context = await createContextWithBrowserSession({ browser, browserSession });
  const page = await context.newPage();
  let blocked: BlockedNavigation | undefined;
  await page.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame())
      return route.continue();
    try {
      await authorise(connection, request.url());
      return route.continue();
    } catch (error) {
      blocked = {
        url: request.url(),
        detail: error instanceof Error ? error.message : String(error),
      };
      return route.abort("blockedbyclient");
    }
  });
  return { context, page, blocked: () => blocked };
}

function blockedNavigationError(blocked: BlockedNavigation) {
  let hostname = "the redirected authentication service";
  try {
    hostname = new URL(blocked.url).hostname;
  } catch {
    // Keep the generic label.
  }
  return new Error(
    `GENIE_AUTH_HOST_APPROVAL_REQUIRED: Genie sign-in attempted to use ${hostname}. An elevated manager must approve that exact authentication hostname before continuing.`
  );
}

async function gotoAuthorised(
  connection: AdapterConnection,
  page: Page,
  rawUrl: string,
  blocked: () => BlockedNavigation | undefined
) {
  await authorise(connection, rawUrl);
  try {
    await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (error) {
    const denied = blocked();
    if (denied) throw blockedNavigationError(denied);
    throw error;
  }
  const denied = blocked();
  if (denied) throw blockedNavigationError(denied);
  await authorise(connection, page.url());
}

async function waitForInitialAuthenticationState(input: {
  connection: AdapterConnection;
  page: Page;
  blocked: () => BlockedNavigation | undefined;
  loginUrl: string;
  sessionAvailable: boolean;
}) {
  const deadline = Date.now() + LOGIN_RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const denied = input.blocked();
    if (denied) throw blockedNavigationError(denied);
    await authorise(input.connection, input.page.url());
    const [usernameVisible, passwordVisible, submitVisible, interactive, ready] =
      await Promise.all([
        hasVisible(input.page, USERNAME_SELECTOR).catch(() => false),
        hasVisible(input.page, PASSWORD_SELECTOR).catch(() => false),
        hasVisible(input.page, LOGIN_SUBMIT_SELECTOR).catch(() => false),
        pageSuggestsInteractiveAuth(input.page).catch(() => false),
        readySelector(input.page).then(Boolean).catch(() => false),
      ]);
    const state = classifyGenieInitialRenderState({
      usernameVisible,
      passwordVisible,
      submitVisible,
      interactive,
      ready,
      sessionAvailable: input.sessionAvailable,
      urlChanged: input.page.url() !== input.loginUrl,
    });
    if (state !== "waiting") return state;
    await input.page.waitForTimeout(250);
  }
  return "waiting" as const;
}

async function waitForVerificationChallenge(input: {
  connection: AdapterConnection;
  page: Page;
  blocked: () => BlockedNavigation | undefined;
}) {
  const deadline = Date.now() + VERIFICATION_RENDER_TIMEOUT_MS;
  let interactiveSeen = false;
  while (Date.now() < deadline) {
    const denied = input.blocked();
    if (denied) throw blockedNavigationError(denied);
    await authorise(input.connection, input.page.url());

    if (await hasVisible(input.page, GENIE_MFA_SELECTOR).catch(() => false))
      return true;

    if (await pageSuggestsInteractiveAuth(input.page).catch(() => false)) {
      interactiveSeen = true;
      await input.page.waitForTimeout(250);
      continue;
    }

    if (await hasVisible(input.page, PASSWORD_SELECTOR).catch(() => false))
      return false;
    if (await readySelector(input.page)) return false;
    await input.page.waitForTimeout(250);
  }

  if (interactiveSeen)
    throw new Error(
      "GENIE_VERIFICATION_CONTROLS_NOT_READY: Genie requested verification but its code controls have not finished rendering. The live challenge is still active; retry Verify without requesting another code."
    );
  return false;
}

async function authenticated(input: {
  connection: AdapterConnection;
  handle: BrowserHandle;
}): Promise<AuthenticatedResult> {
  const ready = await waitForAuthenticatedGenieApp({
    connection: input.connection, page: input.handle.page,
    blocked: input.handle.blocked, replay: false,
  });
  const authenticatedUrl = input.handle.page.url();
  const browserSession = await captureBrowserSessionPackage({
    context: input.handle.context,
    authenticatedUrl,
    authorise: rawUrl => authorise(input.connection, rawUrl),
  });
  await closeBrowserHandle(input.handle);
  const replay = await createContext(input.connection, browserSession);
  try {
    await gotoAuthorised(input.connection, replay.page, browserSession.authenticatedUrl, replay.blocked);
    await waitForAuthenticatedGenieApp({
      connection: input.connection, page: replay.page,
      blocked: replay.blocked, replay: true,
    });
  } finally {
    await closeBrowserHandle(replay);
  }
  return {
    status: "authenticated", browserSession, authenticatedUrl,
    loginCalibration: loginCalibration(ready),
  };
}

async function verificationRequired(
  page: Page,
  context: BrowserContext,
  challengeId: string
): Promise<VerificationRequiredResult> {
  return {
    status: "verification_required",
    pendingInteractiveAuth: {
      browserSession: (await context.storageState({ indexedDB: true })) as unknown as Record<string, unknown>,
      challengeUrl: page.url(),
      challengeId,
      createdAt: new Date().toISOString(),
    },
  };
}

async function retainLiveChallenge(
  connection: AdapterConnection,
  handle: BrowserHandle
): Promise<VerificationRequiredResult> {
  await disposeConnectionChallenge(connection);
  const challengeId = randomUUID();
  const result = await verificationRequired(
    handle.page,
    handle.context,
    challengeId
  );
  const key = connectionKey(connection);
  const live: LiveGenieChallenge = {
    ...handle,
    challengeId,
    connectionKey: key,
    expiresAt: Date.now() + INTERACTIVE_AUTH_TTL_MS,
    inUse: false,
    timer: setTimeout(() => undefined, INTERACTIVE_AUTH_TTL_MS),
  };
  clearTimeout(live.timer);
  liveChallenges.set(challengeId, live);
  liveChallengeByConnection.set(key, challengeId);
  handle.page.once("close", () => {
    if (liveChallenges.get(challengeId) !== live) return;
    console.error(
      JSON.stringify({
        event: "genie_live_challenge_page_closed",
        challengeId,
        connectionKey: key,
      })
    );
  });
  armChallengeExpiry(live);
  return result;
}

export function validateGenieVerificationCode(value: unknown) {
  const code = typeof value === "string" ? value.trim() : "";
  if (code.length < 4 || code.length > 20 || !/^[A-Za-z0-9 -]+$/.test(code))
    throw new Error(
      "GENIE_VERIFICATION_CODE_INVALID: Enter the verification code Genie sent you."
    );
  return code;
}

export function genieInteractiveAuthIsFresh(
  pending: PendingGenieInteractiveAuth,
  now = Date.now()
) {
  const created = new Date(pending.createdAt).getTime();
  return (
    Number.isFinite(created) &&
    now - created >= 0 &&
    now - created <= INTERACTIVE_AUTH_TTL_MS
  );
}

export function genieInteractiveAuthHasLiveChallenge(
  pending: PendingGenieInteractiveAuth,
  now = Date.now()
) {
  if (!pending.challengeId || !genieInteractiveAuthIsFresh(pending, now))
    return false;
  const live = liveChallenges.get(pending.challengeId);
  return Boolean(live && live.expiresAt >= now && !live.page.isClosed());
}

async function waitForVerificationFields(page: Page) {
  const deadline = Date.now() + VERIFICATION_RENDER_TIMEOUT_MS;
  let fields: Locator[] = [];
  while (Date.now() < deadline) {
    fields = await visibleLocators(page.locator(GENIE_MFA_SELECTOR));
    if (fields.length > 0) return fields;
    await page.waitForTimeout(250);
  }
  throw new Error(
    "GENIE_VERIFICATION_CONTROLS_NOT_READY: Genie requested verification but its code controls have not finished rendering. The live challenge is still active; retry Verify without requesting another code."
  );
}

async function fillVerificationCode(page: Page, code: string) {
  const fields = await waitForVerificationFields(page);
  if (fields.length === 1) {
    await fields[0].fill(code);
    return;
  }
  const compact = code.replace(/[ -]/g, "");
  if (
    fields.length >= 4 &&
    fields.length <= 12 &&
    compact.length === fields.length
  ) {
    for (let index = 0; index < fields.length; index += 1)
      await fields[index].fill(compact[index]);
    return;
  }
  throw new Error(
    `GENIE_VERIFICATION_CALIBRATION_REQUIRED: Genie showed ${fields.length} verification code controls and Amarktai could not safely map the supplied code.`
  );
}

export async function beginGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  secret: GenieBrowserSecret;
}): Promise<GenieAuthenticationResult> {
  const loginUrl = cleanLoginUrl(input.connection);
  const session = input.secret.browserSession && isBrowserSessionPackage(input.secret.browserSession)
    ? input.secret.browserSession
    : undefined;
  await disposeConnectionChallenge(input.connection);
  const handle = await createContext(input.connection, session);
  let retainedForVerification = false;
  try {
    await gotoAuthorised(
      input.connection,
      handle.page,
      loginUrl,
      handle.blocked
    );

    const initialState = await waitForInitialAuthenticationState({
      connection: input.connection,
      page: handle.page,
      blocked: handle.blocked,
      loginUrl,
      sessionAvailable: Boolean(session),
    });
    if (initialState === "verification") {
      const result = await retainLiveChallenge(input.connection, handle);
      retainedForVerification = true;
      return result;
    }
    if (initialState === "authenticated")
      return await authenticated({ connection: input.connection, handle });
    if (initialState !== "login")
      throw new Error(
        "GENIE_LOGIN_FORM_NOT_READY: Genie was reached but its sign-in form did not finish rendering. Retry setup once; no calibration is required unless this continues."
      );

    const credentials = input.secret.credentials || {};
    if (!credentials.username || !credentials.password)
      throw new Error(
        "GENIE_CREDENTIALS_REQUIRED: Encrypted Genie username and password are required."
      );

    const username = await oneVisible(
      handle.page,
      USERNAME_SELECTOR,
      "username/email"
    );
    const password = await oneVisible(handle.page, PASSWORD_SELECTOR, "password");
    const submit = await oneVisible(
      handle.page,
      LOGIN_SUBMIT_SELECTOR,
      "sign-in submit"
    );
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    await submit.click();

    const deadline = Date.now() + 45_000;
    let passwordGoneAt = 0;
    while (Date.now() < deadline) {
      const denied = handle.blocked();
      if (denied) throw blockedNavigationError(denied);
      await authorise(input.connection, handle.page.url());
      if (await pageSuggestsInteractiveAuth(handle.page)) {
        const result = await retainLiveChallenge(input.connection, handle);
        retainedForVerification = true;
        return result;
      }
      const passwordStillVisible = await hasVisible(
        handle.page,
        PASSWORD_SELECTOR
      ).catch(() => false);
      if (passwordStillVisible) {
        passwordGoneAt = 0;
        if (await pageSuggestsRejectedCredentials(handle.page))
          throw new Error(
            "GENIE_AUTHENTICATION_FAILED: Genie rejected the saved username or password."
          );
      } else {
        if (!passwordGoneAt) passwordGoneAt = Date.now();
        if (Date.now() - passwordGoneAt >= 1_500)
          return await authenticated({ connection: input.connection, handle });
      }
      await handle.page.waitForTimeout(250);
    }
    throw new Error(
      "GENIE_LOGIN_NOT_CONFIRMED: Genie sign-in did not reach a verified session."
    );
  } finally {
    if (!retainedForVerification) await closeBrowserHandle(handle);
  }
}

export async function completeGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  pending: PendingGenieInteractiveAuth;
  code: unknown;
}): Promise<AuthenticatedResult> {
  const code = validateGenieVerificationCode(input.code);
  if (!genieInteractiveAuthIsFresh(input.pending) || !input.pending.challengeId)
    throw new Error(
      "GENIE_VERIFICATION_CHALLENGE_EXPIRED: The Genie verification request expired. Request a new code and try again."
    );
  await authorise(input.connection, input.pending.challengeUrl);

  const live = liveChallenges.get(input.pending.challengeId);
  if (
    !live ||
    live.connectionKey !== connectionKey(input.connection) ||
    live.expiresAt < Date.now() ||
    live.page.isClosed()
  ) {
    if (live) await disposeLiveChallenge(live.challengeId);
    throw new Error(
      "GENIE_VERIFICATION_CHALLENGE_EXPIRED: The live Genie verification session is no longer available. Request a new code and try again."
    );
  }
  if (live.inUse)
    throw new Error(
      "GENIE_VERIFICATION_IN_PROGRESS: Genie verification is already being checked."
    );

  live.inUse = true;
  clearTimeout(live.timer);
  let keepForRetry = true;
  try {
    const challengeVisible = await waitForVerificationChallenge({
      connection: input.connection,
      page: live.page,
      blocked: live.blocked,
    });
    if (!challengeVisible) {
      const ready = await readySelector(live.page);
      if (ready) {
        keepForRetry = false;
        return await authenticated({ connection: input.connection, handle: live });
      }
      keepForRetry = false;
      throw new Error(
        "GENIE_VERIFICATION_CHALLENGE_EXPIRED: Genie no longer shows the verification challenge. Request a new code."
      );
    }

    await fillVerificationCode(live.page, code);
    await live.page.waitForTimeout(500);

    if (await pageSuggestsInteractiveAuth(live.page)) {
      let submitMatches = await visibleLocators(
        live.page.locator(LOGIN_SUBMIT_SELECTOR)
      );
      if (submitMatches.length !== 1) {
        submitMatches = await visibleLocators(
          live.page.getByRole("button", {
            name: /verify|continue|confirm|submit|sign in/i,
          })
        );
      }
      if (submitMatches.length === 1) await submitMatches[0].click();
      else if (submitMatches.length > 1)
        throw new Error(
          `GENIE_VERIFICATION_CALIBRATION_REQUIRED: Genie showed ${submitMatches.length} verification submit controls; exactly one is required.`
        );
      // Zero submit controls is valid for OTP widgets that auto-submit once the
      // final code character is entered.
    }

    const deadline = Date.now() + 30_000;
    let challengeGoneAt = 0;
    while (Date.now() < deadline) {
      const denied = live.blocked();
      if (denied) throw blockedNavigationError(denied);
      await authorise(input.connection, live.page.url());
      const challengeStillVisible = await hasVisible(
        live.page,
        GENIE_MFA_SELECTOR
      ).catch(() => false);
      if (challengeStillVisible) {
        challengeGoneAt = 0;
        if (await pageSuggestsRejectedCode(live.page))
          throw new Error(
            "GENIE_VERIFICATION_CODE_REJECTED: Genie rejected or expired that verification code."
          );
      } else {
        const passwordVisible = await hasVisible(
          live.page,
          PASSWORD_SELECTOR
        ).catch(() => false);
        if (passwordVisible) {
          keepForRetry = false;
          throw new Error(
            "GENIE_VERIFICATION_CHALLENGE_EXPIRED: Genie returned to sign-in. Request a new code."
          );
        }
        if (!challengeGoneAt) challengeGoneAt = Date.now();
        if (Date.now() - challengeGoneAt >= 1_000) {
          keepForRetry = false;
          return await authenticated({ connection: input.connection, handle: live });
        }
      }
      await live.page.waitForTimeout(250);
    }
    throw new Error(
      "GENIE_VERIFICATION_NOT_CONFIRMED: Genie did not confirm the verification code. The live challenge remains available for another Verify attempt."
    );
  } finally {
    if (keepForRetry && live.expiresAt > Date.now() && !live.page.isClosed()) {
      live.inUse = false;
      armChallengeExpiry(live);
    } else {
      await disposeLiveChallenge(live.challengeId);
    }
  }
}
