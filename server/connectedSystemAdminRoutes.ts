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
      if (/^(?:password|username|credentials?|secret|token|cookies?|storageState|browserSession)$/i.test(key))
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
    throw new Error("Sign-in calibration must contain the four guided selectors.");
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

export function registerConnectedSystemAdminRoutes(app: Express) {
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
