import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb } from "./db";

export type ManagementReportSettings = {
  reportMode: "daily_full" | "exceptions_only";
  overdueTaskThreshold: number;
  staleOpportunityThreshold: number;
  noNextStepThreshold: number;
  includeHealthyPeople: boolean;
};

export const DEFAULT_MANAGEMENT_REPORT_SETTINGS: ManagementReportSettings = {
  reportMode: "exceptions_only",
  overdueTaskThreshold: 1,
  staleOpportunityThreshold: 1,
  noNextStepThreshold: 1,
  includeHealthyPeople: false,
};

function boundedInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : fallback;
}

export function parseManagementReportSettings(settings: Record<string, unknown> | null | undefined): ManagementReportSettings {
  const source = settings?.managementIntelligence && typeof settings.managementIntelligence === "object" ? settings.managementIntelligence as Record<string, unknown> : {};
  return {
    reportMode: source.reportMode === "daily_full" ? "daily_full" : "exceptions_only",
    overdueTaskThreshold: boundedInt(source.overdueTaskThreshold, 1),
    staleOpportunityThreshold: boundedInt(source.staleOpportunityThreshold, 1),
    noNextStepThreshold: boundedInt(source.noNextStepThreshold, 1),
    includeHealthyPeople: source.includeHealthyPeople === true,
  };
}

export async function loadManagementReportSettings(organisationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1))[0];
  if (!row) throw new Error("Organisation was not found.");
  return parseManagementReportSettings(row.settings);
}

export async function saveManagementReportSettings(organisationId: number, input: ManagementReportSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, organisationId)).limit(1))[0];
  if (!row) throw new Error("Organisation was not found.");
  const settings = { ...(row.settings ?? {}), managementIntelligence: input };
  await db.update(organisations).set({ settings }).where(eq(organisations.id, organisationId));
  return input;
}
