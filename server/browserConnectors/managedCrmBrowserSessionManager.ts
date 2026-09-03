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
  loadUserConnectionSecret,
  saveConnectionSecret,
  saveUserConnectionSecret,
} from "../connectedSystems";
import { getDb, recordAudit } from "../db";
import { connectedSystems } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import {
  canManageOrganisationForUser,
  requireOrganisationMembership,
} from "../organisation";
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
  const providerProof = evidence.knownProvider
    ? evidence.strongAuthenticatedMarker || evidence.customerConfirmed
    : evidence.customerConfirmed;
  if (commonProof && providerProof) return "AUTHENTICATED";
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

export function providerAuthenticatedUrlMarker(
  provider: CrmProvider,
  rawUrl: string
) {
  try {
    const url = new URL(rawUrl);
    if (provider === "genie")
      return (
        url.hostname.toLowerCase() === "genie.entrepreneurscircle.org" &&
        /^\/v2\/location\/[^/]+\/(?:dashboard|contacts?|candidates?|tasks?|opportunities?)(?:\/|$)/i.test(
          url.pathname
        )
      );
    return false;
  } catch {
    return false;
  }
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
  canCommission: boolean;
  reauthenticationRecorded?: boolean;
  evaluating?: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const activeSessions = new Map<string, ManagedCrmBrowserSession>();
const browserPool = new Map<string, Promise<Browser>>();
const IDLE_TIMEOUT_MS = 30 * 60_000;

function sessionKey(
  organisationId: number,
  connectedSystemId: number,
  userId: number
) {
  return `${organisationId}:${connectedSystemId}:user:${userId}`;
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
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 16);
    for (let index = 0; index < count; index++)
      if (
        await locator
          .nth(index)
          .isVisible()
          .catch(() => false)
      )
        return true;
  }
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
    selectorAuthenticatedMarker,
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
    strongAuthenticatedMarker:
      selectorAuthenticatedMarker ||
      providerAuthenticatedUrlMarker(session.connection.provider, before),
    meaningfulApplicationStructure: structureCount >= 4,
    stablePage,
    safeReadInspectionPassed: authorisedUrl && structureCount >= 4,
    customerConfirmed: session.customerConfirmed,
    knownProvider: session.connection.provider !== "custom_browser",
  };
}

async function ensureCommissioning(session: ManagedCrmBrowserSession) {
  if (!session.canCommission) return;
  const { ensureAutomaticCommissioning } = await import(
    "../crm/ensureCommissioning"
  );
  await ensureAutomaticCommissioning({
    userId: session.openedByUserId,
    organisationId: session.connection.organisationId,
    connectedSystemId: session.connection.id,
  });
}

async function persistPersonalSession(
  session: ManagedCrmBrowserSession,
  browserSession: Awaited<ReturnType<typeof captureBrowserSessionPackage>>
) {
  const existingPersonal =
    (await loadUserConnectionSecret({
      userId: session.openedByUserId,
      organisationId: session.connection.organisationId,
      connectedSystemId: session.connection.id,
      secretKind: "browser",
    })) || {};
  await saveUserConnectionSecret({
    userId: session.openedByUserId,
    organisationId: session.connection.organisationId,
    connectedSystemId: session.connection.id,
    secretKind: "browser",
    secret: { ...existingPersonal, browserSession },
  });
}

/**
 * Company capability commissioning may run after the interactive browser closes.
 * Keep one backend-only snapshot for that job, but bind it permanently to the
 * manager who established it. It is never restored into another user's browser.
 */
async function persistSharedCommissioningSession(
  session: ManagedCrmBrowserSession,
  browserSession: Awaited<ReturnType<typeof captureBrowserSessionPackage>>
) {
  if (!session.canCommission) return;
  const existingShared =
    (await loadConnectionSecret({
      organisationId: session.connection.organisationId,
      connectedSystemId: session.connection.id,
      secretKind: "browser",
    })) || {};
  const existingOwner = Number(existingShared.commissioningUserId || 0);
  if (existingOwner && existingOwner !== session.openedByUserId) return;
  await saveConnectionSecret({
    userId: session.openedByUserId,
    organisationId: session.connection.organisationId,
    connectedSystemId: session.connection.id,
    secretKind: "browser",
    secret: {
      ...existingShared,
      browserSession,
      commissioningUserId: session.openedByUserId,
    },
  });
}

async function ownsSharedCommissioningSession(
  session: ManagedCrmBrowserSession
) {
  if (!session.canCommission) return false;
  const shared = await loadConnectionSecret({
    organisationId: session.connection.organisationId,
    connectedSystemId: session.connection.id,
    secretKind: "browser",
  });
  return Number(shared?.commissioningUserId || 0) === session.openedByUserId;
}

async function persistAuthenticatedSession(
  session: ManagedCrmBrowserSession,
  force = false
) {
  const shouldPersist = !session.authenticatedPersisted || force;
  if (shouldPersist) {
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
      await persistPersonalSession(session, browserSession);
      await persistSharedCommissioningSession(session, browserSession);

      if (session.canCommission) {
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
      }
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
          identityScope: "user",
          commissioningIdentityUpdated:
            session.canCommission &&
            (await ownsSharedCommissioningSession(session)),
        },
      });
    } catch (error) {
      session.authenticatedPersisted = false;
      console.warn(
        JSON.stringify({
          event: "crm_browser_session_persist_failed",
          connectedSystemId: session.connection.id,
          provider: session.connection.provider,
          detail:
            error instanceof Error
              ? error.message.slice(0, 220)
              : String(error).slice(0, 220),
        })
      );
      emit(session, {
        authenticationState: "ERROR",
        connectionHealth: "needs_attention",
        errorMessage: publicMessage(error),
      });
      return;
    }
  }

  // A restored personal browser package means persistence has already happened,
  // not that automatic capability commissioning has happened. Only managers can
  // resume the company-level commissioning job; ordinary salespeople keep a
  // private browser identity without changing the shared connector lifecycle.
  try {
    await ensureCommissioning(session);
  } catch {
    emit(session, {
      authenticationState: "AUTHENTICATED",
      connectionHealth: "needs_attention",
      errorMessage:
        "Your CRM is signed in, but automatic function setup needs attention.",
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
        if (await ownsSharedCommissioningSession(session)) {
          const db = await getDb();
          if (db)
            await db
              .update(connectedSystems)
              .set({
                status: "authentication_expired",
                lastHealthSummary:
                  "The commissioning CRM identity needs a manager to sign in again.",
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
        }
        await recordAudit({
          userId: session.openedByUserId,
          organisationId: session.connection.organisationId,
          eventType: "crm_reauthentication_required",
          entityType: "connected_system",
          entityId: String(session.connection.id),
          summary: "A user's CRM session expired and requires human sign-in.",
          metadata: { identityScope: "user" },
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
        session.connection.id,
        session.openedByUserId
      ),
    IDLE_TIMEOUT_MS
  );
}

export function shouldReuseManagedCrmBrowserSession(input: {
  pageClosed: boolean;
  browserConnected: boolean;
  currentUrl: string;
  connectionHealth: CrmBrowserSessionSnapshot["connectionHealth"];
}) {
  return (
    !input.pageClosed &&
    input.browserConnected &&
    input.currentUrl !== "about:blank" &&
    input.connectionHealth !== "disconnected"
  );
}

export const managedCrmBrowserSessionManager = {
  async open(input: { connection: AdapterConnection; userId: number }) {
    const key = sessionKey(
      input.connection.organisationId,
      input.connection.id,
      input.userId
    );
    const existing = activeSessions.get(key);
    if (
      existing &&
      shouldReuseManagedCrmBrowserSession({
        pageClosed: existing.page.isClosed(),
        browserConnected: existing.browser.isConnected(),
        currentUrl: existing.page.url(),
        connectionHealth: existing.snapshot.connectionHealth,
      })
    ) {
      armIdle(existing);
      return existing;
    }
    if (existing) {
      activeSessions.delete(key);
      if (existing.idleTimer) clearTimeout(existing.idleTimer);
      await existing.context.close().catch(() => undefined);
    }

    const membership = await requireOrganisationMembership(
      input.userId,
      input.connection.organisationId
    );
    const canCommission = await canManageOrganisationForUser(
      input.userId,
      membership.role
    );
    const preset = crmBrowserPreset(input.connection.provider);
    const startUrl = input.connection.baseUrl || preset.defaultStartUrl;
    if (!startUrl) throw new Error("CRM_START_URL_REQUIRED");
    await assertAuthorisedConnectionUrl({
      organisationId: input.connection.organisationId,
      connectedSystemId: input.connection.id,
      rawUrl: startUrl,
    });

    const personalSecret =
      (await loadUserConnectionSecret({
        userId: input.userId,
        organisationId: input.connection.organisationId,
        connectedSystemId: input.connection.id,
        secretKind: "browser",
      })) || {};
    const personalSession = isBrowserSessionPackage(
      personalSecret.browserSession
    )
      ? personalSecret.browserSession
      : undefined;

    // Interactive restoration is always user-scoped. The backend-only
    // commissioning snapshot is never attached to another user's browser.
    const restored = personalSession;

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
      authenticatedPersisted: Boolean(personalSession),
      restoredSession: Boolean(restored),
      canCommission,
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
    const restoredUrl = restored?.authenticatedUrl;
    try {
      await page.goto(restoredUrl || startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await evaluate(session);
    } catch (error) {
      if (restoredUrl && restoredUrl !== startUrl) {
        try {
          await page.goto(startUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await evaluate(session);
          return session;
        } catch {
          // Preserve the original restoration failure as the useful diagnosis.
        }
      }
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

  async teardown(
    organisationId: number,
    connectedSystemId: number,
    userId?: number
  ) {
    const targets = Array.from(activeSessions.values()).filter(
      session =>
        session.connection.organisationId === organisationId &&
        session.connection.id === connectedSystemId &&
        (userId === undefined || session.openedByUserId === userId)
    );
    for (const session of targets) {
      activeSessions.delete(session.key);
      if (session.idleTimer) clearTimeout(session.idleTimer);
      await this.persist(session).catch(() => undefined);
      await session.context.close().catch(() => undefined);
    }
  },

  async teardownConnection(organisationId: number, connectedSystemId: number) {
    await this.teardown(organisationId, connectedSystemId);
  },

  activeUserSessionCount(organisationId: number, connectedSystemId: number) {
    return Array.from(activeSessions.values()).filter(
      session =>
        session.connection.organisationId === organisationId &&
        session.connection.id === connectedSystemId
    ).length;
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
