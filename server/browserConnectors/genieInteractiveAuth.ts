import { chromium, type BrowserContext, type Locator, type Page } from "playwright-core";
import { assertAuthorisedConnectionUrl } from "../connectedSystems";
import type { AdapterConnection, ConnectionSecretPayload } from "../crm/types";

const USERNAME_SELECTOR = [
  "#email",
  'input[type="email"]',
  'input[autocomplete="username" i]',
  'input[name*="email" i]',
  'input[name*="user" i]',
].join(", ");
const PASSWORD_SELECTOR = "#password, input[type=\"password\"]";
const LOGIN_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';
export const GENIE_MFA_SELECTOR = [
  'input[autocomplete="one-time-code" i]',
  'input[name*="otp" i]',
  'input[name*="mfa" i]',
  'input[name*="verification" i]',
  'input[name*="code" i]',
  'input[id*="otp" i]',
  'input[id*="verification" i]',
  'input[id*="code" i]',
  'input[inputmode="numeric"]',
].join(", ");
const READY_SELECTORS = [
  '[data-testid*="dashboard" i]',
  '[aria-label*="dashboard" i]',
  '[class*="crm-shell" i]',
  "main nav",
  '[role="navigation"]',
  "main",
  "nav",
] as const;
const INTERACTIVE_AUTH_TTL_MS = 15 * 60_000;

export type PendingGenieInteractiveAuth = {
  browserSession: Record<string, unknown>;
  challengeUrl: string;
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
  browserSession: Record<string, unknown>;
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

function asState(value: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  return value as unknown as Record<string, unknown>;
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

async function pageText(page: Page) {
  return page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
}

async function pageSuggestsInteractiveAuth(page: Page) {
  if (await hasVisible(page, GENIE_MFA_SELECTOR).catch(() => false)) return true;
  return /two[- ]factor|multi[- ]factor|verification code|security code|one[- ]time code|authenticator|approve (?:the )?sign[- ]in/i.test(
    await pageText(page)
  );
}

async function pageSuggestsRejectedCredentials(page: Page) {
  return /invalid (?:username|email|password|credentials)|incorrect (?:username|email|password)|sign[- ]in failed|login failed|credentials (?:were )?rejected/i.test(
    await pageText(page)
  );
}

async function pageSuggestsRejectedCode(page: Page) {
  return /invalid (?:verification|security|one[- ]time|otp)? ?code|incorrect (?:verification|security|one[- ]time|otp)? ?code|code (?:is )?invalid|code (?:has )?expired|verification failed/i.test(
    await pageText(page)
  );
}

async function readySelector(page: Page) {
  for (const selector of READY_SELECTORS) {
    const matches = await visibleLocators(page.locator(selector)).catch(() => []);
    if (matches.length === 1) return selector;
  }
  return undefined;
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
) {
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT;
  if (!endpoint)
    throw new Error(
      "No Chromium/CDP endpoint is configured for the Genie connector."
    );
  const browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext(
    browserSession ? { storageState: browserSession as never } : undefined
  );
  const page = await context.newPage();
  let blocked: { url: string; detail: string } | undefined;
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
  return { browser, context, page, blocked: () => blocked };
}

function blockedNavigationError(blocked: { url: string; detail: string }) {
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
  blocked: () => { url: string; detail: string } | undefined
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

async function authenticated(
  page: Page,
  context: BrowserContext
): Promise<AuthenticatedResult> {
  return {
    status: "authenticated",
    browserSession: asState(await context.storageState()),
    authenticatedUrl: page.url(),
    loginCalibration: loginCalibration(await readySelector(page)),
  };
}

async function verificationRequired(
  page: Page,
  context: BrowserContext
): Promise<VerificationRequiredResult> {
  return {
    status: "verification_required",
    pendingInteractiveAuth: {
      browserSession: asState(await context.storageState()),
      challengeUrl: page.url(),
      createdAt: new Date().toISOString(),
    },
  };
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
  return Number.isFinite(created) && now - created >= 0 && now - created <= INTERACTIVE_AUTH_TTL_MS;
}

export async function beginGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  secret: GenieBrowserSecret;
}): Promise<GenieAuthenticationResult> {
  const loginUrl = cleanLoginUrl(input.connection);
  const session = input.secret.browserSession;
  const { browser, context, page, blocked } = await createContext(
    input.connection,
    session
  );
  try {
    await gotoAuthorised(input.connection, page, loginUrl, blocked);

    const passwordVisible = await hasVisible(page, PASSWORD_SELECTOR).catch(() => false);
    if (!passwordVisible) {
      if (await pageSuggestsInteractiveAuth(page))
        return verificationRequired(page, context);
      const ready = await readySelector(page);
      if (ready) return authenticated(page, context);
    }

    const credentials = input.secret.credentials || {};
    if (!credentials.username || !credentials.password)
      throw new Error(
        "GENIE_CREDENTIALS_REQUIRED: Encrypted Genie username and password are required."
      );

    const username = await oneVisible(page, USERNAME_SELECTOR, "username/email");
    const password = await oneVisible(page, PASSWORD_SELECTOR, "password");
    const submit = await oneVisible(page, LOGIN_SUBMIT_SELECTOR, "sign-in submit");
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    await submit.click();

    const deadline = Date.now() + 45_000;
    let passwordGoneAt = 0;
    while (Date.now() < deadline) {
      const denied = blocked();
      if (denied) throw blockedNavigationError(denied);
      await authorise(input.connection, page.url());
      if (await pageSuggestsInteractiveAuth(page))
        return verificationRequired(page, context);
      const passwordStillVisible = await hasVisible(page, PASSWORD_SELECTOR).catch(() => false);
      if (passwordStillVisible) {
        passwordGoneAt = 0;
        if (await pageSuggestsRejectedCredentials(page))
          throw new Error(
            "GENIE_AUTHENTICATION_FAILED: Genie rejected the saved username or password."
          );
      } else {
        if (!passwordGoneAt) passwordGoneAt = Date.now();
        if (Date.now() - passwordGoneAt >= 1_500)
          return authenticated(page, context);
      }
      await page.waitForTimeout(250);
    }
    throw new Error(
      "GENIE_LOGIN_NOT_CONFIRMED: Genie sign-in did not reach a verified session."
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function completeGenieInteractiveAuthentication(input: {
  connection: AdapterConnection;
  pending: PendingGenieInteractiveAuth;
  code: unknown;
}): Promise<AuthenticatedResult> {
  const code = validateGenieVerificationCode(input.code);
  if (!genieInteractiveAuthIsFresh(input.pending))
    throw new Error(
      "GENIE_VERIFICATION_CHALLENGE_EXPIRED: The Genie verification request expired. Request a new code and try again."
    );
  await authorise(input.connection, input.pending.challengeUrl);
  const { browser, context, page, blocked } = await createContext(
    input.connection,
    input.pending.browserSession
  );
  try {
    await gotoAuthorised(
      input.connection,
      page,
      input.pending.challengeUrl,
      blocked
    );
    if (!(await pageSuggestsInteractiveAuth(page))) {
      const ready = await readySelector(page);
      if (ready) return authenticated(page, context);
      throw new Error(
        "GENIE_VERIFICATION_CHALLENGE_EXPIRED: Genie no longer shows the verification challenge. Request a new code."
      );
    }
    const codeInput = await oneVisible(page, GENIE_MFA_SELECTOR, "verification code");
    await codeInput.fill(code);

    let submitMatches = await visibleLocators(page.locator(LOGIN_SUBMIT_SELECTOR));
    if (submitMatches.length !== 1) {
      submitMatches = await visibleLocators(
        page.getByRole("button", { name: /verify|continue|confirm|submit|sign in/i })
      );
    }
    if (submitMatches.length !== 1)
      throw new Error(
        `GENIE_VERIFICATION_CALIBRATION_REQUIRED: Genie showed ${submitMatches.length} verification submit controls; exactly one is required.`
      );
    await submitMatches[0].click();

    const deadline = Date.now() + 30_000;
    let challengeGoneAt = 0;
    while (Date.now() < deadline) {
      const denied = blocked();
      if (denied) throw blockedNavigationError(denied);
      await authorise(input.connection, page.url());
      const challengeVisible = await hasVisible(page, GENIE_MFA_SELECTOR).catch(() => false);
      if (challengeVisible) {
        challengeGoneAt = 0;
        if (await pageSuggestsRejectedCode(page))
          throw new Error(
            "GENIE_VERIFICATION_CODE_REJECTED: Genie rejected or expired that verification code."
          );
      } else {
        const passwordVisible = await hasVisible(page, PASSWORD_SELECTOR).catch(() => false);
        if (passwordVisible)
          throw new Error(
            "GENIE_VERIFICATION_CHALLENGE_EXPIRED: Genie returned to sign-in. Request a new code."
          );
        if (!challengeGoneAt) challengeGoneAt = Date.now();
        if (Date.now() - challengeGoneAt >= 1_000)
          return authenticated(page, context);
      }
      await page.waitForTimeout(250);
    }
    throw new Error(
      "GENIE_VERIFICATION_NOT_CONFIRMED: Genie did not confirm the verification code."
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
