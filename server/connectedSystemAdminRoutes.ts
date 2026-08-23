import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { connectedSystems } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { canManageOrganisation } from "./organisationAccess";
import { requireLocalHttpContext } from "./httpAuth";
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
  const { userId, membership } = await requireLocalHttpContext(req);
  if (!canManageOrganisation(membership.role))
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
  console.error(
    JSON.stringify({
      event: "connected_system_admin_error",
      detail: detail.slice(0, 300),
    })
  );
  return res
    .status(400)
    .json({
      error: detail.slice(0, 300) || "Connected-system operation failed.",
    });
}

function profile(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Browser connector profile must be a JSON object.");
  const encoded = JSON.stringify(value);
  if (encoded.length > 250_000)
    throw new Error("Browser connector profile is too large.");
  return value as Record<string, unknown>;
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
      const browserProfile = profile(req.body?.browserProfile);
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
      if (username && password)
        await saveConnectionSecret({
          userId,
          organisationId: membership.organisationId,
          connectedSystemId,
          secretKind: "browser",
          secret: { credentials: { username, password } },
        });
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
        },
      });
      return res.json({ ok: true, requiresVerification: true });
    } catch (error) {
      return sendError(res, error);
    }
  });

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
