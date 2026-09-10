import type { Express, Request, Response } from "express";
import { canManageOrganisation } from "./organisationAccess";
import { loadManagementReportSettings, saveManagementReportSettings, type ManagementReportSettings } from "./managementSettings";
import { recordAudit } from "./db";
import {
  getClientActionConfiguration,
  saveClientActionConfiguration,
  validateClientActionConfigurationForCommissioning,
} from "./clientActionConfiguration";
import { requireManagementHttpContext } from "./managementElevation";

async function manager(req: Request) {
  const { userId, membership, user } = await requireManagementHttpContext(req);
  if (!user.isPlatformOwner && !canManageOrganisation(membership.role)) throw new Error("MANAGER_REQUIRED");
  return { userId, membership };
}

function threshold(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) throw new Error(`${label} must be a whole number from 0 to 1000.`);
  return parsed;
}

function parseInput(body: unknown): ManagementReportSettings {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    reportMode: input.reportMode === "daily_full" ? "daily_full" : "exceptions_only",
    overdueTaskThreshold: threshold(input.overdueTaskThreshold, "Overdue-task threshold"),
    staleOpportunityThreshold: threshold(input.staleOpportunityThreshold, "Stale-opportunity threshold"),
    noNextStepThreshold: threshold(input.noNextStepThreshold, "Missing-next-step threshold"),
    includeHealthyPeople: input.includeHealthyPeople === true,
  };
}

function fail(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  if (detail === "MANAGER_REQUIRED") return res.status(403).json({ error: "A management role is required." });
  if (detail.startsWith("MANAGEMENT_ELEVATION_")) return res.status(403).json({ error: detail });
  return res.status(400).json({ error: detail.slice(0, 300) });
}

export function registerManagementSettingsRoutes(app: Express) {
  app.get("/api/management-settings", async (req, res) => {
    try {
      const { membership } = await manager(req);
      return res.json(await loadManagementReportSettings(membership.organisationId));
    } catch (error) { return fail(res, error); }
  });

  app.put("/api/management-settings", async (req, res) => {
    try {
      const { userId, membership } = await manager(req);
      const settings = parseInput(req.body);
      await saveManagementReportSettings(membership.organisationId, settings);
      await recordAudit({ userId, eventType: "management_intelligence_settings_updated", entityType: "organisation", entityId: String(membership.organisationId), summary: "Management Intelligence reporting thresholds were updated.", metadata: settings as unknown as Record<string, unknown> });
      return res.json(settings);
    } catch (error) { return fail(res, error); }
  });

  app.get("/api/client-workflow-configuration", async (req, res) => {
    try {
      const { membership } = await manager(req);
      const configuration = await getClientActionConfiguration({
        organisationId: membership.organisationId,
      });
      let validation:
        | ReturnType<typeof validateClientActionConfigurationForCommissioning>
        | { valid: false; error: string };
      try {
        validation = validateClientActionConfigurationForCommissioning(
          configuration
        );
      } catch (error) {
        validation = {
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return res.json({
        configuration,
        validation,
        exportedAt: new Date().toISOString(),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.put("/api/client-workflow-configuration", async (req, res) => {
    try {
      const { userId, membership } = await manager(req);
      const configuration =
        req.body &&
        typeof req.body === "object" &&
        !Array.isArray(req.body) &&
        "configuration" in req.body
          ? (req.body as Record<string, unknown>).configuration
          : req.body;
      const encoded = JSON.stringify(configuration ?? null);
      if (encoded.length > 500_000)
        throw new Error(
          "CLIENT_WORKFLOW_CONFIGURATION_TOO_LARGE: keep the tenant workflow configuration below 500 KB."
        );
      const saved = await saveClientActionConfiguration({
        userId,
        organisationId: membership.organisationId,
        configuration,
      });
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "client_workflow_configuration_updated",
        entityType: "organisation",
        entityId: String(membership.organisationId),
        summary:
          "Tenant-specific Sales Assistant workflow rules were validated and updated.",
        metadata: {
          workflowKeys: saved.workflowKeys,
          templateKeys: saved.templateKeys,
          contentRetained: false,
        },
      });
      return res.json({
        configuration: saved.configuration,
        validation: {
          valid: true,
          workflowKeys: saved.workflowKeys,
          templateKeys: saved.templateKeys,
        },
        savedAt: new Date().toISOString(),
      });
    } catch (error) {
      return fail(res, error);
    }
  });
}
