import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { connectedSystems } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { canManageOrganisation } from "./organisationAccess";
import { requireManagementHttpContext } from "./managementElevation";
import {
  getConnectedSystemForUser,
  loadConnectionSecret,
  recordConnectionVerification,
  saveConnectionSecret,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { randomUUID } from "node:crypto";
import { testLearnedBrowserOperation } from "./browserConnectors/browserCrmAdapter";
import {
  beginGenieInteractiveAuthentication,
  completeGenieInteractiveAuthentication,
  genieInteractiveAuthHasLiveChallenge,
  type GenieBrowserSecret,
} from "./browserConnectors/genieInteractiveAuth";
import { requireLocalHttpContext } from "./httpAuth";
import {
  automaticCommissioningStatus,
  authoriseCommissioningSafeTest,
  startAutomaticCommissioning,
} from "./crm/automaticCommissioning";
import { resetAndDeleteGenieConnection } from "./genie/resetConnection";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { PreOtpReadiness } from "./genie/preOtpReadiness";

const execFileAsync = promisify(execFile);

async function runPreOtpVerifier(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  phase: "full" | "check" | "consume";
}) {
  const builtVerifier = resolve(process.cwd(), "dist", "verifyGeniePreOtp.js");
  const verifierArgs = existsSync(builtVerifier)
    ? [builtVerifier]
    : [
        "--import",
        "tsx",
        resolve(process.cwd(), "server", "verifyGeniePreOtp.ts"),
      ];
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      ...verifierArgs,
      `--user-id=${input.userId}`,
      `--organisation-id=${input.organisationId}`,
      `--connection-id=${input.connectedSystemId}`,
      `--phase=${input.phase}`,
    ],
    { timeout: 150_000, maxBuffer: 128 * 1024, env: process.env }
  );
  const resultLine = stdout
    .split(/\r?\n/)
    .find(line => line.startsWith("PRE_OTP_RESULT="));
  if (!resultLine) throw new Error("PRE_OTP_RESULT_MISSING");
  return JSON.parse(
    resultLine.slice("PRE_OTP_RESULT=".length)
  ) as PreOtpReadiness;
}

async function requireManager(req: Request) {
  const { userId, membership, user } = await requireManagementHttpContext(req);
  if (!user.isPlatformOwner && !canManageOrganisation(membership.role))
    throw new Error("MANAGER_REQUIRED");
  return { userId, membership };
}

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED")
    return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED")
    return res
      .status(403)
      .json({ error: "Second-factor verification is required." });
  if (detail === "MANAGER_REQUIRED")
    return res.status(403).json({ error: "A management role is required." });
  if (detail.startsWith("MANAGEMENT_ELEVATION_"))
    return res.status(403).json({ error: detail });
  console.error(
    JSON.stringify({
      event: "connected_system_admin_error",
      detail: detail.slice(0, 300),
    })
  );
  return res.status(400).json({
    error: detail.slice(0, 300) || "Connected-system operation failed.",
  });
}

export function validateBrowserProfile(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Browser connector profile must be a JSON object.");
  const encoded = JSON.stringify(value);
  if (encoded.length > 250_000)
    throw new Error("Browser connector profile is too large.");
  const inspect = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(inspect);
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if (
        /^(?:password|username|credentials?|secret|token|cookies?|storageState|browserSession)$/i.test(
          key
        )
      )
        throw new Error(
          "Browser profiles may contain selectors and operation configuration only, never credentials or session material."
        );
      inspect(nested);
    }
  };
  inspect(value);
  return value as Record<string, unknown>;
}

function calibration(value: unknown, baseUrl: string | null) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Sign-in calibration must contain the four guided selectors."
    );
  if (!baseUrl)
    throw new Error("Save the Genie sign-in URL before calibrating its form.");
  const source = value as Record<string, unknown>;
  const selector = (key: string, label: string) => {
    const result = typeof source[key] === "string" ? source[key].trim() : "";
    if (!result || result.length > 500 || /[{}<>;`]/.test(result))
      throw new Error(`Enter a safe ${label} CSS selector.`);
    return result;
  };
  const usernameSelector = selector("usernameSelector", "username/email field");
  const passwordSelector = selector("passwordSelector", "password field");
  const submitSelector = selector("submitSelector", "submit button");
  const readySelector = selector("readySelector", "authenticated/ready marker");
  if (["body", "html", "*", "html body"].includes(readySelector.toLowerCase()))
    throw new Error(
      "The authenticated/ready marker must identify a meaningful CRM shell element, not the document body."
    );
  return {
    url: baseUrl,
    usernameSelector,
    passwordSelector,
    submitSelector,
    readySelector,
  };
}

function interactiveCommissioningResponse(expired = false) {
  return {
    id: 0,
    state: "AUTHENTICATE",
    status: "needs_attention",
    humanStatus: expired ? "Verification expired" : "Verification required",
    safeTestRequired: false,
    temporaryRecordSupported: false,
    temporaryRecordGuidance: "",
    advancedFallback: false,
    interactiveAuthRequired: true,
    verificationExpired: expired,
    progress: {
      authentication: expired
        ? "New code required"
        : "Verification code required",
    },
    optionalFailures: {},
  };
}

async function persistGenieLoginProfile(input: {
  system: Awaited<ReturnType<typeof getConnectedSystemForUser>>;
  organisationId: number;
  loginCalibration: {
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
    readySelector?: string;
  };
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const currentProfile =
    input.system.configuration?.browserProfile &&
    typeof input.system.configuration.browserProfile === "object" &&
    !Array.isArray(input.system.configuration.browserProfile)
      ? (input.system.configuration.browserProfile as Record<string, unknown>)
      : {};
  const currentLogin =
    currentProfile.login &&
    typeof currentProfile.login === "object" &&
    !Array.isArray(currentProfile.login)
      ? (currentProfile.login as Record<string, unknown>)
      : {};
  const login = {
    ...currentLogin,
    url: input.system.baseUrl,
    usernameSelector: input.loginCalibration.usernameSelector,
    passwordSelector: input.loginCalibration.passwordSelector,
    submitSelector: input.loginCalibration.submitSelector,
    ...(input.loginCalibration.readySelector
      ? { readySelector: input.loginCalibration.readySelector }
      : {}),
  };
  await db
    .update(connectedSystems)
    .set({
      configuration: {
        ...(input.system.configuration || {}),
        browserProfile: { ...currentProfile, login },
      },
      status: "testing",
      lastHealthSummary:
        "Genie sign-in was approved; backend capability verification is continuing.",
    })
    .where(
      and(
        eq(connectedSystems.id, input.system.id),
        eq(connectedSystems.organisationId, input.organisationId)
      )
    );
}

async function prepareGenieCommissioning(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  if (system.provider !== "genie") return null;
  if (
    system.connectionMethod !== "browser" &&
    system.connectionMethod !== "sidecar"
  )
    return null;

  const existing = ((await loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    secretKind: "browser",
  })) || {}) as GenieBrowserSecret;
  const result = await beginGenieInteractiveAuthentication({
    connection: toAdapterConnection(system),
    secret: existing,
  });
  if (result.status === "verification_required") {
    const {
      browserSession: _expiredSession,
      pendingInteractiveAuth: _previousChallenge,
      ...rest
    } = existing;
    await saveConnectionSecret({
      userId: input.userId,
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      secretKind: "browser",
      secret: {
        ...rest,
        pendingInteractiveAuth: result.pendingInteractiveAuth,
      } as GenieBrowserSecret,
    });
    const db = await getDb();
    if (!db) throw new Error("Database connection is unavailable.");
    await db
      .update(connectedSystems)
      .set({
        status: "needs_attention",
        lastHealthSummary:
          "Genie sent a verification code. Enter it in Amarktai to finish sign-in.",
      })
      .where(
        and(
          eq(connectedSystems.id, input.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      );
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "genie_interactive_auth_requested",
      entityType: "connected_system",
      entityId: String(input.connectedSystemId),
      summary:
        "Genie requested an interactive verification code during approved sign-in.",
      metadata: { codeStored: false, pendingSessionEncrypted: true },
    });
    return interactiveCommissioningResponse(false);
  }

  const { pendingInteractiveAuth: _pendingChallenge, ...rest } = existing;
  await saveConnectionSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    secretKind: "browser",
    secret: { ...rest, browserSession: result.browserSession },
  });
  await persistGenieLoginProfile({
    system,
    organisationId: input.organisationId,
    loginCalibration: result.loginCalibration,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "genie_browser_session_approved",
    entityType: "connected_system",
    entityId: String(input.connectedSystemId),
    summary:
      "Genie browser authentication was confirmed and the approved session was encrypted.",
    metadata: { interactiveCodeStored: false },
  });
  return null;
}

export function registerConnectedSystemAdminRoutes(app: Express) {
  app.get("/api/connected-system-admin/:id/pre-otp", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid connected system is required.");
      return res.json(
        await runPreOtpVerifier({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
          phase: "check",
        })
      );
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/connected-system-admin/:id/pre-otp", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid connected system is required.");
      const readiness = await runPreOtpVerifier({
        userId,
        organisationId: membership.organisationId,
        connectedSystemId,
        phase: "full",
      });
      if (!readiness.ready)
        throw new Error(
          `PRE_OTP_READY_REQUIRED:${readiness.failure || "Readiness proof was not retained."}`
        );
      return res.json(readiness);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/connected-system-admin/:id/genie-reset", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      const result = await resetAndDeleteGenieConnection({
        connectedSystemId,
        organisationId: membership.organisationId,
        userId,
        confirmDelete: false,
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/connected-system-admin/:id/genie-reset", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      if (
        req.body?.confirmation !== `RESET_GENIE_CONNECTION_${connectedSystemId}`
      )
        throw new Error(
          "GENIE_RESET_CONFIRMATION_REQUIRED: Preview and explicitly confirm the exact Genie connection first."
        );
      const result = await resetAndDeleteGenieConnection({
        connectedSystemId,
        organisationId: membership.organisationId,
        userId,
        confirmDelete: true,
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post(
    "/api/connected-system-admin/:id/commissioning",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
          throw new Error("A valid connected system is required.");
        const system = await getConnectedSystemForUser(
          userId,
          membership.organisationId,
          connectedSystemId
        );
        if (
          system.provider === "genie" &&
          (system.connectionMethod === "browser" ||
            system.connectionMethod === "sidecar")
        )
          await runPreOtpVerifier({
            userId,
            organisationId: membership.organisationId,
            connectedSystemId,
            phase: "consume",
          });
        const interactive = await prepareGenieCommissioning({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
        });
        if (interactive) return res.json(interactive);
        return res.json(
          await startAutomaticCommissioning({
            userId,
            organisationId: membership.organisationId,
            connectedSystemId,
          })
        );
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  app.get("/api/connected-system-admin/:id/commissioning", async (req, res) => {
    try {
      const { membership } = await requireLocalHttpContext(req);
      if (!canManageOrganisation(membership.role))
        throw new Error("MANAGER_REQUIRED");
      const connectedSystemId = Number(req.params.id);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid connected system is required.");
      const secret = (await loadConnectionSecret({
        organisationId: membership.organisationId,
        connectedSystemId,
        secretKind: "browser",
      }).catch(() => undefined)) as GenieBrowserSecret | undefined;
      if (secret?.pendingInteractiveAuth)
        return res.json({
          job: interactiveCommissioningResponse(
            !genieInteractiveAuthHasLiveChallenge(secret.pendingInteractiveAuth)
          ),
        });
      const job = await automaticCommissioningStatus({
        organisationId: membership.organisationId,
        connectedSystemId,
      });
      return res.json({ job });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post(
    "/api/connected-system-admin/:id/interactive-auth/verify",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
          throw new Error("A valid connected system is required.");
        const system = await getConnectedSystemForUser(
          userId,
          membership.organisationId,
          connectedSystemId
        );
        if (system.provider !== "genie")
          throw new Error(
            "Interactive verification is currently available only for Genie."
          );
        const existing = ((await loadConnectionSecret({
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
        })) || {}) as GenieBrowserSecret;
        if (!existing.pendingInteractiveAuth)
          throw new Error(
            "GENIE_VERIFICATION_CHALLENGE_REQUIRED: Request a fresh Genie verification code first."
          );
        const result = await completeGenieInteractiveAuthentication({
          connection: toAdapterConnection(system),
          pending: existing.pendingInteractiveAuth,
          code: req.body?.code,
        });
        const { pendingInteractiveAuth: _pendingChallenge, ...rest } = existing;
        await saveConnectionSecret({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
          secret: { ...rest, browserSession: result.browserSession },
        });
        await persistGenieLoginProfile({
          system,
          organisationId: membership.organisationId,
          loginCalibration: result.loginCalibration,
        });
        await recordAudit({
          userId,
          organisationId: membership.organisationId,
          eventType: "genie_interactive_auth_completed",
          entityType: "connected_system",
          entityId: String(connectedSystemId),
          summary:
            "Genie interactive verification succeeded and the approved browser session was encrypted.",
          metadata: { codeStored: false, approvedSessionEncrypted: true },
        });
        return res.json(
          await startAutomaticCommissioning({
            userId,
            organisationId: membership.organisationId,
            connectedSystemId,
          })
        );
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  app.post(
    "/api/connected-system-admin/:id/commissioning/safe-test",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
          throw new Error("A valid connected system is required.");
        const mode = req.body?.mode === "temporary" ? "temporary" : "existing";
        const reference =
          typeof req.body?.reference === "string" ? req.body.reference : "";
        const authorisedDestinations =
          req.body?.authorisedDestinations &&
          typeof req.body.authorisedDestinations === "object" &&
          !Array.isArray(req.body.authorisedDestinations)
            ? req.body.authorisedDestinations
            : {};
        const authorisedOperationKeys = Array.isArray(
          req.body?.authorisedOperationKeys
        )
          ? req.body.authorisedOperationKeys.filter(
              (key: unknown): key is string => typeof key === "string"
            )
          : [];
        const selectedOpportunityExternalId =
          typeof req.body?.selectedOpportunityExternalId === "string"
            ? req.body.selectedOpportunityExternalId
            : undefined;
        const selectedTaskExternalId =
          typeof req.body?.selectedTaskExternalId === "string"
            ? req.body.selectedTaskExternalId
            : undefined;
        return res.json(
          await authoriseCommissioningSafeTest({
            userId,
            organisationId: membership.organisationId,
            connectedSystemId,
            record: {
              mode,
              reference,
              authorisedDestinations,
              authorisedOperationKeys,
              selectedOpportunityExternalId,
              selectedTaskExternalId,
            },
          })
        );
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  app.put("/api/connected-system-admin/:id/browser", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0)
        throw new Error("A valid connected system is required.");
      const system = await getConnectedSystemForUser(
        userId,
        membership.organisationId,
        connectedSystemId
      );
      if (
        system.connectionMethod !== "browser" &&
        system.connectionMethod !== "sidecar"
      )
        throw new Error(
          "This endpoint only configures browser-based connected systems."
        );
      const username =
        typeof req.body?.username === "string"
          ? req.body.username.trim().slice(0, 500)
          : "";
      const password =
        typeof req.body?.password === "string"
          ? req.body.password.slice(0, 2000)
          : "";
      const advancedProfile = validateBrowserProfile(req.body?.browserProfile);
      const loginCalibration = calibration(
        req.body?.loginCalibration,
        system.baseUrl
      );
      if (advancedProfile && loginCalibration)
        throw new Error(
          "Save guided sign-in calibration separately from the expert browser profile."
        );
      const currentProfileValue =
        system.configuration?.browserProfile &&
        typeof system.configuration.browserProfile === "object" &&
        !Array.isArray(system.configuration.browserProfile)
          ? (system.configuration.browserProfile as Record<string, unknown>)
          : {};
      const currentProfile = validateBrowserProfile(currentProfileValue) || {};
      const browserProfile = loginCalibration
        ? { ...currentProfile, login: loginCalibration }
        : advancedProfile;
      if (!username && !password && !browserProfile)
        throw new Error(
          "Supply browser credentials, a calibrated browser profile, or both."
        );
      if ((username && !password) || (!username && password))
        throw new Error(
          "Browser username and password must be supplied together."
        );
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      if (browserProfile) {
        const configuration = {
          ...(system.configuration || {}),
          browserProfile,
        };
        await db
          .update(connectedSystems)
          .set({
            configuration,
            status: "testing",
            lastHealthSummary:
              "Browser connector configuration changed; backend verification is required.",
          })
          .where(
            and(
              eq(connectedSystems.id, connectedSystemId),
              eq(connectedSystems.organisationId, membership.organisationId)
            )
          );
      }
      if (username && password) {
        const existing = await loadConnectionSecret({
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
        });
        await saveConnectionSecret({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
          secret: { ...existing, credentials: { username, password } },
        });
      }
      await recordAudit({
        userId,
        eventType: "browser_connector_configured",
        entityType: "connected_system",
        entityId: String(connectedSystemId),
        summary: `${system.displayName} browser connector configuration was updated.`,
        metadata: {
          organisationId: membership.organisationId,
          credentialsUpdated: Boolean(username),
          profileUpdated: Boolean(browserProfile),
          guidedLoginCalibration: Boolean(loginCalibration),
        },
      });
      return res.json({ ok: true, requiresVerification: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put(
    "/api/connected-system-admin/:id/business-mapping",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        const system = await getConnectedSystemForUser(
          userId,
          membership.organisationId,
          connectedSystemId
        );
        const lines = (value: unknown, maximum: number) =>
          (Array.isArray(value) ? value : [])
            .filter(item => typeof item === "string" && item.trim())
            .slice(0, maximum)
            .map(item => String(item).trim().slice(0, 300));
        const channels = lines(req.body?.permittedCommunicationChannels, 8)
          .map(item => item.toLowerCase())
          .filter(item => ["email", "sms", "whatsapp"].includes(item));
        const businessMapping = {
          owners: lines(req.body?.owners, 100),
          pipelinesAndStages: lines(req.body?.pipelinesAndStages, 200),
          leadStatuses: lines(req.body?.leadStatuses, 100),
          taskMeanings: lines(req.body?.taskMeanings, 100),
          customFields: lines(req.body?.customFields, 200),
          permittedCommunicationChannels: channels,
          automationMode: ["advise", "review", "auto_preapproved"].includes(
            req.body?.automationMode
          )
            ? req.body.automationMode
            : "review",
          reviewedAt: new Date().toISOString(),
        };
        const db = await getDb();
        if (!db) throw new Error("Database connection is unavailable.");
        await db
          .update(connectedSystems)
          .set({
            configuration: {
              ...(system.configuration || {}),
              businessMapping,
            },
          })
          .where(
            and(
              eq(connectedSystems.id, connectedSystemId),
              eq(connectedSystems.organisationId, membership.organisationId)
            )
          );
        await recordAudit({
          userId,
          organisationId: membership.organisationId,
          eventType: "browser_crm_business_mapping_reviewed",
          entityType: "connected_system",
          entityId: String(connectedSystemId),
          summary: `${system.displayName} business mappings and permitted channels were reviewed during onboarding.`,
          metadata: {
            counts: Object.fromEntries(
              Object.entries(businessMapping)
                .filter(([, value]) => Array.isArray(value))
                .map(([key, value]) => [key, value.length])
            ),
          },
        });
        return res.json({ ok: true, businessMapping });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );

  app.post("/api/connected-system-admin/:id/verify", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const connectedSystemId = Number(req.params.id);
      const system = await getConnectedSystemForUser(
        userId,
        membership.organisationId,
        connectedSystemId
      );
      const adapter = getCrmAdapter(system.provider);
      const correlationId = randomUUID();
      const test = await adapter.testConnection({
        connection: toAdapterConnection(system),
        correlationId,
      });
      const outcome = await recordConnectionVerification({
        organisationId: membership.organisationId,
        connectedSystemId,
        correlationId,
        test,
      });
      return res.json({ ...outcome, summary: test.summary, correlationId });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post(
    "/api/connected-system-admin/:id/operations/:operationKey/test",
    async (req, res) => {
      try {
        const { userId, membership } = await requireManager(req);
        const connectedSystemId = Number(req.params.id);
        const operationKey = String(req.params.operationKey || "").trim();
        if (
          !Number.isInteger(connectedSystemId) ||
          connectedSystemId <= 0 ||
          !operationKey
        )
          throw new Error(
            "A valid connected system and operation are required."
          );
        if (req.body?.confirmControlledReplay !== true)
          throw new Error(
            "Controlled replay must be explicitly confirmed. Use a client-authorised test record for write operations."
          );
        const system = await getConnectedSystemForUser(
          userId,
          membership.organisationId,
          connectedSystemId
        );
        if (system.provider !== "genie" && system.provider !== "custom_browser")
          throw new Error(
            "Learned operation testing is only available for browser CRM connections."
          );
        const secret = await loadConnectionSecret({
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
        });
        const correlationId = randomUUID();
        const evidence = await testLearnedBrowserOperation({
          connection: toAdapterConnection(system),
          secret,
          provider: system.provider,
          operationKey,
          payload:
            req.body?.inputs &&
            typeof req.body.inputs === "object" &&
            !Array.isArray(req.body.inputs)
              ? req.body.inputs
              : {},
          correlationId,
          publishByUserId: req.body?.publish === true ? userId : undefined,
        });
        await recordAudit({
          userId,
          eventType: "browser_operation_controlled_replay",
          entityType: "connected_system",
          entityId: String(connectedSystemId),
          summary: `${operationKey} completed a controlled deterministic replay${req.body?.publish === true ? " and was published LIVE_PROVEN" : ""}.`,
          metadata: {
            organisationId: membership.organisationId,
            operationKey,
            correlationId,
            published: req.body?.publish === true,
          },
        });
        return res.json({
          ok: true,
          operationKey,
          correlationId,
          published: req.body?.publish === true,
          evidence,
        });
      } catch (error) {
        return sendError(res, error);
      }
    }
  );
}
