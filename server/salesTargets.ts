import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { canManageOrganisation, requireOrganisationMembership } from "./organisation";

export type SalespersonTarget = {
  userId: number;
  dailyActivityTarget: number;
  monthlyWonValueTargetMinor: number;
  maxOverdueTasks: number;
};

function nonNegative(value: unknown, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.floor(number), max) : 0;
}

export function normalizeSalesTargets(value: unknown): SalespersonTarget[] {
  if (!Array.isArray(value)) return [];
  const targets = new Map<number, SalespersonTarget>();
  for (const item of value.slice(0, 500)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const userId = Number(source.userId);
    if (!Number.isInteger(userId) || userId <= 0) continue;
    targets.set(userId, {
      userId,
      dailyActivityTarget: nonNegative(source.dailyActivityTarget, 10_000),
      monthlyWonValueTargetMinor: nonNegative(source.monthlyWonValueTargetMinor, 2_000_000_000),
      maxOverdueTasks: nonNegative(source.maxOverdueTasks, 100_000),
    });
  }
  return Array.from(targets.values());
}

export async function getSalesTargets(input: { userId: number; organisationId: number }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  return normalizeSalesTargets((organisation.settings as Record<string, unknown>)?.salesTargets);
}

export async function saveSalesTargets(input: { userId: number; organisationId: number; targets: SalespersonTarget[] }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!canManageOrganisation(membership.role)) throw new Error("Only organisation owners and managers can change salesperson targets.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  const targets = normalizeSalesTargets(input.targets);
  const settings = { ...(organisation.settings as Record<string, unknown>), salesTargets: targets };
  await db.update(organisations).set({ settings }).where(eq(organisations.id, input.organisationId));
  await recordAudit({ userId: input.userId, eventType: "sales_targets_updated", entityType: "organisation", entityId: String(input.organisationId), summary: `Sales targets updated for ${targets.length} team member${targets.length === 1 ? "" : "s"}.`, metadata: { targetCount: targets.length } });
  return targets;
}
