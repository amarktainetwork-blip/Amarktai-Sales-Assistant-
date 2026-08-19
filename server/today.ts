import { and, desc, eq } from "drizzle-orm";
import { crmOpportunities, crmTasks, externalUserMappings } from "../drizzle/schema";
import { getDb } from "./db";
import { canViewTeamData, requireOrganisationMembership } from "./organisation";

function dayEnd(now: Date) { const end = new Date(now); end.setHours(23, 59, 59, 999); return end; }
function isOpen(status: string) { return !/completed|closed|done|cancelled/i.test(status); }
function ageDays(value?: Date | null, now = new Date()) { return value ? Math.floor((now.valueOf() - value.valueOf()) / 86_400_000) : null; }

export async function getTodayWork(input: { userId: number; organisationId: number }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const [mappings, tasks, opportunities] = await Promise.all([
    db.select().from(externalUserMappings).where(and(eq(externalUserMappings.organisationId, input.organisationId), eq(externalUserMappings.userId, input.userId), eq(externalUserMappings.isActive, true))),
    db.select().from(crmTasks).where(eq(crmTasks.organisationId, input.organisationId)).orderBy(desc(crmTasks.dueAt)).limit(600),
    db.select().from(crmOpportunities).where(eq(crmOpportunities.organisationId, input.organisationId)).orderBy(desc(crmOpportunities.updatedAt)).limit(600),
  ]);
  const ownerIds = new Set(mappings.map(mapping => mapping.externalUserId));
  const unrestricted = canViewTeamData(membership.role);
  const belongsToUser = (ownerExternalId: string | null) => unrestricted || ownerIds.has(ownerExternalId ?? "");
  const scopedTasks = tasks.filter(task => belongsToUser(task.ownerExternalId));
  const scopedOpportunities = opportunities.filter(opportunity => belongsToUser(opportunity.ownerExternalId));
  const openTasks = scopedTasks.filter(task => isOpen(task.status));
  const overdueTasks = openTasks.filter(task => task.dueAt && task.dueAt < now);
  const dueToday = openTasks.filter(task => task.dueAt && task.dueAt >= now && task.dueAt <= dayEnd(now));
  const staleOpportunities = scopedOpportunities.filter(opportunity => { const age = ageDays(opportunity.lastActivityAt, now); return age === null || age >= 7; });
  const noNextStep = scopedOpportunities.filter(opportunity => !opportunity.nextStepAt);
  const priority = scopedOpportunities.map(opportunity => {
    const staleDays = ageDays(opportunity.lastActivityAt, now) ?? 14;
    const overdue = opportunity.nextStepAt ? opportunity.nextStepAt < now : false;
    const score = Math.min(45, staleDays * 4) + (overdue ? 25 : 0) + (!opportunity.nextStepAt ? 18 : 0) + Math.min(12, Math.floor((opportunity.valueMinor ?? 0) / 100_000));
    const reasons = [overdue ? "Next step is overdue" : null, !opportunity.nextStepAt ? "No next step" : null, staleDays >= 7 ? `No activity for ${staleDays} days` : null].filter((reason): reason is string => Boolean(reason));
    return { ...opportunity, priorityScore: score, reasons, staleDays };
  }).filter(item => item.reasons.length).sort((a, b) => b.priorityScore - a.priorityScore || (b.valueMinor ?? 0) - (a.valueMinor ?? 0)).slice(0, 20);
  return {
    generatedAt: now,
    role: membership.role,
    requiresOwnerMapping: !unrestricted && ownerIds.size === 0,
    metrics: { dueToday: dueToday.length, overdue: overdueTasks.length, staleOpportunities: staleOpportunities.length, noNextStep: noNextStep.length, priorityRecords: priority.length },
    queues: { dueToday: dueToday.slice(0, 12), overdueTasks: overdueTasks.slice(0, 12), priority },
  };
}
