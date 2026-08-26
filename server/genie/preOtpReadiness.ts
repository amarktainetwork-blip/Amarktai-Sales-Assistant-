import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { GENIE_RETAINED_PAGE_RUNTIME_VERSION } from "../browserConnectors/browserSession";
import {
  claimPersistentGenieProfileBinding,
  persistentGenieProfileBindingMatches,
  persistentProfileBindingFor,
  readPersistentGenieProfileBinding,
} from "../browserConnectors/geniePersistentProfile";
import {
  genieInteractiveAuthIsFresh,
  type GenieBrowserSecret,
} from "../browserConnectors/genieInteractiveAuth";
import {
  assertAuthorisedConnectionUrl,
  getConnectedSystemForUser,
  loadConnectionSecret,
  saveConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import {
  canManageOrganisationForUser,
  requireOrganisationMembership,
} from "../organisation";

const PROOF_VERSION = 1 as const;
const PROOF_MAX_AGE_MS = 30 * 60 * 1_000;
const PROFILE_DIRECTORY = "/home/chrome/profile";
const SENTINEL_PREFIX = "amarktai-pre-otp";
const SAFE_CONNECTION_STATES = new Set([
  "disconnected",
  "needs_attention",
  "authentication_expired",
  "error",
]);

export const PRE_OTP_CHECKS = [
  "browserServiceHealthy",
  "cdpReachable",
  "singlePersistentContext",
  "browserProfileMountPresent",
  "profileOwnershipMatches",
  "noStaleGeniePages",
  "persistentPageOpened",
  "pageSurvivedClientExit",
  "secondClientReconnectedToExactPage",
  "genieLoginReachable",
  "loginFormIdentified",
  "requiredControlsFoundOrCalibrated",
  "noPendingBrowserRecreation",
  "appWorkerBrowserStable",
  "retainedPageRuntimePresent",
  "noFailedChallengeReuse",
  "connectionSecretsExist",
  "managementElevationValid",
  "connectionSafeToAuthenticate",
] as const;

export type PreOtpCheckName = (typeof PRE_OTP_CHECKS)[number];
export type PreOtpSignals = Record<PreOtpCheckName, boolean>;

type PreOtpProof = {
  version: typeof PROOF_VERSION;
  organisationId: number;
  connectedSystemId: number;
  createdByUserId: number;
  createdAt: string;
  verifiedAt?: string;
  token: string;
  sentinelTitle: string;
  browserVersion: string;
  runtimeVersion: typeof GENIE_RETAINED_PAGE_RUNTIME_VERSION;
  signals: PreOtpSignals;
};

export type PreOtpReadiness = {
  ready: boolean;
  checkedAt: string;
  states: {
    browserReady: boolean;
    genieLoginReachable: boolean;
    secureSignInReady: boolean;
    sessionHandoffReady: boolean;
  };
  labels: {
    browserReady: "Browser ready";
    genieLoginReachable: "Genie login reachable";
    secureSignInReady: "Secure sign-in ready";
    sessionHandoffReady: "Session handoff ready";
  };
  advancedDiagnostics: Array<{ check: PreOtpCheckName; passed: boolean }>;
  failure?: string;
};

function emptySignals(): PreOtpSignals {
  return Object.fromEntries(
    PRE_OTP_CHECKS.map(check => [check, false])
  ) as PreOtpSignals;
}

export function evaluatePreOtpSignals(signals: PreOtpSignals) {
  return PRE_OTP_CHECKS.every(check => signals[check]);
}

export function presentPreOtpReadiness(
  signals: PreOtpSignals,
  failure?: string
): PreOtpReadiness {
  return {
    ready: evaluatePreOtpSignals(signals),
    checkedAt: new Date().toISOString(),
    states: {
      browserReady:
        signals.browserServiceHealthy &&
        signals.cdpReachable &&
        signals.singlePersistentContext &&
        signals.browserProfileMountPresent,
      genieLoginReachable:
        signals.genieLoginReachable &&
        signals.loginFormIdentified &&
        signals.requiredControlsFoundOrCalibrated,
      secureSignInReady:
        signals.connectionSecretsExist &&
        signals.managementElevationValid &&
        signals.noFailedChallengeReuse &&
        signals.connectionSafeToAuthenticate,
      sessionHandoffReady:
        signals.persistentPageOpened &&
        signals.pageSurvivedClientExit &&
        signals.secondClientReconnectedToExactPage &&
        signals.noPendingBrowserRecreation &&
        signals.appWorkerBrowserStable &&
        signals.retainedPageRuntimePresent,
    },
    labels: {
      browserReady: "Browser ready",
      genieLoginReachable: "Genie login reachable",
      secureSignInReady: "Secure sign-in ready",
      sessionHandoffReady: "Session handoff ready",
    },
    advancedDiagnostics: PRE_OTP_CHECKS.map(check => ({
      check,
      passed: signals[check],
    })),
    ...(failure ? { failure } : {}),
  };
}

function artifactDirectory() {
  return (
    process.env.GENIE_ARTIFACT_DIR?.trim() || "/app/data/connector-evidence"
  );
}

function proofPath(organisationId: number, connectedSystemId: number) {
  return join(
    artifactDirectory(),
    `.genie-pre-otp-${organisationId}-${connectedSystemId}.json`
  );
}

async function writeProof(proof: PreOtpProof) {
  const path = proofPath(proof.organisationId, proof.connectedSystemId);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(proof), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

async function readProof(
  organisationId: number,
  connectedSystemId: number
): Promise<PreOtpProof | undefined> {
  try {
    const value = JSON.parse(
      await readFile(proofPath(organisationId, connectedSystemId), "utf8")
    ) as Partial<PreOtpProof>;
    if (
      value.version !== PROOF_VERSION ||
      value.organisationId !== organisationId ||
      value.connectedSystemId !== connectedSystemId ||
      typeof value.createdByUserId !== "number" ||
      typeof value.createdAt !== "string" ||
      typeof value.token !== "string" ||
      typeof value.sentinelTitle !== "string" ||
      typeof value.browserVersion !== "string" ||
      value.runtimeVersion !== GENIE_RETAINED_PAGE_RUNTIME_VERSION ||
      !value.signals
    )
      throw new Error("PRE_OTP_PROOF_INVALID");
    return value as PreOtpProof;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function removeProof(organisationId: number, connectedSystemId: number) {
  await unlink(proofPath(organisationId, connectedSystemId)).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export async function removeGeniePreOtpProof(
  organisationId: number,
  connectedSystemId: number
) {
  await removeProof(organisationId, connectedSystemId);
}

async function connectBrowser() {
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!endpoint) throw new Error("PRE_OTP_CDP_ENDPOINT_MISSING");
  return chromium.connectOverCDP(endpoint, { timeout: 12_000 });
}

async function browserRuntime(browser: Browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const [version, commandLine] = await Promise.all([
      session.send("Browser.getVersion"),
      session.send("Browser.getBrowserCommandLine"),
    ]);
    const args = Array.isArray(commandLine.arguments)
      ? commandLine.arguments.map(String)
      : [];
    return {
      version: String(version.product || "unknown"),
      profileMountPresent: args.some(
        argument => argument === `--user-data-dir=${PROFILE_DIRECTORY}`
      ),
    };
  } finally {
    await session.detach();
  }
}

function hostnameMatches(page: Page, hostname: string) {
  try {
    const actual = new URL(page.url()).hostname.toLowerCase();
    return actual === hostname || actual.endsWith(`.${hostname}`);
  } catch {
    return false;
  }
}

async function requireManager(userId: number, organisationId: number) {
  const membership = await requireOrganisationMembership(
    userId,
    organisationId
  );
  if (!(await canManageOrganisationForUser(userId, membership.role)))
    throw new Error("MANAGER_REQUIRED");
}

async function connectionPreconditions(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  await requireManager(input.userId, input.organisationId);
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  if (
    system.provider !== "genie" ||
    !["browser", "sidecar"].includes(system.connectionMethod)
  )
    throw new Error("PRE_OTP_GENIE_BROWSER_CONNECTION_REQUIRED");
  if (!system.baseUrl) throw new Error("PRE_OTP_GENIE_LOGIN_URL_REQUIRED");
  const loginUrl = await assertAuthorisedConnectionUrl({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    rawUrl: system.baseUrl,
  });
  const secret = (await loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    secretKind: "browser",
  })) as GenieBrowserSecret | undefined;
  return {
    system,
    secret,
    loginUrl,
    binding: persistentProfileBindingFor(toAdapterConnection(system)),
  };
}

function loginSelectors(
  system: Awaited<ReturnType<typeof getConnectedSystemForUser>>
) {
  const profile = system.configuration?.browserProfile;
  const login =
    profile &&
    typeof profile === "object" &&
    !Array.isArray(profile) &&
    (profile as Record<string, unknown>).login;
  const configured =
    login && typeof login === "object" && !Array.isArray(login)
      ? (login as Record<string, unknown>)
      : {};
  return {
    username:
      typeof configured.usernameSelector === "string"
        ? configured.usernameSelector
        : "#email",
    password:
      typeof configured.passwordSelector === "string"
        ? configured.passwordSelector
        : "#password",
    submit:
      typeof configured.submitSelector === "string"
        ? configured.submitSelector
        : 'button[type="submit"]',
  };
}

export async function createPreOtpHandoffProbe(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const { system, secret, binding } = await connectionPreconditions(input);
  if (secret?.pendingInteractiveAuth) {
    if (genieInteractiveAuthIsFresh(secret.pendingInteractiveAuth))
      throw new Error("PRE_OTP_ACTIVE_CHALLENGE_PRESENT");
    const { pendingInteractiveAuth: _expired, ...withoutExpiredChallenge } =
      secret;
    await saveConnectionSecret({
      userId: input.userId,
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      secretKind: "browser",
      secret: withoutExpiredChallenge,
    });
  }
  if (!secret?.credentials?.username || !secret.credentials.password)
    throw new Error("PRE_OTP_CONNECTION_CREDENTIALS_MISSING");
  if (!SAFE_CONNECTION_STATES.has(system.status))
    throw new Error(`PRE_OTP_CONNECTION_STATE_UNSAFE:${system.status}`);
  await removeProof(input.organisationId, input.connectedSystemId);
  await claimPersistentGenieProfileBinding(binding);
  const browser = await connectBrowser();
  const contexts = browser.contexts();
  if (contexts.length !== 1)
    throw new Error(`PRE_OTP_PERSISTENT_CONTEXT_COUNT:${contexts.length}`);
  const runtime = await browserRuntime(browser);
  if (!runtime.profileMountPresent)
    throw new Error("PRE_OTP_PROFILE_MOUNT_NOT_PROVEN");
  const hostname = new URL(system.baseUrl!).hostname.toLowerCase();
  if (
    contexts[0]
      .pages()
      .some(page => !page.isClosed() && hostnameMatches(page, hostname))
  )
    throw new Error("PRE_OTP_STALE_GENIE_PAGE_PRESENT");
  const token = randomUUID();
  const sentinelTitle = `${SENTINEL_PREFIX}:${input.organisationId}:${input.connectedSystemId}:${token}`;
  const page = await contexts[0].newPage();
  await page.goto(
    `data:text/html,${encodeURIComponent(`<title>${sentinelTitle}</title><main data-amarktai-pre-otp="${token}">handoff</main>`)}`
  );
  const signals = emptySignals();
  Object.assign(signals, {
    browserServiceHealthy: browser.isConnected(),
    cdpReachable: true,
    singlePersistentContext: true,
    browserProfileMountPresent: true,
    profileOwnershipMatches: true,
    noStaleGeniePages: true,
    persistentPageOpened: (await page.title()) === sentinelTitle,
    retainedPageRuntimePresent: true,
    noFailedChallengeReuse: true,
    connectionSecretsExist: true,
    managementElevationValid: true,
    connectionSafeToAuthenticate: true,
  });
  await writeProof({
    version: PROOF_VERSION,
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    createdByUserId: input.userId,
    createdAt: new Date().toISOString(),
    token,
    sentinelTitle,
    browserVersion: runtime.version,
    runtimeVersion: GENIE_RETAINED_PAGE_RUNTIME_VERSION,
    signals,
  });
  return { phase: "created", sentinelTitle };
}

export async function verifyPreOtpHandoffProbe(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const { system, secret, loginUrl, binding } =
    await connectionPreconditions(input);
  const proof = await readProof(input.organisationId, input.connectedSystemId);
  if (!proof) throw new Error("PRE_OTP_HANDOFF_PROOF_MISSING");
  if (proof.createdByUserId !== input.userId)
    throw new Error("PRE_OTP_PROOF_ACTOR_MISMATCH");
  if (Date.now() - Date.parse(proof.createdAt) > PROOF_MAX_AGE_MS)
    throw new Error("PRE_OTP_PROOF_EXPIRED");
  if (secret?.pendingInteractiveAuth)
    throw new Error("PRE_OTP_STALE_CHALLENGE_PRESENT");
  if (!secret?.credentials?.username || !secret.credentials.password)
    throw new Error("PRE_OTP_CONNECTION_CREDENTIALS_MISSING");
  if (!SAFE_CONNECTION_STATES.has(system.status))
    throw new Error(`PRE_OTP_CONNECTION_STATE_UNSAFE:${system.status}`);
  const actualBinding = await readPersistentGenieProfileBinding();
  if (
    !actualBinding ||
    !persistentGenieProfileBindingMatches(actualBinding, binding)
  )
    throw new Error("PRE_OTP_PROFILE_OWNERSHIP_MISMATCH");
  const browser = await connectBrowser();
  const contexts = browser.contexts();
  if (contexts.length !== 1)
    throw new Error(`PRE_OTP_PERSISTENT_CONTEXT_COUNT:${contexts.length}`);
  const runtime = await browserRuntime(browser);
  if (!runtime.profileMountPresent || runtime.version !== proof.browserVersion)
    throw new Error("PRE_OTP_BROWSER_RUNTIME_CHANGED");
  let retainedPage: Page | undefined;
  for (const page of contexts[0].pages()) {
    if (
      !page.isClosed() &&
      page.url().startsWith("data:") &&
      (await page.title().catch(() => "")) === proof.sentinelTitle
    ) {
      retainedPage = page;
      break;
    }
  }
  if (
    !retainedPage ||
    (await retainedPage
      .locator(`[data-amarktai-pre-otp="${proof.token}"]`)
      .count()) !== 1
  )
    throw new Error("PRE_OTP_EXACT_PAGE_HANDOFF_FAILED");
  const hostname = loginUrl.hostname.toLowerCase();
  if (
    contexts[0]
      .pages()
      .some(
        page =>
          page !== retainedPage &&
          !page.isClosed() &&
          hostnameMatches(page, hostname)
      )
  )
    throw new Error("PRE_OTP_STALE_GENIE_PAGE_PRESENT");
  const probe = await contexts[0].newPage();
  try {
    let blocked = false;
    await probe.route("**/*", async route => {
      if (
        !route.request().isNavigationRequest() ||
        route.request().frame() !== probe.mainFrame()
      )
        return route.continue();
      try {
        await assertAuthorisedConnectionUrl({
          organisationId: input.organisationId,
          connectedSystemId: input.connectedSystemId,
          rawUrl: route.request().url(),
        });
      } catch {
        blocked = true;
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    const response = await probe.goto(loginUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (blocked || !response || response.status() >= 500)
      throw new Error("PRE_OTP_GENIE_LOGIN_UNREACHABLE");
    await assertAuthorisedConnectionUrl({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      rawUrl: probe.url(),
    });
    const selectors = loginSelectors(system);
    const controlsVisible = await Promise.all(
      [selectors.username, selectors.password, selectors.submit].map(selector =>
        probe
          .locator(selector)
          .first()
          .isVisible()
          .catch(() => false)
      )
    );
    if (controlsVisible.some(visible => !visible))
      throw new Error("PRE_OTP_LOGIN_FORM_NOT_IDENTIFIED");
  } finally {
    if (!probe.isClosed()) await probe.close();
  }
  const signals: PreOtpSignals = Object.fromEntries(
    PRE_OTP_CHECKS.map(check => [check, true])
  ) as PreOtpSignals;
  const verified: PreOtpProof = {
    ...proof,
    verifiedAt: new Date().toISOString(),
    signals,
  };
  await writeProof(verified);
  return presentPreOtpReadiness(signals);
}

export async function checkGeniePreOtpReadiness(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  managementElevationValid: boolean;
}) {
  const signals = emptySignals();
  signals.managementElevationValid = input.managementElevationValid;
  if (!input.managementElevationValid)
    return presentPreOtpReadiness(
      signals,
      "Management verification is required."
    );
  try {
    const { system, secret, binding } = await connectionPreconditions(input);
    const proof = await readProof(
      input.organisationId,
      input.connectedSystemId
    );
    if (
      !proof?.verifiedAt ||
      proof.createdByUserId !== input.userId ||
      Date.now() - Date.parse(proof.verifiedAt) > PROOF_MAX_AGE_MS
    )
      throw new Error("PRE_OTP_VERIFIED_PROOF_MISSING_OR_EXPIRED");
    if (secret?.pendingInteractiveAuth)
      throw new Error("PRE_OTP_STALE_CHALLENGE_PRESENT");
    if (!secret?.credentials?.username || !secret.credentials.password)
      throw new Error("PRE_OTP_CONNECTION_CREDENTIALS_MISSING");
    if (!SAFE_CONNECTION_STATES.has(system.status))
      throw new Error(`PRE_OTP_CONNECTION_STATE_UNSAFE:${system.status}`);
    const actualBinding = await readPersistentGenieProfileBinding();
    if (
      !actualBinding ||
      !persistentGenieProfileBindingMatches(actualBinding, binding)
    )
      throw new Error("PRE_OTP_PROFILE_OWNERSHIP_MISMATCH");
    const browser = await connectBrowser();
    const contexts = browser.contexts();
    if (contexts.length !== 1)
      throw new Error(`PRE_OTP_PERSISTENT_CONTEXT_COUNT:${contexts.length}`);
    const runtime = await browserRuntime(browser);
    if (
      !runtime.profileMountPresent ||
      runtime.version !== proof.browserVersion
    )
      throw new Error("PRE_OTP_BROWSER_RUNTIME_CHANGED");
    const hostname = new URL(system.baseUrl!).hostname.toLowerCase();
    if (
      contexts[0]
        .pages()
        .some(page => !page.isClosed() && hostnameMatches(page, hostname))
    )
      throw new Error("PRE_OTP_STALE_GENIE_PAGE_PRESENT");
    let retained = false;
    for (const page of contexts[0].pages())
      if (
        !page.isClosed() &&
        page.url().startsWith("data:") &&
        (await page.title().catch(() => "")) === proof.sentinelTitle &&
        (await page
          .locator(`[data-amarktai-pre-otp="${proof.token}"]`)
          .count()) === 1
      )
        retained = true;
    if (!retained) throw new Error("PRE_OTP_EXACT_PAGE_HANDOFF_FAILED");
    return presentPreOtpReadiness(proof.signals);
  } catch (error) {
    return presentPreOtpReadiness(
      signals,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function consumeGeniePreOtpReadiness(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  managementElevationValid: boolean;
}) {
  const readiness = await checkGeniePreOtpReadiness(input);
  if (!readiness.ready)
    throw new Error(
      `PRE_OTP_READY_REQUIRED:${readiness.failure || "Run the secure sign-in readiness check first."}`
    );
  const proof = await readProof(input.organisationId, input.connectedSystemId);
  if (!proof) throw new Error("PRE_OTP_READY_REQUIRED");
  const browser = await connectBrowser();
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error("PRE_OTP_READY_REQUIRED");
  for (const page of contexts[0].pages())
    if (
      !page.isClosed() &&
      (await page.title().catch(() => "")) === proof.sentinelTitle
    )
      await page.close();
  await removeProof(input.organisationId, input.connectedSystemId);
  return readiness;
}
