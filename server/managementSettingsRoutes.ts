import type { Express, Request, Response } from "express";
import { canManageOrganisation } from "./organisationAccess";
import { loadManagementReportSettings, saveManagementReportSettings, type ManagementReportSettings } from "./managementSettings";
import { recordAudit } from "./db";
import { requireLocalHttpContext } from "./httpAuth";

async function manager(req: Request) {
  const { userId, membership } = await requireLocalHttpContext(req);
  if (!canManageOrganisation(membership.role)) throw new Error("MANAGER_REQUIRED");
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
}
