import { and, eq } from "drizzle-orm";
import { externalUserMappings, salesWorkItems } from "../drizzle/schema";
import { getDb } from "./db";
import type {
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./crm/types";

export type SalesWorkType =
  | "NEW_LEAD"
  | "OVERDUE_TASK"
  | "TASK_DUE"
  | "CALLBACK_DUE"
  | "OPPORTUNITY_NEEDS_ACTION"
  | "STALE_OPPORTUNITY";

type CrmResource =
  | { type: "contacts"; records: NormalizedContact[] }
  | { type: "companies"; records: NormalizedCompany[] }
  | { type: "opportunities"; records: NormalizedOpportunity[] }
  | { type: "tasks"; records: NormalizedTask[] }
  | { type: "activities"; records: NormalizedActivity[] };

export type SalesWorkCandidate = {
  sourceKey: string;
  sourceType: string;
  sourceExternalId: string;
  externalOwnerId?: string;
  contactExternalId?: string;
  companyExternalId?: string;
  opportunityExternalId?: string;
  taskExternalId?: string;
  type: SalesWorkType;
  priority: number;
  dueAt?: Date;
  reason: string;
  recommendedNextAction: string;
  sourceUpdatedAt?: Date;
  status: "open" | "completed";
  metadata: Record<string, unknown>;
};

function taskOpen(status: string) {
  return !/completed|closed|done|cancelled/i.test(status);
}

export function deriveCrmWorkCandidates(
  systemId: number,
  resource: CrmResource,
  now = new Date()
): SalesWorkCandidate[] {
  if (resource.type === "contacts")
    return resource.records.map(contact => ({
      sourceKey: `crm:${systemId}:contact:${contact.externalId}:new-lead`,
      sourceType: "crm_contact",
      sourceExternalId: contact.externalId,
      externalOwnerId: contact.ownerExternalId,
      contactExternalId: contact.externalId,
      companyExternalId: contact.companyExternalId,
      type: "NEW_LEAD",
      priority: 80,
      reason: "A new or changed CRM lead is ready for review.",
      recommendedNextAction:
        "Review the customer context and make first contact.",
      sourceUpdatedAt: contact.sourceUpdatedAt,
      status: "open",
      metadata: { lifecycleStage: contact.lifecycleStage || null },
    }));
  if (resource.type === "tasks")
    return resource.records.map(task => {
      const open = taskOpen(task.status);
      const overdue = open && Boolean(task.dueAt && task.dueAt < now);
      const callback = /callback|call back|phone/i.test(task.title);
      const type: SalesWorkType = overdue
        ? "OVERDUE_TASK"
        : callback
          ? "CALLBACK_DUE"
          : "TASK_DUE";
      return {
        sourceKey: `crm:${systemId}:task:${task.externalId}`,
        sourceType: "crm_task",
        sourceExternalId: task.externalId,
        externalOwnerId: task.ownerExternalId,
        contactExternalId: task.contactExternalId,
        opportunityExternalId: task.opportunityExternalId,
        taskExternalId: task.externalId,
        type,
        priority: overdue ? 100 : callback ? 90 : 75,
        dueAt: task.dueAt,
        reason: overdue
          ? "This CRM task is overdue."
          : callback
            ? "A promised callback is due."
            : "A CRM task is due.",
        recommendedNextAction: callback
          ? "Open the customer context and make the callback."
          : "Complete the task and verify the CRM result.",
        sourceUpdatedAt: task.sourceUpdatedAt,
        status: open ? "open" : "completed",
        metadata: { sourceStatus: task.status },
      };
    });
  if (resource.type === "opportunities")
    return resource.records
      .map(opportunity => {
        const staleDays = opportunity.lastActivityAt
          ? Math.floor(
              (now.valueOf() - opportunity.lastActivityAt.valueOf()) /
                86_400_000
            )
          : 30;
        const noNextAction = !opportunity.nextStepAt;
        if (!noNextAction && staleDays < 7) return null;
        const type: SalesWorkType = noNextAction
          ? "OPPORTUNITY_NEEDS_ACTION"
          : "STALE_OPPORTUNITY";
        return {
          sourceKey: `crm:${systemId}:opportunity:${opportunity.externalId}:attention`,
          sourceType: "crm_opportunity",
          sourceExternalId: opportunity.externalId,
          externalOwnerId: opportunity.ownerExternalId,
          contactExternalId: opportunity.contactExternalId,
          companyExternalId: opportunity.companyExternalId,
          opportunityExternalId: opportunity.externalId,
          type,
          priority: noNextAction ? 70 : 60,
          dueAt: opportunity.nextStepAt,
          reason: noNextAction
            ? "This opportunity has no recorded next action."
            : `This opportunity has had no recorded activity for ${staleDays} days.`,
          recommendedNextAction:
            "Review the opportunity and schedule the next verified action.",
          sourceUpdatedAt: opportunity.sourceUpdatedAt,
          status: "open" as const,
          metadata: {
            stage: opportunity.stage || null,
            pipeline: opportunity.pipeline || null,
            staleDays,
          },
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate)
      );
  return [];
}

export function compareSalesWork(
  a: Pick<SalesWorkCandidate, "priority" | "dueAt" | "sourceKey">,
  b: Pick<SalesWorkCandidate, "priority" | "dueAt" | "sourceKey">,
  now = new Date()
) {
  const overdue = (value?: Date) => (value && value < now ? 1 : 0);
  return (
    overdue(b.dueAt) - overdue(a.dueAt) ||
    b.priority - a.priority ||
    (a.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
      (b.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) ||
    a.sourceKey.localeCompare(b.sourceKey)
  );
}

export async function upsertSalesWorkFromCrm(input: {
  organisationId: number;
  connectedSystemId: number;
  resource: CrmResource;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const mappings = await db
    .select()
    .from(externalUserMappings)
    .where(
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(externalUserMappings.isActive, true)
      )
    );
  const usersByExternalOwner = new Map(
    mappings.map(mapping => [mapping.externalUserId, mapping.userId])
  );
  const candidates = deriveCrmWorkCandidates(
    input.connectedSystemId,
    input.resource,
    input.now
  );
  for (const candidate of candidates) {
    const salespersonUserId = candidate.externalOwnerId
      ? usersByExternalOwner.get(candidate.externalOwnerId) || null
      : null;
    const values = {
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      salespersonUserId,
      sourceKey: candidate.sourceKey,
      sourceType: candidate.sourceType,
      sourceExternalId: candidate.sourceExternalId,
      contactExternalId: candidate.contactExternalId ?? null,
      companyExternalId: candidate.companyExternalId ?? null,
      opportunityExternalId: candidate.opportunityExternalId ?? null,
      taskExternalId: candidate.taskExternalId ?? null,
      type: candidate.type,
      priority: candidate.priority,
      dueAt: candidate.dueAt ?? null,
      reason: candidate.reason,
      status: candidate.status,
      recommendedNextAction: candidate.recommendedNextAction,
      automationEligibility: "propose" as const,
      approvalRequirement: "salesperson" as const,
      freshness: "current" as const,
      sourceUpdatedAt: candidate.sourceUpdatedAt ?? null,
      syncedAt: new Date(),
      metadata: candidate.metadata,
    };
    await db
      .insert(salesWorkItems)
      .values(values)
      .onDuplicateKeyUpdate({
        set: {
          salespersonUserId,
          contactExternalId: values.contactExternalId,
          companyExternalId: values.companyExternalId,
          opportunityExternalId: values.opportunityExternalId,
          taskExternalId: values.taskExternalId,
          type: values.type,
          priority: values.priority,
          dueAt: values.dueAt,
          reason: values.reason,
          ...(input.resource.type === "tasks" ? { status: values.status } : {}),
          recommendedNextAction: values.recommendedNextAction,
          freshness: "current",
          sourceUpdatedAt: values.sourceUpdatedAt,
          syncedAt: values.syncedAt,
          metadata: values.metadata,
        },
      });
  }
  return candidates;
}
