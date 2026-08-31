import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type { AdapterConnection, CrmProvider } from "../crm/types";
import {
  assertAuthorisedConnectionUrl,
  loadConnectionSecret,
  saveConnectionSecret,
} from "../connectedSystems";
import { getDb, recordAudit } from "../db";
import { connectedSystems } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  isBrowserSessionPackage,
} from "./browserSession";
import { crmBrowserPreset, type CrmBrowserPreset } from "./crmBrowserPresets";

export type CrmBrowserAuthenticationState =
  | "STARTING"
  | "LOGIN_REQUIRED"
  | "USER_AUTHENTICATING"
  | "MFA_OR_SSO"
  | "CHECKING"
  | "AUTHENTICATED"
  | "REAUTHENTICATION_REQUIRED"
  | "ERROR";

export type CrmBrowserSessionSnapshot = {
  organisationId: number;
  connectedSystemId: number;
  provider: CrmProvider;
  currentUrl: string;
  authenticationState: CrmBrowserAuthenticationState;
  connectionHealth:
    | "connecting"
    | "healthy"
    | "needs_attention"
    | "disconnected";
  blockedDestination?: string;
  lastInteractionAt: string;
  errorMessage?: string;
};

export type BrowserAuthenticationEvidence = {
  authorisedUrl: boolean;
  loginVisible: boolean;
  verificationVisible: boolean;
  strongAuthenticatedMarker: boolean;
  meaningfulApplicationStructure: boolean;
  stablePage: boolean;
  safeReadInspectionPassed: boolean;
  customerConfirmed: boolean;
  knownProvider: boolean;
};

export function authenticationStateFromEvidence(
  evidence: BrowserAuthenticationEvidence
): CrmBrowserAuthenticationState {
  if (!evidence.authorisedUrl) return "ERROR";
  if (evidence.verificationVisible) return "MFA_OR_SSO";
  if (evidence.loginVisible) return "LOGIN_REQUIRED";
  const commonProof =
    evidence.meaningfulApplicationStructure &&
    evidence.stablePage &&
    evidence.safeReadInspectionPassed;
  if (
    commonProof &&
    (evidence.strongAuthenticatedMarker || evidence.customerConfirmed)
  )
    return "AUTHENTICATED";
  return evidence.customerConfirmed ? "CHECKING" : "USER_AUTHENTICATING";
}

export function resolvedAuthenticationState(
  evidence: BrowserAuthenticationEvidence,
  restoredSession: boolean
): CrmBrowserAuthenticationState {
  const observed = authenticationStateFromEvidence(evidence);
  return observed === "LOGIN_REQUIRED" && restoredSession
    ? "REAUTHENTICATION_REQUIRED"
    : observed;
}

type ManagedCrmBrowserSession = {
  key: string;
  connection: AdapterConnection;
  openedByUserId: number;
  preset: CrmBrowserPreset;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startUrl: string;
  snapshot: CrmBrowserSessionSnapshot;
  listeners: Set<(snapshot: CrmBrowserSessionSnapshot) => void>;
  customerConfirmed: boolean;
  authenticatedPersisted: boolean;
  restoredSession: boolean;
  reauthenticationRecorded?: boolean;
  evaluating?: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const activeSessions = new Map<string, ManagedCrmBrowserSession>();
const browserPool = new Map<string, Promise<Browser>>();
const IDLE_TIMEOUT_MS = 30 * 60_000;

function sessionKey(organisationId: number, connectedSystemId: number) {
  return `${organisationId}:${connectedSystemId}`;
}

function publicMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/AUTH.*HOST|outside.*authorised|PATH_BLOCKED|not approved/i.test(detail))
    return "This CRM redirected to a new sign-in service. A manager needs to approve it.";
  if (/timeout|closed|disconnected|cdp|browser/i.test(detail))
    return "We lost the browser connection. Reopen your CRM.";
  return "The CRM browser needs attention. Reopen it and try again.";
}

function emit(
  session: ManagedCrmBrowserSession,
  patch?: Partial<CrmBrowserSessionSnapshot>
) {
  session.snapshot = {
    ...session.snapshot,
    ...patch,
    lastInteractionAt: new Date().toISOString(),
  };
  session.listeners.forEach(listener => listener({ ...session.snapshot }));
}

export async function connectManagedCrmBrowser(endpoint: string) {
  let pending = browserPool.get(endpoint);
  if (!pending) {
    pending = chromium
      .connectOverCDP(endpoint)
      .then(browser => {
        browser.once("disconnected", () => browserPool.delete(endpoint));
        return browser;
      })
      .catch(error => {
        browserPool.delete(endpoint);
        throw error;
      });
    browserPool.set(endpoint, pending);
  }
  const browser = await pending;
  if (!browser.isConnected()) {
    browserPool.delete(endpoint);
    return connectManagedCrmBrowser(endpoint);
  }
  return browser;
}

function endpointFor(connection: AdapterConnection) {
  const profile = connection.configuration.browserProfile;
  const configured =
    profile && typeof profile === "object" && !Array.isArray(profile)
      ? (profile as Record<string, unknown>).browserEndpoint
      : undefined;
  const endpoint =
    typeof configured === "string"
      ? configured
      : process.env.BROWSERLESS_WS_ENDPOINT;
  if (!endpoint) throw new Error("CRM_BROWSER_UNAVAILABLE");
  return endpoint;
}

async function visible(page: Page, selectors: string[]) {
  for (const selector of selectors)
    if (
      await page
        .locator(selector)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;
  return false;
}

async function inspectAuthentication(
  session: ManagedCrmBrowserSession
): Promise<BrowserAuthenticationEvidence> {
  const before = session.page.url();
  const authorisedUrl = await assertAuthorisedConnectionUrl({
    organisationId: session.connection.organisationId,
    connectedSystemId: session.connection.id,
    rawUrl: before,
  })
    .then(() => true)
    .catch(() => false);
  const [
    loginVisible,
    verificationVisible,
    strongAuthenticatedMarker,
    structureCount,
  ] = await Promise.all([
    visible(session.page, session.preset.loginHints),
    visible(session.page, session.preset.mfaHints),
    visible(session.page, session.preset.authenticatedHints),
    session.page
      .locator(
        'main, nav, [role="main"], [role="navigation"], aside, a[href], button'
      )
      .count()
      .catch(() => 0),
  ]);
  await session.page.waitForTimeout(350).catch(() => undefined);
  const stablePage = before === session.page.url() && !session.page.isClosed();
  return {
    authorisedUrl,
    loginVisible,
    verificationVisible,
    strongAuthenticatedMarker,
    meaningfulApplicationStructure: structureCount >= 4,
    stablePage,
    safeReadInspectionPassed: authorisedUrl && structureCount >= 4,
    customerConfirmed: session.customerConfirmed,
    knownProvider: session.connection.provider !== "custom_browser",
  };
}

async function persistAuthenticatedSession(
  session: ManagedCrmBrowserSession,
  force = false
) {
  if (session.authenticatedPersisted && !force) return;
  session.authenticatedPersisted = true;
  try {
    const browserSession = await captureBrowserSessionPackage({
      context: session.context,
      organisationId: session.connection.organisationId,
      connectedSystemId: session.connection.id,
      authenticatedUrl: session.page.url(),
      authorise: rawUrl =>
        assertAuthorisedConnectionUrl({
          organisationId: session.connection.organisationId,
          connectedSystemId: session.connection.id,
          rawUrl,
        }).then(() => undefined),
    });
    const existing =
      (await loadConnectionSecret({
        organisationId: session.connection.organisationId,
        connectedSystemId: session.connection.id,
        secretKind: "browser",
      })) || {};
    await saveConnectionSecret({
      userId: session.openedByUserId,
      organisationId: session.connection.organisationId,
      connectedSystemId: session.connection.id,
      secretKind: "browser",
      // Preserve deprecated material for an operator-led migration, but runtime
      // code never reads credentials, MFA values, or the legacy session package.
      secret: { ...existing, browserSession },
    });
    const db = await getDb();
    if (db)
      await db
        .update(connectedSystems)
        .set({
          status: "testing",
          lastHealthSummary:
            "Secure CRM session ready. Discovering available functions.",
        })
        .where(
          and(
            eq(connectedSystems.id, session.connection.id),
            eq(
              connectedSystems.organisationId,
              session.connection.organisationId
            )
          )
        );
    await recordAudit({
      userId: session.openedByUserId,
      organisationId: session.connection.organisationId,
      eventType: "crm_session_authenticated",
      entityType: "connected_system",
      entityId: String(session.connection.id),
      summary: "A customer authenticated directly in the Secure CRM Browser.",
      metadata: {
        provider: session.connection.provider,
        credentialsObserved: false,
      },
    });
    const { startAutomaticCommissioning } = await import(
      "../crm/automaticCommissioning"
    );
    await startAutomaticCommissioning({
      userId: session.openedByUserId,
      organisationId: session.connection.organisationId,
      connectedSystemId: session.connection.id,
    });
  } catch (error) {
    session.authenticatedPersisted = false;
    emit(session, {
      authenticationState: "ERROR",
      connectionHealth: "needs_attention",
      errorMessage: publicMessage(error),
    });
  }
}

async function evaluate(session: ManagedCrmBrowserSession) {
  if (session.evaluating) return session.evaluating;
  session.evaluating = (async () => {
    try {
      emit(session, { authenticationState: "CHECKING" });
      const state = resolvedAuthenticationState(
        await inspectAuthentication(session),
        session.restoredSession
      );
      emit(session, {
        authenticationState: state,
        connectionHealth: state === "AUTHENTICATED" ? "healthy" : "connecting",
        errorMessage: undefined,
      });
      if (
        ["LOGIN_REQUIRED", "MFA_OR_SSO", "REAUTHENTICATION_REQUIRED"].includes(
          state
        )
      )
        session.authenticatedPersisted = false;
      if (
        state === "REAUTHENTICATION_REQUIRED" &&
        !session.reauthenticationRecorded
      ) {
        session.reauthenticationRecorded = true;
        const db = await getDb();
        if (db)
          await db
            .update(connectedSystems)
            .set({
              status: "authentication_expired",
              lastHealthSummary: "Your CRM needs you to sign in again.",
            })
            .where(
              and(
                eq(connectedSystems.id, session.connection.id),
                eq(
                  connectedSystems.organisationId,
                  session.connection.organisationId
                )
              )
            );
        await recordAudit({
          userId: session.openedByUserId,
          organisationId: session.connection.organisationId,
          eventType: "crm_reauthentication_required",
          entityType: "connected_system",
          entityId: String(session.connection.id),
          summary: "The CRM session expired and requires human sign-in.",
          metadata: {},
        });
      }
      if (state === "AUTHENTICATED") await persistAuthenticatedSession(session);
    } catch (error) {
      emit(session, {
        authenticationState: "ERROR",
        connectionHealth: "needs_attention",
        errorMessage: publicMessage(error),
      });
    }
  })().finally(() => {
    session.evaluating = undefined;
  });
  return session.evaluating;
}

function installPageGovernance(session: ManagedCrmBrowserSession, page: Page) {
  void page.route("**/*", async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame())
      return route.continue();
    try {
      await assertAuthorisedConnectionUrl({
        organisationId: session.connection.organisationId,
        connectedSystemId: session.connection.id,
        rawUrl: request.url(),
      });
      return route.continue();
    } catch {
      let hostname = "new sign-in service";
      try {
        hostname = new URL(request.url()).hostname;
      } catch {
        /* safe label */
      }
      emit(session, {
        blockedDestination: hostname,
        connectionHealth: "needs_attention",
        errorMessage:
          "This CRM redirected to a new sign-in service. A manager needs to approve it.",
      });
      return route.abort("blockedbyclient");
    }
  });
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) {
      emit(session, { currentUrl: frame.url(), blockedDestination: undefined });
      void evaluate(session);
    }
  });
  page.on("domcontentloaded", () => void evaluate(session));
  page.once("close", () => {
    if (session.page !== page) return;
    emit(session, {
      connectionHealth: "disconnected",
      errorMessage: "We lost the browser connection. Reopen your CRM.",
    });
  });
}

function armIdle(session: ManagedCrmBrowserSession) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(
    () =>
      void managedCrmBrowserSessionManager.teardown(
        session.connection.organisationId,
        session.connection.id
      ),
    IDLE_TIMEOUT_MS
  );
}

export const managedCrmBrowserSessionManager = {
  async open(input: { connection: AdapterConnection; userId: number }) {
    const key = sessionKey(
      input.connection.organisationId,
      input.connection.id
    );
    const existing = activeSessions.get(key);
    if (
      existing &&
      !existing.page.isClosed() &&
      existing.browser.isConnected()
    ) {
      existing.openedByUserId = input.userId;
      armIdle(existing);
      return existing;
    }
    const preset = crmBrowserPreset(input.connection.provider);
    const startUrl = input.connection.baseUrl || preset.defaultStartUrl;
    if (!startUrl) throw new Error("CRM_START_URL_REQUIRED");
    await assertAuthorisedConnectionUrl({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      rawUrl: startUrl,
    });
    const secret =
      (await loadConnectionSecret({
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        secretKind: "browser",
      })) || {};
    const restored = isBrowserSessionPackage(secret.browserSession)
      ? secret.browserSession
      : undefined;
    const browser = await connectManagedCrmBrowser(
      endpointFor(input.connection)
    );
    const context = await createContextWithBrowserSession({
      browser,
      browserSession: restored,
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
    });
    const page = await context.newPage();
    const session: ManagedCrmBrowserSession = {
      key,
      connection: input.connection,
      openedByUserId: input.userId,
      preset,
      browser,
      context,
      page,
      startUrl,
      snapshot: {
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        provider: input.connection.provider,
        currentUrl: restored?.authenticatedUrl || startUrl,
        authenticationState: "STARTING",
        connectionHealth: "connecting",
        lastInteractionAt: new Date().toISOString(),
      },
      listeners: new Set(),
      customerConfirmed: false,
      authenticatedPersisted: Boolean(restored),
      restoredSession: Boolean(restored),
    };
    activeSessions.set(key, session);
    installPageGovernance(session, page);
    context.on("page", popup => {
      if (popup === session.page) return;
      installPageGovernance(session, popup);
      void popup
        .waitForURL(url => url.protocol === "https:", { timeout: 15_000 })
        .then(() =>
          assertAuthorisedConnectionUrl({
            organisationId: session.connection.organisationId,
            connectedSystemId: session.connection.id,
            rawUrl: popup.url(),
          })
        )
        .then(() => {
          session.page = popup;
          emit(session, { currentUrl: popup.url() });
        })
        .catch(() => {
          void popup.close();
          emit(session, {
            errorMessage:
              "This CRM opened a new service that has not been approved.",
          });
        });
    });
    armIdle(session);
    try {
      await page.goto(restored?.authenticatedUrl || startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await evaluate(session);
    } catch (error) {
      emit(session, {
        authenticationState: restored ? "REAUTHENTICATION_REQUIRED" : "ERROR",
        connectionHealth: "needs_attention",
        errorMessage: publicMessage(error),
      });
    }
    return session;
  },

  snapshot(session: ManagedCrmBrowserSession) {
    return { ...session.snapshot };
  },
  subscribe(
    session: ManagedCrmBrowserSession,
    listener: (snapshot: CrmBrowserSessionSnapshot) => void
  ) {
    session.listeners.add(listener);
    listener({ ...session.snapshot });
    return () => session.listeners.delete(listener);
  },
  async customerFinishedSigningIn(session: ManagedCrmBrowserSession) {
    session.customerConfirmed = true;
    await evaluate(session);
    return { ...session.snapshot };
  },
  async navigate(
    session: ManagedCrmBrowserSession,
    action: "back" | "forward" | "refresh"
  ) {
    if (action === "back")
      await session.page.goBack({ waitUntil: "domcontentloaded" });
    else if (action === "forward")
      await session.page.goForward({ waitUntil: "domcontentloaded" });
    else await session.page.reload({ waitUntil: "domcontentloaded" });
    armIdle(session);
    await evaluate(session);
  },
  async persist(session: ManagedCrmBrowserSession) {
    if (session.snapshot.authenticationState === "AUTHENTICATED")
      await persistAuthenticatedSession(session, true);
  },
  async teardown(organisationId: number, connectedSystemId: number) {
    const key = sessionKey(organisationId, connectedSystemId);
    const session = activeSessions.get(key);
    if (!session) return;
    activeSessions.delete(key);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    await this.persist(session).catch(() => undefined);
    await session.context.close().catch(() => undefined);
  },
  resetForTests() {
    activeSessions.forEach(session => {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      void session.context.close();
    });
    activeSessions.clear();
    browserPool.clear();
  },
};

export type ManagedCrmBrowserSessionHandle = ManagedCrmBrowserSession;
export const MANAGED_CRM_BROWSER_LIMITS = { idleTimeoutMs: IDLE_TIMEOUT_MS };
