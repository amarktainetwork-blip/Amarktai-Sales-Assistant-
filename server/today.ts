import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import {
  assistantReminders,
  callbackTasks,
  connectedSystems,
  crmContacts,
  connectorSyncJobs,
  crmOpportunities,
  crmTasks,
  externalUserMappings,
  inboundMessages,
  salesWorkItems,
} from "../drizzle/schema";
import { getDb } from "./db";
import { requireOrganisationMembership } from "./organisation";
import {
  getClientActionConfiguration,
  type ClientActionConfiguration,
} from "./clientActionConfiguration";

function dayEnd(now: Date) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}
function isOpen(status: string) {
  return !/completed|closed|done|cancelled/i.test(status);
}
function ageDays(value?: Date | null, now = new Date()) {
  return value
    ? Math.floor((now.valueOf() - value.valueOf()) / 86_400_000)
    : null;
}

function normalizedTaskTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Ordered task titles that an organisation explicitly says should drive its contact sequence. */
export function configuredTaskPriorityTitles(
  configuration: ClientActionConfiguration
) {
  const entries = Object.entries(configuration.workflows).sort(([a], [b]) => {
    if (a === "first_contact") return -1;
    if (b === "first_contact") return 1;
    return a.localeCompare(b);
  });
  const titles: string[] = [];
  for (const [, workflow] of entries) {
    for (const purpose of workflow.taskSequence) {
      const title = workflow.taskAliases[purpose]?.trim();
      if (
        title &&
        !titles.some(item => normalizedTaskTitle(item) === normalizedTaskTitle(title))
      )
        titles.push(title);
    }
  }
  return titles;
}

export function sortTasksByConfiguredPriority<
  T extends { title: string; dueAt: Date | null },
>(tasks: T[], configuredTitles: string[]) {
  const rank = new Map(
    configuredTitles.map((title, index) => [normalizedTaskTitle(title), index])
  );
  const fallback = configuredTitles.length + 1;
  return [...tasks].sort((a, b) => {
    const aRank = rank.get(normalizedTaskTitle(a.title)) ?? fallback;
    const bRank = rank.get(normalizedTaskTitle(b.title)) ?? fallback;
    return (
      aRank - bRank ||
      (a.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
        (b.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) ||
      a.title.localeCompare(b.title)
    );
  });
}

export function isCurrentActionableInbound(
  message: { needsAction: boolean; receivedAt: Date },
  now = new Date(),
  maximumAgeDays = 45
) {
  if (!message.needsAction) return false;
  const age = now.valueOf() - message.receivedAt.valueOf();
  return age >= 0 && age <= maximumAgeDays * 86_400_000;
}

export async function getTodayWork(input: {
  userId: number;
  organisationId: number;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const actionConfiguration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const taskPriorityTitles = configuredTaskPriorityTitles(actionConfiguration);
  const now = new Date();
  const [
    mappings,
    tasks,
    opportunities,
    contacts,
    syncJobs,
    inboundRows,
    reminders,
    callbacks,
    workItems,
  ] = await Promise.all([
    db
      .select()
      .from(externalUserMappings)
      .where(
        and(
          eq(externalUserMappings.organisationId, input.organisationId),
          eq(externalUserMappings.userId, input.userId),
          eq(externalUserMappings.isActive, true)
        )
      ),
    db
      .select()
      .from(crmTasks)
      .where(eq(crmTasks.organisationId, input.organisationId))
      .orderBy(desc(crmTasks.dueAt))
      .limit(600),
    db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.organisationId, input.organisationId))
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(600),
    db
      .select({ contact: crmContacts })
      .from(connectedSystems)
      .leftJoin(
        crmContacts,
        and(
          eq(crmContacts.connectedSystemId, connectedSystems.id),
          eq(crmContacts.organisationId, input.organisationId)
        )
      )
      .where(eq(connectedSystems.organisationId, input.organisationId))
      .orderBy(desc(crmContacts.createdAt))
      .limit(100),
    db
      .select()
      .from(connectorSyncJobs)
      .where(
        and(
          eq(connectorSyncJobs.organisationId, input.organisationId),
          eq(connectorSyncJobs.resourceType, "crm_reconciliation")
        )
      )
      .orderBy(desc(connectorSyncJobs.lastSucceededAt))
      .limit(20),
    db
      .select({
        message: inboundMessages,
        contactOwnerExternalId: crmContacts.ownerExternalId,
      })
      .from(inboundMessages)
      .leftJoin(
        crmContacts,
        and(
          eq(crmContacts.organisationId, inboundMessages.organisationId),
          eq(crmContacts.connectedSystemId, inboundMessages.connectedSystemId),
          eq(crmContacts.externalId, inboundMessages.contactExternalId)
        )
      )
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.needsAction, true)
        )
      )
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(100),
    db
      .select()
      .from(assistantReminders)
      .where(
        and(
          eq(assistantReminders.organisationId, input.organisationId),
          eq(assistantReminders.userId, input.userId),
          or(
            eq(assistantReminders.status, "open"),
            eq(assistantReminders.status, "snoozed")
          ),
          lte(assistantReminders.dueAt, dayEnd(now))
        )
      )
      .orderBy(desc(assistantReminders.dueAt))
      .limit(100),
    db
      .select()
      .from(callbackTasks)
      .where(
        and(
          eq(callbackTasks.organisationId, input.organisationId),
          eq(callbackTasks.userId, input.userId),
          eq(callbackTasks.state, "open"),
          lte(callbackTasks.dueAt, dayEnd(now))
        )
      )
      .orderBy(desc(callbackTasks.dueAt))
      .limit(100),
    db
      .select()
      .from(salesWorkItems)
      .where(
        and(
          eq(salesWorkItems.organisationId, input.organisationId),
          or(
            eq(salesWorkItems.status, "open"),
            eq(salesWorkItems.status, "in_progress"),
            and(
              eq(salesWorkItems.status, "snoozed"),
              or(
                isNull(salesWorkItems.snoozedUntil),
                lte(salesWorkItems.snoozedUntil, now)
              )
            ),
            eq(salesWorkItems.status, "blocked")
          )
        )
      )
      .orderBy(desc(salesWorkItems.priority), desc(salesWorkItems.updatedAt))
      .limit(500),
  ]);
  const ownerIds = new Set(mappings.map(mapping => mapping.externalUserId));
  const belongsToUser = (ownerExternalId: string | null) =>
    ownerIds.has(ownerExternalId ?? "");
  const scopedTasks = tasks.filter(task => belongsToUser(task.ownerExternalId));
  const scopedOpportunities = opportunities.filter(opportunity =>
    belongsToUser(opportunity.ownerExternalId)
  );
  const newestLeads = contacts
    .map(row => row.contact)
    .filter((contact): contact is NonNullable<typeof contact> =>
      Boolean(contact)
    )
    .filter(contact => belongsToUser(contact.ownerExternalId))
    .slice(0, 20);
  const openTasks = scopedTasks.filter(task => isOpen(task.status));
  const overdueTasks = sortTasksByConfiguredPriority(
    openTasks.filter(task => task.dueAt && task.dueAt < now),
    taskPriorityTitles
  );
  const dueToday = sortTasksByConfiguredPriority(
    openTasks.filter(
      task => task.dueAt && task.dueAt >= now && task.dueAt <= dayEnd(now)
    ),
    taskPriorityTitles
  );
  const staleOpportunities = scopedOpportunities.filter(opportunity => {
    const age = ageDays(opportunity.lastActivityAt, now);
    return age === null || age >= 7;
  });
  const noNextStep = scopedOpportunities.filter(
    opportunity => !opportunity.nextStepAt
  );
  const actionableInbound = inboundRows
    .filter(row => {
      if (row.message.mailboxUserId != null)
        return row.message.mailboxUserId === input.userId;
      return belongsToUser(row.contactOwnerExternalId);
    })
    .map(row => row.message);
  const currentInbound = actionableInbound.filter(message =>
    isCurrentActionableInbound(message, now)
  );
  const assignedWork = workItems
    .filter(item => item.salespersonUserId === input.userId)
    .sort((a, b) => {
      const overdue = (value: Date | null) => (value && value < now ? 1 : 0);
      return (
        overdue(b.dueAt) - overdue(a.dueAt) ||
        b.priority - a.priority ||
        (a.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
          (b.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) ||
        a.sourceKey.localeCompare(b.sourceKey)
      );
    });
  const priority = scopedOpportunities
    .map(opportunity => {
      const staleDays = ageDays(opportunity.lastActivityAt, now) ?? 14;
      const overdue = opportunity.nextStepAt
        ? opportunity.nextStepAt < now
        : false;
      const dueTasks = openTasks.filter(
        task =>
          task.opportunityExternalId === opportunity.externalId &&
          task.dueAt &&
          task.dueAt <= dayEnd(now)
      );
      const inboundForContact = currentInbound.filter(
        message =>
          message.contactExternalId &&
          message.contactExternalId === opportunity.contactExternalId
      );
      const score =
        Math.min(45, staleDays * 4) +
        (overdue ? 25 : 0) +
        (!opportunity.nextStepAt ? 18 : 0) +
        (dueTasks.length ? 30 : 0) +
        (inboundForContact.length ? 30 : 0) +
        Math.min(12, Math.floor((opportunity.valueMinor ?? 0) / 100_000));
      const reasons = [
        dueTasks.some(task => task.dueAt && task.dueAt < now)
          ? "CRM task / Manual Action overdue"
          : dueTasks.length
            ? "CRM task / callback due today"
            : null,
        inboundForContact.length ? "Actionable inbound reply" : null,
        overdue ? "Next step is overdue" : null,
        !opportunity.nextStepAt ? "No next step" : null,
        staleDays >= 7 ? `No activity for ${staleDays} days` : null,
      ].filter((reason): reason is string => Boolean(reason));
      return { ...opportunity, priorityScore: score, reasons, staleDays };
    })
    .filter(item => item.reasons.length)
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        (b.valueMinor ?? 0) - (a.valueMinor ?? 0)
    )
    .slice(0, 20);
  return {
    generatedAt: now,
    freshness: {
      status: syncJobs.some(job => job.status === "error")
        ? "attention"
        : syncJobs.some(job => job.lastSucceededAt)
          ? "synchronized"
          : "not_synchronized",
      lastSuccessfulAt:
        syncJobs.find(job => job.lastSucceededAt)?.lastSucceededAt ?? null,
    },
    role: membership.role,
    requiresOwnerMapping: ownerIds.size === 0,
    metrics: {
      dueToday: dueToday.length + reminders.length + callbacks.length,
      overdue: overdueTasks.length,
      staleOpportunities: staleOpportunities.length,
      noNextStep: noNextStep.length,
      priorityRecords: priority.length,
      inboundNeedsAction: currentInbound.length,
      remindersDue: reminders.length,
      callbacksDue: callbacks.length,
      newLeads: newestLeads.length,
      workItems: assignedWork.length,
    },
    queues: {
      dueToday: dueToday.slice(0, 12),
      overdueTasks: overdueTasks.slice(0, 12),
      inbound: currentInbound.slice(0, 20),
      reminders: reminders.slice(0, 20),
      callbacks: callbacks.slice(0, 20),
      priority,
      newLeads: newestLeads,
      work: assignedWork.slice(0, 100),
    },
  };
}
