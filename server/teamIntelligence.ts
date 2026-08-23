import { and, eq } from "drizzle-orm";
import { crmActivities, crmOpportunities, crmPipelineStageMappings, crmTasks, externalUserMappings } from "../drizzle/schema";
import { getDb } from "./db";
import { canViewTeamData, requireOrganisationMembership } from "./organisation";
import { getSalesTargets } from "./salesTargets";

function open(status: string) { return !/completed|closed|done|cancelled/i.test(status); }
function stale(lastActivityAt: Date | null, now: Date) { return !lastActivityAt || now.valueOf() - lastActivityAt.valueOf() >= 7 * 86_400_000; }
function won(stage: string | null) { return Boolean(stage && /(^|\b)(closed[ _-]?won|won|sale[ _-]?complete|successful)(\b|$)/i.test(stage)); }

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")), hour: Number(value("hour")), dateKey: `${value("year")}-${value("month")}-${value("day")}`, monthKey: `${value("year")}-${value("month")}` };
}
function dateKey(date: Date | null, timezone: string) { return date ? zonedParts(date, timezone).dateKey : ""; }
function monthKey(date: Date | null, timezone: string) { return date ? zonedParts(date, timezone).monthKey : ""; }

export async function getTeamIntelligence(input: { userId: number; organisationId: number }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!canViewTeamData(membership.role)) throw new Error("Team Intelligence is available to organisation owners, managers, and auditors only.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const nowParts = zonedParts(now, membership.timezone || "UTC");
  const daysInMonth = new Date(Date.UTC(nowParts.year, nowParts.month, 0)).getUTCDate();
  const expectedMonthlyPace = Math.min(1, Math.max(0, nowParts.day / daysInMonth));
  const [mappings, tasks, opportunities, activities, targets, stageMappings] = await Promise.all([
    db.select().from(externalUserMappings).where(and(eq(externalUserMappings.organisationId, input.organisationId), eq(externalUserMappings.isActive, true))),
    db.select().from(crmTasks).where(eq(crmTasks.organisationId, input.organisationId)).limit(5000),
    db.select().from(crmOpportunities).where(eq(crmOpportunities.organisationId, input.organisationId)).limit(5000),
    db.select().from(crmActivities).where(eq(crmActivities.organisationId, input.organisationId)).limit(10_000),
    getSalesTargets({ userId: input.userId, organisationId: input.organisationId }),
    db.select().from(crmPipelineStageMappings).where(and(eq(crmPipelineStageMappings.organisationId, input.organisationId), eq(crmPipelineStageMappings.isActive, true))),
  ]);
  const stageCategoryBySystemAndStage = new Map(stageMappings.map(mapping => [`${mapping.connectedSystemId}:${mapping.externalStageId}`, mapping.category]));
  const targetByUser = new Map(targets.map(target => [target.userId, target]));
  const people = new Map(mappings.map(mapping => [mapping.externalUserId, {
    externalUserId: mapping.externalUserId, name: mapping.displayName, userId: mapping.userId,
    overdueTasks: 0, staleOpportunities: 0, noNextStep: 0, pipelineAtRiskMinor: 0,
    activitiesToday: 0, wonValueThisMonthMinor: 0,
  }]));
  for (const task of tasks) {
    if (!task.ownerExternalId || !people.has(task.ownerExternalId) || !open(task.status) || !task.dueAt || task.dueAt >= now) continue;
    people.get(task.ownerExternalId)!.overdueTasks += 1;
  }
  for (const opportunity of opportunities) {
    if (!opportunity.ownerExternalId || !people.has(opportunity.ownerExternalId)) continue;
    const person = people.get(opportunity.ownerExternalId)!;
    const mappedCategory = opportunity.stage ? stageCategoryBySystemAndStage.get(`${opportunity.connectedSystemId}:${opportunity.stage}`) : undefined;
    const isWon = mappedCategory === "won" || (!mappedCategory && won(opportunity.stage));
    const isClosed = isWon || mappedCategory === "lost";
    const isStale = stale(opportunity.lastActivityAt, now);
    if (isStale && !isClosed) { person.staleOpportunities += 1; person.pipelineAtRiskMinor += opportunity.valueMinor ?? 0; }
    if (!opportunity.nextStepAt && !isClosed) person.noNextStep += 1;
    if (isWon && monthKey(opportunity.closeAt ?? opportunity.sourceUpdatedAt, membership.timezone) === nowParts.monthKey) person.wonValueThisMonthMinor += opportunity.valueMinor ?? 0;
  }
  for (const activity of activities) {
    if (!activity.ownerExternalId || !people.has(activity.ownerExternalId)) continue;
    if (dateKey(activity.occurredAt, membership.timezone) === nowParts.dateKey) people.get(activity.ownerExternalId)!.activitiesToday += 1;
  }

  const team = Array.from(people.values()).map(person => {
    const target = person.userId ? targetByUser.get(person.userId) : undefined;
    const dailyProgress = target?.dailyActivityTarget ? person.activitiesToday / target.dailyActivityTarget : null;
    const monthlyProgress = target?.monthlyWonValueTargetMinor ? person.wonValueThisMonthMinor / target.monthlyWonValueTargetMinor : null;
    const overdueBreach = Boolean(target?.maxOverdueTasks && person.overdueTasks > target.maxOverdueTasks);
    const monthlyAtRisk = monthlyProgress !== null && monthlyProgress < expectedMonthlyPace * 0.8;
    const dailyAtRisk = dailyProgress !== null && nowParts.hour >= 15 && dailyProgress < 0.8;
    const targetStatus = overdueBreach ? "needs_attention" : monthlyAtRisk || dailyAtRisk ? "at_risk" : (monthlyProgress !== null && monthlyProgress >= 1) || (dailyProgress !== null && dailyProgress >= 1) ? "strong" : "on_track";
    const exceptionScore = person.overdueTasks * 12 + person.staleOpportunities * 8 + person.noNextStep * 6 + (targetStatus === "needs_attention" ? 40 : targetStatus === "at_risk" ? 24 : 0);
    return { ...person, target: target ?? null, targetProgress: { dailyActivity: dailyProgress, monthlyWonValue: monthlyProgress, expectedMonthlyPace }, targetStatus, exceptionScore };
  }).sort((a, b) => b.exceptionScore - a.exceptionScore || b.pipelineAtRiskMinor - a.pipelineAtRiskMinor);

  const needsAttention = team.filter(person => person.exceptionScore > 0);
  return {
    generatedAt: now,
    summary: {
      mappedSalespeople: team.length,
      needsAttention: needsAttention.length,
      onTarget: team.filter(person => person.targetStatus === "on_track" || person.targetStatus === "strong").length,
      atRisk: team.filter(person => person.targetStatus === "at_risk" || person.targetStatus === "needs_attention").length,
      overdueTasks: team.reduce((sum, person) => sum + person.overdueTasks, 0),
      staleOpportunities: team.reduce((sum, person) => sum + person.staleOpportunities, 0),
      pipelineAtRiskMinor: team.reduce((sum, person) => sum + person.pipelineAtRiskMinor, 0),
      wonValueThisMonthMinor: team.reduce((sum, person) => sum + person.wonValueThisMonthMinor, 0),
    },
    people: team.slice(0, 100),
  };
}
