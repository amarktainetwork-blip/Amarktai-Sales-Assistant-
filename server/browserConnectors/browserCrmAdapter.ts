import { readFile } from "node:fs/promises";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import {
  assertAuthorisedConnectionUrl,
  loadConnectionSecret,
} from "../connectedSystems";
import type {
  AdapterConnection,
  AdapterEvidence,
  CapabilityResult,
  ConnectionSecretPayload,
  ConnectionTest,
  CrmAdapter,
  CrmCapability,
  CrmProvider,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
  OutboundMessageInput,
} from "../crm/types";
import {
  executeSavedBrowserScript,
  validateSavedBrowserScript,
  type SavedBrowserScript,
} from "./scriptEngine";
import {
  browserOperationReadinessForSystem,
  browserShadowMode,
  recordBrowserOperationResult,
  requireRuntimeBrowserOperation,
} from "./learnedOperations";
import {
  ADAPTER_OPERATION_KEYS,
  BROWSER_OPERATION_CATALOGUE,
  verifyBrowserCreateTarget,
  verifyBrowserPostconditions,
  verifyBrowserTarget,
  type BrowserTargetIdentity,
} from "./operationContracts";
import { recordLearnedRuntimeFailure } from "./runtimeFailure";
import { createContextWithBrowserSession, isBrowserSessionPackage } from "./browserSession";
import { verifyApprovedGenieSession } from "./genieInteractiveAuth";

const DEFAULT_GENIE_OPERATION_MAP: Record<string, string> = {
  searchContacts: "search_candidate",
  getContact: "read_candidate_history",
  createNote: "add_note",
  createTask: "create_next_task",
  completeTask: "complete_active_task",
  updateContact: "update_contact_status",
  updateOpportunity: "update_current_opportunity",
  sendSms: "send_template_sms",
  sendEmail: "send_template_email",
  sendWhatsApp: "send_template_whatsapp",
  applySequence: "apply_sequence",
  healthCheck: "health_check",
};

const CAPABILITY_OPERATIONS: Record<CrmCapability, string[]> = {
  "contacts.read": ["searchContacts", "getContact", "syncContacts"],
  "contacts.write": ["createContact", "updateContact"],
  "companies.read": ["getCompany", "syncCompanies"],
  "companies.write": ["createCompany"],
  "opportunities.read": ["getOpportunity", "syncOpportunities"],
  "opportunities.write": ["createOpportunity", "updateOpportunity"],
  "tasks.read": ["syncTasks", "getContact"],
  "tasks.write": ["createTask", "completeTask"],
  "activities.read": ["syncActivities", "getContact"],
  "activities.write": ["createActivity"],
  "notes.read": ["getContact"],
  "notes.write": ["createNote"],
  "owners.read": ["syncContacts", "syncTasks"],
  "pipelines.read": ["listPipelines", "syncOpportunities"],
  "email.send": ["sendEmail"],
  "sms.send": ["sendSms"],
  "whatsapp.send": ["sendWhatsApp"],
  "sequences.apply": ["applySequence"],
};

type BrowserLoginProfile = {
  url: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  readySelector?: string;
};
export type BrowserProfile = {
  browserEndpoint?: string;
  login?: BrowserLoginProfile;
  scripts: Record<string, SavedBrowserScript>;
  operationMap?: Record<string, string>;
  resultKeys?: Record<string, string>;
  operationDefinitions?: Record<
    string,
    {
      definition: unknown;
      prerequisites?: Record<string, unknown>;
      targetAssertions?: Record<string, unknown>;
      postconditionAssertions?: Array<Record<string, unknown>>;
    }
  >;
  artifactDirectory?: string;
};

type ManagedCdpBrowser = {
  browser?: Browser;
  connecting?: Promise<Browser>;
};

const managedCdpBrowsers = new Map<string, ManagedCdpBrowser>();

export function resetBrowserConnectorCdpPoolForTests() {
  managedCdpBrowsers.clear();
}

export function browserAuthenticationRequired(
  provider: Extract<CrmProvider, "genie" | "custom_browser">,
  profile: Pick<BrowserProfile, "login">
) {
  if (provider === "genie" && !profile.login)
    loginError(
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      "No authorised Genie sign-in URL is available. Save the connected system URL and retry."
    );
  return Boolean(profile.login);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asProfile(value: unknown): BrowserProfile | undefined {
  if (!isObject(value)) return undefined;
  const scripts: Record<string, SavedBrowserScript> = {};
  if (isObject(value.scripts))
    for (const [key, script] of Object.entries(value.scripts))
      if (isObject(script) && Array.isArray(script.steps))
        scripts[key] = validateSavedBrowserScript(
          script as unknown as SavedBrowserScript
        );
  const login =
    isObject(value.login) && typeof value.login.url === "string"
      ? (value.login as unknown as BrowserLoginProfile)
      : undefined;
  return {
    browserEndpoint:
      typeof value.browserEndpoint === "string"
        ? value.browserEndpoint
        : undefined,
    login,
    scripts,
    operationMap: isObject(value.operationMap)
      ? Object.fromEntries(
          Object.entries(value.operationMap).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
    resultKeys: isObject(value.resultKeys)
      ? Object.fromEntries(
          Object.entries(value.resultKeys).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string"
          )
        )
      : undefined,
    operationDefinitions: isObject(value.operationDefinitions)
      ? Object.fromEntries(
          Object.entries(value.operationDefinitions).filter((entry) =>
            isObject(entry[1])
          )
        ) as BrowserProfile["operationDefinitions"]
      : undefined,
    artifactDirectory:
      typeof value.artifactDirectory === "string"
        ? value.artifactDirectory
        : undefined,
  };
}

async function genieProfile(): Promise<BrowserProfile | undefined> {
  const path =
    process.env.GENIE_SCRIPTS_CONFIG_PATH || "/app/config/genie-scripts.json";
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      scripts?: Record<string, SavedBrowserScript>;
      operationDefinitions?: BrowserProfile["operationDefinitions"];
    };
    if (!parsed.scripts) return undefined;
    const loginUrl = process.env.GENIE_LOGIN_URL;
    return {
      browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT,
      login: loginUrl
        ? {
            url: loginUrl,
            usernameSelector:
              process.env.GENIE_USERNAME_SELECTOR || 'input[name="username"]',
            passwordSelector:
              process.env.GENIE_PASSWORD_SELECTOR || 'input[type="password"]',
            submitSelector:
              process.env.GENIE_LOGIN_SUBMIT_SELECTOR ||
              'button[type="submit"]',
            readySelector: process.env.GENIE_DASHBOARD_SELECTOR,
          }
        : undefined,
      scripts: Object.fromEntries(
        Object.entries(parsed.scripts).map(([key, script]) => [
          key,
          validateSavedBrowserScript(script),
        ])
      ),
      operationMap: DEFAULT_GENIE_OPERATION_MAP,
      operationDefinitions: parsed.operationDefinitions,
      artifactDirectory:
        process.env.GENIE_ARTIFACT_DIR || "/app/data/genie-artifacts",
    };
  } catch {
    return undefined;
  }
}

export async function resolveBrowserProfile(
  connection: AdapterConnection,
  provider: Extract<CrmProvider, "genie" | "custom_browser">
) {
  const configured = asProfile(connection.configuration.browserProfile);
  if (provider === "genie") {
    const installed = await genieProfile();
    if (configured)
      return {
        ...installed,
        ...configured,
        browserEndpoint:
          configured.browserEndpoint ||
          installed?.browserEndpoint ||
          process.env.BROWSERLESS_WS_ENDPOINT,
        login:
          configured.login ||
          (connection.baseUrl ? { url: connection.baseUrl } : installed?.login),
        scripts: { ...(installed?.scripts || {}), ...configured.scripts },
        operationMap: {
          ...(installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP),
          ...(configured.operationMap || {}),
        },
        operationDefinitions: {
          ...(installed?.operationDefinitions || {}),
          ...(configured.operationDefinitions || {}),
        },
      } satisfies BrowserProfile;
    if (connection.baseUrl)
      return {
        browserEndpoint:
          installed?.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT,
        login: { url: connection.baseUrl },
        scripts: installed?.scripts || {},
        operationMap: installed?.operationMap || DEFAULT_GENIE_OPERATION_MAP,
        resultKeys: installed?.resultKeys,
        artifactDirectory: installed?.artifactDirectory,
      } satisfies BrowserProfile;
    if (installed) return installed;
  }
  if (configured) return configured;
  return connection.baseUrl
    ? { browserEndpoint: process.env.BROWSERLESS_WS_ENDPOINT, scripts: {} }
    : undefined;
}
async function browserSecret(
  connection: AdapterConnection,
  supplied?: ConnectionSecretPayload
) {
  if (supplied && Object.keys(supplied).length) return supplied;
  return (
    (await loadConnectionSecret({
      organisationId: connection.organisationId,
      connectedSystemId: connection.id,
      secretKind: "browser",
    })) || {}
  );
}
export function resolveBrowserCredentials(secret?: ConnectionSecretPayload, provider?: string) {
  const fromSecret = secret?.credentials || {};
  if (Object.keys(fromSecret).length) return fromSecret;
  if (provider === "genie")
    return {
      username: process.env.GENIE_USERNAME || "",
      password: process.env.GENIE_PASSWORD || "",
    };
  return {};
}
function operationScript(profile: BrowserProfile, operation: string) {
  const key = profile.operationMap?.[operation] || operation;
  return profile.scripts[key];
}
function artifactDirectory(
  profile: BrowserProfile,
  connection: AdapterConnection
) {
  return (
    profile.artifactDirectory ||
    `/app/data/browser-artifacts/${connection.organisationId}/${connection.id}`
  );
}
async function connect(profile: BrowserProfile) {
  const endpoint =
    profile.browserEndpoint || process.env.BROWSERLESS_WS_ENDPOINT;
  if (!endpoint)
    throw new Error(
      "No Chromium/CDP endpoint is configured for this browser connector."
    );

  const existing = managedCdpBrowsers.get(endpoint);
  if (existing?.browser?.isConnected()) return existing.browser;
  if (existing?.connecting) return existing.connecting;

  const connecting = chromium
    .connectOverCDP(endpoint)
    .then(browser => {
      managedCdpBrowsers.set(endpoint, { browser });
      browser.on("disconnected", () => {
        if (managedCdpBrowsers.get(endpoint)?.browser === browser)
          managedCdpBrowsers.delete(endpoint);
      });
      return browser;
    })
    .catch(error => {
      managedCdpBrowsers.delete(endpoint);
      throw error;
    });
  managedCdpBrowsers.set(endpoint, { connecting });
  return connecting;
}
async function authorizeNavigation(
  connection: AdapterConnection,
  rawUrl: string
) {
  await assertAuthorisedConnectionUrl({
    organisationId: connection.organisationId,
    connectedSystemId: connection.id,
    rawUrl,
  });
}

const AUTO_USERNAME_SELECTOR = [
  'input[type="email"]',
  'input[autocomplete="username" i]',
  'input[name*="email" i]',
  'input[name*="user" i]',
].join(", ");
const AUTO_PASSWORD_SELECTOR = 'input[type="password"]';
const AUTO_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';
const MFA_SELECTOR = [
  'input[autocomplete="one-time-code" i]',
  'input[name*="otp" i]',
  'input[name*="mfa" i]',
  'input[name*="verification" i]',
].join(", ");
const AUTH_FEEDBACK_SELECTOR = '#error, [role="alert"], [aria-live="assertive"], [data-testid*="error" i], .error, [class*="error-message" i]';
const CRM_SHELL_SELECTOR = [
  '[data-testid*="dashboard" i]',
  '[aria-label*="dashboard" i]',
  '[class*="crm-shell" i]',
  'main nav',
].join(", ");

type AuthenticationProof = {
  method: "configured_ready_selector" | "login_form_disappeared" | "authorised_url_changed" | "approved_session";
  loginUrl: string;
  authenticatedUrl: string;
};

type BlockedNavigation = { url: string; detail: string };

function loginError(code: string, guidance: string): never {
  throw new Error(`${code}: ${guidance}`);
}

async function visibleLocators(locator: Locator) {
  const visible: Locator[] = [];
  const count = Math.min(await locator.count(), 12);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) visible.push(candidate);
  }
  return visible;
}

async function oneVisible(
  page: Page,
  selector: string,
  label: string
) {
  let matches: Locator[];
  try {
    matches = await visibleLocators(page.locator(selector));
  } catch {
    loginError(
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      `The saved ${label} selector is invalid. Genie was reached, but Amarktai needs help identifying the sign-in form.`
    );
  }
  if (matches.length !== 1)
    loginError(
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      `Genie was reached, but Amarktai needs help identifying the sign-in form. Found ${matches.length} visible ${label} controls; exactly one is required. Use Calibrate sign-in.`
    );
  return matches[0];
}

async function hasVisible(page: Page, selector: string) {
  return (await visibleLocators(page.locator(selector))).length > 0;
}

export function meaningfulReadySelector(selector?: string) {
  const normalized = selector?.trim().toLowerCase();
  return Boolean(normalized && !["body", "html", "*", "html body"].includes(normalized));
}

function blockedRedirectError(blocked: BlockedNavigation): never {
  let hostname = "the redirected authentication service";
  try {
    hostname = new URL(blocked.url).hostname;
  } catch {
    // Keep the non-sensitive generic label.
  }
  if (/private|unsafe network|local/i.test(blocked.detail))
    loginError(
      "GENIE_AUTH_REDIRECT_PRIVATE_BLOCKED",
      `Genie sign-in attempted to redirect to ${hostname}, which is a private or unsafe network destination. The redirect remains blocked.`
    );
  loginError(
    "GENIE_AUTH_HOST_APPROVAL_REQUIRED",
    `Genie sign-in redirects through ${hostname}. An elevated manager must approve this exact authentication hostname for this connected system to continue.`
  );
}

async function pageSuggestsMfa(page: Page) {
  return hasVisible(page, MFA_SELECTOR).catch(() => false);
}

async function pageSuggestsRejectedCredentials(page: Page) {
  const alerts = await visibleLocators(page.locator(AUTH_FEEDBACK_SELECTOR)).catch(() => []);
  const text = (await Promise.all(alerts.slice(0, 4).map(alert => alert.innerText({ timeout: 500 }).catch(() => "")))).join(" ").slice(0, 2_000);
  return /invalid (?:username|email|password|credentials)|incorrect (?:username|email|password)|sign[- ]in failed|login failed|credentials (?:were )?rejected/i.test(text);
}

async function authenticate(
  page: Page,
  profile: BrowserProfile,
  secret: ConnectionSecretPayload,
  provider: string,
  authorize: (url: string) => Promise<void>,
  blockedNavigation: () => BlockedNavigation | undefined,
  timeoutMs = 45_000
): Promise<AuthenticationProof | undefined> {
  if (!browserAuthenticationRequired(
    provider as Extract<CrmProvider, "genie" | "custom_browser">,
    profile
  )) return undefined;
  const login = profile.login!;
  const creds = resolveBrowserCredentials(secret, provider);
  await authorize(login.url);
  try {
    await page.goto(login.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch (error) {
    const blocked = blockedNavigation();
    if (blocked) blockedRedirectError(blocked);
    throw error;
  }
  const blockedAfterNavigation = blockedNavigation();
  if (blockedAfterNavigation) blockedRedirectError(blockedAfterNavigation);
  await authorize(page.url());

  const initialUrl = page.url();
  const loginHostname = new URL(login.url).hostname.toLowerCase();
  const visiblePasswords = await visibleLocators(
    page.locator(login.passwordSelector || AUTO_PASSWORD_SELECTOR)
  );
  if (!visiblePasswords.length) {
    const configuredReady =
      meaningfulReadySelector(login.readySelector) &&
      (await hasVisible(page, login.readySelector!).catch(() => false));
    const knownShell = await hasVisible(page, CRM_SHELL_SELECTOR).catch(() => false);
    if (configuredReady || knownShell)
      return {
        method: "approved_session",
        loginUrl: login.url,
        authenticatedUrl: page.url(),
      };
    if (await pageSuggestsMfa(page))
      loginError(
        "GENIE_INTERACTIVE_AUTH_REQUIRED",
        "Genie requires interactive MFA or SSO. Amarktai will not bypass it; complete approved session commissioning before retrying."
      );
    loginError(
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      "Genie was reached, but Amarktai needs help identifying the sign-in form. Use Calibrate sign-in."
    );
  }

  if (!creds.username || !creds.password)
    loginError(
      "GENIE_CREDENTIALS_REQUIRED",
      "Encrypted username and password are required for this connected system. Save its secure sign-in details and retry."
    );

  const username = await oneVisible(
    page,
    login.usernameSelector || AUTO_USERNAME_SELECTOR,
    "username/email"
  );
  const password = await oneVisible(
    page,
    login.passwordSelector || AUTO_PASSWORD_SELECTOR,
    "password"
  );
  const submit = await oneVisible(
    page,
    login.submitSelector || AUTO_SUBMIT_SELECTOR,
    "submit"
  );
  await username.fill(creds.username);
  await password.fill(creds.password);
  try {
    await submit.click();
  } catch (error) {
    const blocked = blockedNavigation();
    if (blocked) blockedRedirectError(blocked);
    throw error;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blocked = blockedNavigation();
    if (blocked) blockedRedirectError(blocked);
    if (await pageSuggestsMfa(page))
      loginError(
        "GENIE_INTERACTIVE_AUTH_REQUIRED",
        "Genie requires interactive MFA or SSO. Amarktai will not bypass it; complete approved session commissioning before retrying."
      );
    const passwordStillVisible = await hasVisible(
      page,
      login.passwordSelector || AUTO_PASSWORD_SELECTOR
    ).catch(() => false);
    if (passwordStillVisible && (await pageSuggestsRejectedCredentials(page)))
      loginError(
        "GENIE_AUTHENTICATION_FAILED",
        "Genie rejected the saved sign-in details. Update the encrypted username and password, then retry."
      );
    const currentUrl = page.url();
    await authorize(currentUrl);
    const onGenieHostname =
      new URL(currentUrl).hostname.toLowerCase() === loginHostname;
    const ready =
      meaningfulReadySelector(login.readySelector) &&
      (await hasVisible(page, login.readySelector!).catch(() => false));
    if (ready && !passwordStillVisible)
      return {
        method: "configured_ready_selector",
        loginUrl: login.url,
        authenticatedUrl: currentUrl,
      };
    if (!passwordStillVisible && onGenieHostname)
      return {
        method:
          currentUrl !== initialUrl
            ? "authorised_url_changed"
            : "login_form_disappeared",
        loginUrl: login.url,
        authenticatedUrl: currentUrl,
      };
    await page.waitForTimeout(250);
  }
  loginError(
    "GENIE_LOGIN_NOT_CONFIRMED",
    "Genie sign-in was submitted, but an authenticated CRM page could not be proven. The login form is still visible; check the credentials or calibrate the ready marker."
  );
}

export async function authenticateCommissioningPage(input: {
  page: Page;
  loginUrl: string;
  credentials?: Record<string, string>;
  browserSession?: Record<string, unknown>;
  loginCalibration?: Omit<BrowserLoginProfile, "url">;
  authorize: (url: string) => Promise<void>;
  blockedNavigation?: () => BlockedNavigation | undefined;
  timeoutMs?: number;
}) {
  return authenticate(
    input.page,
    {
      scripts: {},
      login: { url: input.loginUrl, ...(input.loginCalibration || {}) },
    },
    {
      credentials: input.credentials,
      browserSession: input.browserSession,
    },
    "genie",
    input.authorize,
    input.blockedNavigation || (() => undefined),
    input.timeoutMs
  );
}
async function withPage<T>(
  connection: AdapterConnection,
  secret: ConnectionSecretPayload,
  provider: string,
  profile: BrowserProfile,
  run: (page: Page, context: BrowserContext) => Promise<T>
) {
  const browser: Browser = await connect(profile);
  const context = await createContextWithBrowserSession({ browser, browserSession: secret.browserSession });
  const page = await context.newPage();
  let blocked: BlockedNavigation | undefined;
  await page.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame())
      return route.continue();
    try {
      await authorizeNavigation(connection, request.url());
      return route.continue();
    } catch (error) {
      blocked = {
        url: request.url(),
        detail: error instanceof Error ? error.message : String(error),
      };
      return route.abort("blockedbyclient");
    }
  });
  try {
    if (provider === "genie" && secret.browserSession && isBrowserSessionPackage(secret.browserSession)) {
      const replayUrl = secret.browserSession.authenticatedUrl || profile.login?.url;
      if (!replayUrl)
        loginError("GENIE_LOGIN_CALIBRATION_REQUIRED", "No authorised Genie replay URL is available.");
      await authorizeNavigation(connection, replayUrl);
      try {
        await page.goto(replayUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (error) {
        if (blocked) blockedRedirectError(blocked);
        throw error;
      }
      if (blocked) blockedRedirectError(blocked);
      await verifyApprovedGenieSession({ connection, page, blocked: () => blocked });
    } else if (browserAuthenticationRequired(
      provider as Extract<CrmProvider, "genie" | "custom_browser">,
      profile
    ))
      await authenticate(
        page,
        profile,
        secret,
        provider,
        url => authorizeNavigation(connection, url),
        () => blocked
      );
    return await run(page, context);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export type BrowserDiscoveryControl = {
  tag: string;
  role: string;
  label: string;
  selector: string;
  href?: string;
  pageUrl?: string;
};

/**
 * Reads a bounded, secret-free navigation/control snapshot after the normal
 * authorised authentication boundary. It never clicks a CRM control or reads
 * input values, table rows, messages, notes, or customer data.
 */
export async function inspectBrowserCrmNavigation(input: {
  connection: AdapterConnection;
  secret?: ConnectionSecretPayload;
  provider: Extract<CrmProvider, "genie" | "custom_browser">;
}) {
  const profile = await resolveBrowserProfile(input.connection, input.provider);
  if (!profile)
    throw new Error("No browser connector profile is available for discovery.");
  const secret = await browserSecret(input.connection, input.secret);
  return withPage(
    input.connection,
    secret,
    input.provider,
    profile,
    async page => {
      if (page.url() === "about:blank" && input.connection.baseUrl) {
        await authorizeNavigation(input.connection, input.connection.baseUrl);
        await page.goto(input.connection.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await authorizeNavigation(input.connection, page.url());
      }
      const readControls = () => page
        .locator(
          "nav a, aside a, [role='navigation'] a, a[href], button, input, textarea, select, [data-testid], [data-field], [role='button'], [role='tab'], label, h1, h2, h3"
        )
        .evaluateAll(elements =>
          elements.slice(0, 300).map(element => {
            const html = element as HTMLElement;
            const tag = html.tagName.toLowerCase();
            const id = html.id?.trim();
            const testId = html.getAttribute("data-testid")?.trim();
            const dataField = html.getAttribute("data-field")?.trim();
            const aria = html.getAttribute("aria-label")?.trim();
            const name = html.getAttribute("name")?.trim();
            const role = html.getAttribute("role")?.trim() || tag;
            const href = (html as HTMLAnchorElement).href || undefined;
            const safeAttribute = (key: string, value?: string | null) =>
              value && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value)
                ? `[${key}="${CSS.escape(value)}"]`
                : "";
            const selector = testId
              ? safeAttribute("data-testid", testId)
              : dataField
                ? safeAttribute("data-field", dataField)
              : id && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/.test(id)
                ? `#${CSS.escape(id)}`
                : aria
                  ? safeAttribute("aria-label", aria)
                  : name
                    ? safeAttribute("name", name)
                    : tag;
            return {
              tag,
              role,
              label: (aria || testId || dataField ||
                (/^(?:a|button|label|h1|h2|h3)$/.test(tag)
                  ? html.innerText || html.textContent || ""
                  : ""))
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160),
              selector,
              href,
            };
          })
        );
      const raw = await readControls();
      const controls: BrowserDiscoveryControl[] = [];
      const appendControls = async (
        discovered: typeof raw,
        sourcePageUrl: string
      ) => {
        for (const item of discovered) {
          let href: string | undefined;
          if (item.href) {
            try {
              const authorised = await assertAuthorisedConnectionUrl({
                organisationId: input.connection.organisationId,
                connectedSystemId: input.connection.id,
                rawUrl: item.href,
              });
              href = `${authorised.origin}${authorised.pathname}`;
            } catch {
              continue;
            }
          }
          if (!item.label && !href) continue;
          controls.push({ ...item, href, pageUrl: sourcePageUrl });
        }
      };
      const initialPageUrl = new URL(page.url()).origin + new URL(page.url()).pathname;
      await appendControls(raw, initialPageUrl);
      const destinations = Array.from(new Set(
        controls.map(control => control.href).filter((href): href is string => Boolean(href))
      )).filter(href =>
        href !== initialPageUrl &&
        !/(?:logout|log-out|signout|sign-out|delete|remove|unsubscribe|execute|run-workflow)/i.test(new URL(href).pathname)
      ).slice(0, 12);
      for (const destination of destinations) {
        if (controls.length >= 250) break;
        await authorizeNavigation(input.connection, destination);
        await page.goto(destination, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await authorizeNavigation(input.connection, page.url());
        const sourcePageUrl = new URL(page.url()).origin + new URL(page.url()).pathname;
        await appendControls(await readControls(), sourcePageUrl);
      }
      return {
        pageUrl: initialPageUrl,
        controls: controls.slice(0, 250),
        readOnly: true as const,
      };
    }
  );
}
async function runOperation(input: {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  provider: string;
  operation: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  allowTestReady?: boolean;
  publishByUserId?: number;
}) {
  const profile = await resolveBrowserProfile(
    input.connection,
    input.provider as Extract<CrmProvider, "genie" | "custom_browser">
  );
  if (!profile)
    throw new Error(
      "This browser CRM has no calibrated connector profile. Add a reviewed browser profile before verification."
    );
  const operationKey =
    ADAPTER_OPERATION_KEYS[input.operation] || input.operation;
  const catalogue = BROWSER_OPERATION_CATALOGUE.find(
    item => item.key === operationKey
  );
  let learned:
    | Awaited<ReturnType<typeof requireRuntimeBrowserOperation>>
    | undefined;
  try {
    learned = await requireRuntimeBrowserOperation({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey,
      allowTestReady: input.allowTestReady,
    });
  } catch (error) {
    if (catalogue?.mode !== "read") throw error;
    const legacy = operationScript(profile, input.operation);
    if (!legacy) throw error;
  }
  const payload = {
    ...resolveBrowserCredentials(input.secret, input.provider),
    ...(input.payload || {}),
  };
  const script =
    learned?.definition.execute || operationScript(profile, input.operation);
  if (!script) {
    const detail = `OPERATION_NOT_LEARNED: '${operationKey}' has no deterministic definition.`;
    if (learned)
      await recordLearnedRuntimeFailure({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        correlationId: input.correlationId,
        detail,
      });
    throw new Error(detail);
  }
  const runScript = (
    page: Page,
    selected: SavedBrowserScript,
    suffix: string
  ) =>
    executeSavedBrowserScript({
      page,
      script: selected,
      inputs: payload,
      artifactDirectory: artifactDirectory(profile, input.connection),
      artifactPrefix: `${input.provider}-${operationKey}-${suffix}`,
      authorizeNavigation: url => authorizeNavigation(input.connection, url),
    });
  try {
    const result = await withPage(
      input.connection,
      input.secret,
      input.provider,
      profile,
      async page => {
        let guardian: ReturnType<typeof verifyBrowserTarget> | undefined;
        if (learned?.definition.mode === "write") {
          const targetRead = await runScript(
            page,
            learned.definition.targetRead!,
            "target"
          );
          if (!targetRead.success)
            throw new Error(`TARGET_VERIFICATION_FAILED: ${targetRead.detail}`);
          const rawTargets =
            targetRead.data.targets ||
            targetRead.data.target ||
            targetRead.data.records;
          const parsed = rawTargets
            ? (JSON.parse(rawTargets) as unknown)
            : [targetRead.data];
          const candidates = (Array.isArray(parsed) ? parsed : [parsed])
            .filter(isObject)
            .map(item => item as BrowserTargetIdentity);
          const destination =
            typeof payload.to === "string" ? payload.to.trim() : "";
          const expected = Object.fromEntries(
            Object.entries({
              externalId: payload.externalId || payload.contactExternalId,
              taskId: payload.taskExternalId,
              opportunityId: payload.opportunityExternalId,
              name: payload.contactName || payload.name || payload.leadLabel,
              email:
                payload.email || (destination.includes("@") ? destination : ""),
              phone:
                payload.phone || (destination.includes("@") ? "" : destination),
              company: payload.company,
            }).filter(([, value]) => typeof value === "string" && value.trim())
          ) as BrowserTargetIdentity;
          guardian =
            learned.targetAssertions.mode === "must_not_exist"
              ? verifyBrowserCreateTarget(expected, candidates)
              : verifyBrowserTarget(expected, candidates);
          if (!guardian.ok)
            throw new Error(`${guardian.code}: ${guardian.detail}`);
          if (browserShadowMode(input.connection.configuration))
            return {
              success: true,
              completedAt: new Date().toISOString(),
              detail:
                "SHADOW_MODE: target verified; external write was not executed.",
              data: { shadowMode: "true", guardian: JSON.stringify(guardian) },
              screenshotPath: targetRead.screenshotPath,
            };
        }
        const execution = await runScript(page, script, "execute");
        if (!execution.success) throw new Error(execution.detail);
        if (learned?.definition.mode === "write") {
          const readback = await runScript(
            page,
            learned.definition.postconditionRead!,
            "postcondition"
          );
          if (!readback.success)
            throw new Error(`EXECUTION_UNVERIFIED: ${readback.detail}`);
          const verification = verifyBrowserPostconditions(
            learned.postconditionAssertions,
            readback.data,
            payload
          );
          if (!verification.ok)
            throw new Error(
              `EXECUTION_UNVERIFIED: ${verification.failures.join(" ")}`
            );
          execution.data.guardian = JSON.stringify(guardian);
          execution.data.postcondition = JSON.stringify(verification);
          if (readback.screenshotPath)
            execution.screenshotPath = readback.screenshotPath;
        }
        return execution;
      }
    );
    if (!result.success) throw new Error(result.detail);
    if (learned)
      await recordBrowserOperationResult({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        success: true,
        publishByUserId: input.publishByUserId,
        evidence: {
          correlationId: input.correlationId,
          completedAt: result.completedAt,
          targetVerified: learned.definition.mode === "write",
          postconditionVerified:
            learned.definition.mode === "write" &&
            result.data.shadowMode !== "true",
          shadowMode: result.data.shadowMode === "true",
          screenshotPath: result.screenshotPath,
        },
      });
    return {
      result,
      profile: {
        ...profile,
        resultKeys: {
          ...(profile.resultKeys || {}),
          [input.operation]:
            learned?.definition.resultKey ||
            profile.resultKeys?.[input.operation] ||
            "records",
        },
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (learned)
      await recordLearnedRuntimeFailure({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        operationKey,
        version: learned.version,
        correlationId: input.correlationId,
        detail,
      });
    throw error;
  }
}

export async function testLearnedBrowserOperation(input: {
  connection: AdapterConnection;
  secret?: ConnectionSecretPayload;
  provider: Extract<CrmProvider, "genie" | "custom_browser">;
  operationKey: string;
  payload?: Record<string, unknown>;
  correlationId: string;
  publishByUserId?: number;
}) {
  const secret = await browserSecret(input.connection, input.secret);
  const result = await runOperation({
    ...input,
    secret,
    operation: input.operationKey,
    allowTestReady: true,
  });
  if (result.result.data.shadowMode === "true" && input.publishByUserId)
    throw new Error(
      "A shadow-mode replay cannot publish an operation as LIVE_PROVEN because no external write occurred."
    );
  if (input.publishByUserId) {
    const learned = await requireRuntimeBrowserOperation({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey: input.operationKey,
      allowTestReady: true,
    });
    await recordBrowserOperationResult({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      operationKey: input.operationKey,
      version: learned.version,
      success: true,
      publishByUserId: input.publishByUserId,
      evidence: {
        correlationId: input.correlationId,
        completedAt: result.result.completedAt,
        controlledReplay: true,
        targetVerified: learned.definition.mode === "write",
        postconditionVerified: learned.definition.mode === "write",
        screenshotPath: result.result.screenshotPath,
      },
    });
  }
  return evidence(input.operationKey, input.correlationId, result.result);
}
function evidence(
  operation: string,
  correlationId: string,
  result: {
    completedAt: string;
    data: Record<string, string>;
    screenshotPath?: string;
  }
): AdapterEvidence {
  return {
    operation,
    correlationId,
    completedAt: result.completedAt,
    providerResult: { data: result.data },
    screenshotPath: result.screenshotPath,
  };
}
function rows(
  result: { data: Record<string, string> },
  profile: BrowserProfile,
  operation: string
) {
  const key = profile.resultKeys?.[operation] || "records";
  const raw = result.data[key];
  if (!raw) return [] as Array<Record<string, string>>;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed))
    throw new Error(
      `Browser connector '${operation}' did not return an array in result key '${key}'.`
    );
  return parsed
    .filter(isObject)
    .map(item =>
      Object.fromEntries(
        Object.entries(item).map(([field, value]) => [
          field,
          String(value ?? ""),
        ])
      )
    );
}
function asDate(value?: string) {
  if (!value) return undefined;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? undefined : result;
}
function asMinor(value?: string) {
  const number = Number(value);
  return value && Number.isFinite(number)
    ? Math.round(number * 100)
    : undefined;
}
function externalId(row: Record<string, string>, resource: string) {
  const value = (row.externalId || row.id || "").trim();
  if (!value)
    throw new Error(
      `INVALID_EXTERNAL_ID: Genie ${resource} extraction returned a row without an external record ID.`
    );
  return value;
}
function contact(row: Record<string, string>): NormalizedContact {
  return {
    externalId: externalId(row, "contact"),
    companyExternalId: row.companyExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    firstName: row.firstName || undefined,
    lastName: row.lastName || undefined,
    email: row.email?.trim().toLowerCase() || undefined,
    phone: row.phone?.trim() || undefined,
    lifecycleStage: row.lifecycleStage || row.status || undefined,
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function company(row: Record<string, string>): NormalizedCompany {
  return {
    externalId: externalId(row, "company"),
    name: row.name || "Unnamed company",
    website: row.website || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function opportunity(row: Record<string, string>): NormalizedOpportunity {
  return {
    externalId: externalId(row, "opportunity"),
    companyExternalId: row.companyExternalId || undefined,
    contactExternalId: row.contactExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    name: row.name || "Unnamed opportunity",
    pipeline: row.pipeline || undefined,
    stage: row.stage || undefined,
    valueMinor: asMinor(row.value),
    currency: row.currency || undefined,
    closeAt: asDate(row.closeAt),
    lastActivityAt: asDate(row.lastActivityAt),
    nextStepAt: asDate(row.nextStepAt),
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: row,
  };
}
function task(row: Record<string, string>): NormalizedTask {
  return {
    externalId: externalId(row, "task or Manual Action"),
    contactExternalId: row.contactExternalId || undefined,
    opportunityExternalId: row.opportunityExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    title: row.title || "Task",
    status: row.status || "open",
    dueAt: asDate(row.dueAt),
    completedAt: asDate(row.completedAt),
    sourceUpdatedAt: asDate(row.sourceUpdatedAt),
    sourceRevision: row.sourceRevision || row.sourceUpdatedAt,
    raw: { ...row, sourceKind: row.sourceKind || row.type || "task" },
  };
}
function activity(row: Record<string, string>): NormalizedActivity {
  return {
    externalId: externalId(row, "activity"),
    contactExternalId: row.contactExternalId || undefined,
    opportunityExternalId: row.opportunityExternalId || undefined,
    ownerExternalId: row.ownerExternalId || undefined,
    activityType: row.activityType || row.type || "activity",
    occurredAt: asDate(row.occurredAt) || new Date(),
    body: row.body || undefined,
    sourceRevision: row.sourceRevision || undefined,
    raw: row,
  };
}
export const normalizeBrowserContactRow = contact;
export const normalizeBrowserCompanyRow = company;
export const normalizeBrowserOpportunityRow = opportunity;
export const normalizeBrowserTaskRow = task;
export const normalizeBrowserActivityRow = activity;
async function messageOperation(
  operation: "sendEmail" | "sendSms" | "sendWhatsApp",
  input: OutboundMessageInput,
  provider: string
) {
  const execution = await runOperation({
    connection: input.connection,
    secret: input.secret,
    provider,
    operation,
    correlationId: input.correlationId,
    payload: {
      to: input.to,
      subject: input.subject || "",
      body: input.body,
      message: input.body,
      templateName: input.templateName || "",
      contactExternalId: input.contactExternalId || "",
      opportunityExternalId: input.opportunityExternalId || "",
    },
  });
  return evidence(operation, input.correlationId, execution.result);
}

export function browserCrmAdapter(
  provider: Extract<CrmProvider, "genie" | "custom_browser">
): CrmAdapter {
  const testConnection = async (input: {
    connection: AdapterConnection;
    secret?: ConnectionSecretPayload;
    correlationId: string;
  }): Promise<ConnectionTest> => {
    try {
      const profile = await resolveBrowserProfile(input.connection, provider);
      if (!profile)
        throw new Error(
          "No calibrated browser connector profile is configured."
        );
      const secret = await browserSecret(input.connection, input.secret);
      const authenticationRequired = browserAuthenticationRequired(
        provider,
        profile
      );
      const suppliedCredentials = resolveBrowserCredentials(secret, provider);
      if (
        authenticationRequired &&
        (!suppliedCredentials.username || !suppliedCredentials.password)
      ) {
        const sessionConfigured = Boolean(secret.browserSession);
        if (!sessionConfigured)
          throw new Error(
            "GENIE_CREDENTIALS_REQUIRED: Encrypted per-connection credentials are not available. Save the Genie username and password, then retry."
          );
      }
      let authenticatedUrl = "";
      await withPage(
        input.connection,
        secret,
        provider,
        profile,
        async page => {
          if (authenticationRequired) {
            authenticatedUrl = page.url();
            await authorizeNavigation(input.connection, authenticatedUrl);
          }
        }
      );
      const requested = Array.from(
        new Set([
          ...input.connection.allowedReadCapabilities,
          ...input.connection.allowedWriteCapabilities,
        ])
      );
      const matrix = await browserOperationReadinessForSystem({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
      });
      const readiness = new Map(
        matrix.capabilities.map(item => [item.capability, item])
      );
      const capabilities = requested
        .filter(
          (value): value is CrmCapability => value in CAPABILITY_OPERATIONS
        )
        .map(capability => {
          const result = readiness.get(capability);
          const available = result?.state === "FULL";
          return {
            capability,
            available,
            detail: available
              ? "Every required deterministic operation is LIVE_PROVEN."
              : result?.state === "LIMITED"
                ? `Limited: missing LIVE_PROVEN operations ${result.missingOperations.join(", ")}.`
                : "No complete LIVE_PROVEN operation set exists for this capability.",
          } satisfies CapabilityResult;
        });
      const available = capabilities.filter(item => item.available);
      return {
        status:
          available.length === capabilities.length && capabilities.length
            ? "ready"
            : "limited",
        summary: `${authenticationRequired ? "Browser authentication was confirmed" : "The credentialless browser runtime was confirmed"}. ${available.length} of ${capabilities.length} requested browser CRM capabilities have complete LIVE_PROVEN operation sets.`,
        capabilities,
        evidence: [
          {
            operation: "browser_connector_health",
            correlationId: input.correlationId,
            completedAt: new Date().toISOString(),
            providerResult: {
              cdpReachable: true,
              authorisedDestinationReachable: authenticationRequired
                ? true
                : undefined,
              perConnectionCredentialsAvailable: Boolean(
                secret.credentials?.username && secret.credentials?.password
              ),
              approvedSessionAvailable: Boolean(secret.browserSession),
              authenticationConfirmed: authenticationRequired,
              authenticatedHostname: authenticatedUrl
                ? new URL(authenticatedUrl).hostname
                : undefined,
              learnedOperationReadinessInspected: true,
              configuredOperations: Object.keys(
                profile.operationMap || profile.scripts
              ),
            },
          },
        ],
      };
    } catch (error) {
      return {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error),
        capabilities: [],
        evidence: [
          {
            operation: "browser_connector_health",
            correlationId: input.correlationId,
            completedAt: new Date().toISOString(),
            errorClassification: "authentication",
            retryable: false,
          },
        ],
      };
    }
  };
  const list = async <T>(
    operation: string,
    mapper: (row: Record<string, string>) => T,
    input: {
      connection: AdapterConnection;
      secret: ConnectionSecretPayload;
      cursor?: string;
    }
  ) => {
    const execution = await runOperation({
      connection: input.connection,
      secret: input.secret,
      provider,
      operation,
      correlationId: `sync-${operation}`,
      payload: { cursor: input.cursor || "" },
    });
    return {
      records: rows(execution.result, execution.profile, operation).map(mapper),
      cursor: execution.result.data.nextCursor || undefined,
    };
  };
  return {
    provider,
    disconnect: async input => ({
      operation: "disconnect",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: { localBrowserCredentialsCanBeRemoved: true },
    }),
    refreshAuthentication: async input => input.secret,
    testConnection,
    discoverCapabilities: async input =>
      (await testConnection(input)).capabilities,
    syncContacts: input => list("syncContacts", contact, input),
    syncCompanies: input => list("syncCompanies", company, input),
    syncOpportunities: input => list("syncOpportunities", opportunity, input),
    syncTasks: input => list("syncTasks", task, input),
    syncActivities: input => list("syncActivities", activity, input),
    searchContacts: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "searchContacts",
        correlationId: "search-contacts",
        payload: { query: input.query, leadLabel: input.query },
      });
      const extracted = rows(
        execution.result,
        execution.profile,
        "searchContacts"
      );
      if (extracted.length) return extracted.map(contact);
      return [
        {
          externalId: input.query,
          firstName: input.query,
          raw: {
            browserText: Object.values(execution.result.data)
              .join("\n")
              .slice(0, 20_000),
          },
        },
      ];
    },
    getContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getContact",
        correlationId: "get-contact",
        payload: { externalId: input.externalId, leadLabel: input.externalId },
      });
      const extracted = rows(execution.result, execution.profile, "getContact");
      return extracted[0]
        ? contact(extracted[0])
        : {
            externalId: input.externalId,
            raw: {
              browserText: Object.values(execution.result.data)
                .join("\n")
                .slice(0, 20_000),
            },
          };
    },
    getCompany: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getCompany",
        correlationId: "get-company",
        payload: { externalId: input.externalId },
      });
      const extracted = rows(execution.result, execution.profile, "getCompany");
      return extracted[0] ? company(extracted[0]) : null;
    },
    getOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "getOpportunity",
        correlationId: "get-opportunity",
        payload: { externalId: input.externalId },
      });
      const extracted = rows(
        execution.result,
        execution.profile,
        "getOpportunity"
      );
      return extracted[0] ? opportunity(extracted[0]) : null;
    },
    createContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createContact",
        payload: input.fields,
      });
      return evidence("create_contact", input.correlationId, execution.result);
    },
    createCompany: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createCompany",
        payload: input.fields,
      });
      return evidence("create_company", input.correlationId, execution.result);
    },
    createOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createOpportunity",
        payload: input.fields,
      });
      return evidence(
        "create_opportunity",
        input.correlationId,
        execution.result
      );
    },
    createNote: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createNote",
        payload: {
          externalId: input.externalId,
          content: input.body,
          body: input.body,
          note: input.body,
        },
      });
      return evidence("create_note", input.correlationId, execution.result);
    },
    createTask: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createTask",
        payload: {
          title: input.title,
          taskTitle: input.title,
          dueAt: input.dueAt || "",
          contactExternalId: input.contactExternalId || "",
          opportunityExternalId: input.opportunityExternalId || "",
        },
      });
      return evidence("create_task", input.correlationId, execution.result);
    },
    completeTask: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "completeTask",
        payload: {
          externalId: input.externalId,
          taskExternalId: input.externalId,
        },
      });
      return evidence("complete_task", input.correlationId, execution.result);
    },
    updateContact: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "updateContact",
        payload: { externalId: input.externalId, ...input.patch },
      });
      return evidence("update_contact", input.correlationId, execution.result);
    },
    updateOpportunity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "updateOpportunity",
        payload: { externalId: input.externalId, ...input.patch },
      });
      return evidence(
        "update_opportunity",
        input.correlationId,
        execution.result
      );
    },
    createActivity: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "createActivity",
        payload: input.activity,
      });
      return evidence("create_activity", input.correlationId, execution.result);
    },
    sendEmail: input => messageOperation("sendEmail", input, provider),
    sendSms: input => messageOperation("sendSms", input, provider),
    sendWhatsApp: input => messageOperation("sendWhatsApp", input, provider),
    applySequence: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "applySequence",
        payload: { externalId: input.externalId, sequence: input.sequence },
      });
      return evidence("apply_sequence", input.correlationId, execution.result);
    },
    executeCustomAction: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: input.actionName,
        payload: input.payload,
      });
      return evidence(input.actionName, input.correlationId, execution.result);
    },
    listPipelines: async input => {
      const execution = await runOperation({
        ...input,
        provider,
        operation: "listPipelines",
        correlationId: "list-pipelines",
        payload: {},
      });
      return rows(execution.result, execution.profile, "listPipelines").map(
        row => ({
          externalId: row.externalId || row.id,
          label: row.label || row.name || "Pipeline",
          stages: [],
        })
      );
    },
    healthCheck: testConnection,
  };
}
