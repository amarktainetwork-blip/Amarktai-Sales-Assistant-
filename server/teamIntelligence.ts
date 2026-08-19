import { and, eq } from "drizzle-orm";
import { crmOpportunities, crmTasks, externalUserMappings } from "../drizzle/schema";
import { getDb } from "./db";
import { canViewTeamData, requireOrganisationMembership } from "./organisation";

function open(status: string) { return !/completed|closed|done|cancelled/i.test(status); }
function stale(lastActivityAt: Date | null, now: Date) { return !lastActivityAt || now.valueOf() - lastActivityAt.valueOf() >= 7 * 86_400_000; }

export async function getTeamIntelligence(input: { userId: number; organisationId: number }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!canViewTeamData(membership.role)) throw new Error("Team Intelligence is available to organisation owners, managers, and auditors only.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const [mappings, tasks, opportunities] = await Promise.all([
    db.select().from(externalUserMappings).where(and(eq(externalUserMappings.organisationId, input.organisationId), eq(externalUserMappings.isActive, true))),
    db.select().from(crmTasks).where(eq(crmTasks.organisationId, input.organisationId)).limit(1000),
    db.select().from(crmOpportunities).where(eq(crmOpportunities.organisationId, input.organisationId)).limit(1000),
  ]);
  const people = new Map(mappings.map(mapping => [mapping.externalUserId, { externalUserId: mapping.externalUserId, name: mapping.displayName, userId: mapping.userId, overdueTasks: 0, staleOpportunities: 0, noNextStep: 0, pipelineAtRiskMinor: 0 }]));
  for (const task of tasks) {
    if (!task.ownerExternalId || !people.has(task.ownerExternalId) || !open(task.status) || !task.dueAt || task.dueAt >= now) continue;
    people.get(task.ownerExternalId)!.overdueTasks += 1;
  }
  for (const opportunity of opportunities) {
    if (!opportunity.ownerExternalId || !people.has(opportunity.ownerExternalId)) continue;
    const person = people.get(opportunity.ownerExternalId)!;
    const isStale = stale(opportunity.lastActivityAt, now);
    if (isStale) { person.staleOpportunities += 1; person.pipelineAtRiskMinor += opportunity.valueMinor ?? 0; }
    if (!opportunity.nextStepAt) person.noNextStep += 1;
  }
  const team = Array.from(people.values()).map(person => ({ ...person, exceptionScore: person.overdueTasks * 12 + person.staleOpportunities * 8 + person.noNextStep * 6 })).sort((a, b) => b.exceptionScore - a.exceptionScore || b.pipelineAtRiskMinor - a.pipelineAtRiskMinor);
  const needsAttention = team.filter(person => person.exceptionScore > 0);
  return { generatedAt: now, summary: { mappedSalespeople: team.length, needsAttention: needsAttention.length, overdueTasks: team.reduce((sum, person) => sum + person.overdueTasks, 0), staleOpportunities: team.reduce((sum, person) => sum + person.staleOpportunities, 0), pipelineAtRiskMinor: team.reduce((sum, person) => sum + person.pipelineAtRiskMinor, 0) }, people: team.slice(0, 50) };
}
