import { getTodayTaskData } from "./todayTaskData";
import { getOrganisationWorkspaceContext } from "./organisationWorkspace";
import { isIncompleteTask } from "../shared/taskState";
import { normalizedCustomerAttributes, personalOwnerSql } from "./customerData";
import { deriveCustomerInterest } from "./customerInterest";
import { buildTodayCallQueue, unrepresentedTodayTasks } from "./todayCallQueue";
import { opportunityIsHistorical } from "./crm/actionExecutionPreconditions";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import {
  actionProposals,
  assistantReminders,
  callbackTasks,
  connectedSystems,
  crmActivities,
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

function isOpen(status: string) {
  return isIncompleteTask(status);
}
function ageDays(value?: Date | null, now = new Date()) {
  return value
    ? Math.floor((now.valueOf() - value.valueOf()) / 86_400_000)
    : null;
}

function normalizedTaskTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function salespersonActivityProvesTaskHandled(
  activity: {
    activityType: string;
    ownerExternalId: string | null;
    occurredAt: Date;
    raw: unknown;
  },
  ownerExternalId: string,
  ownerEmail?: string | null
) {
  if (activity.ownerExternalId !== ownerExternalId) return false;
  const type = String(activity.activityType || "").toLowerCase();
  const raw =
    activity.raw &&
    typeof activity.raw === "object" &&
    !Array.isArray(activity.raw)
      ? (activity.raw as Record<string, unknown>)
      : {};
  if (type === "call") return true;
  if (type === "note")
    return String(raw.authorExternalId || "").trim() === ownerExternalId.trim();
  if (!["email", "sms", "whatsapp", "communication"].includes(type))
    return false;
  if (String(raw.direction || "").toLowerCase() !== "outbound") return false;

  const actorExternalId = String(raw.userExternalId || "").trim();
  if (actorExternalId && actorExternalId === ownerExternalId.trim())
    return true;

  const email = String(ownerEmail || "")
    .trim()
    .toLowerCase();
  const sender = String(raw.senderReference || "")
    .trim()
    .toLowerCase();
  return Boolean(
    type === "email" &&
      email &&
      sender &&
      (sender === email ||
        sender.includes(`<${email}>`) ||
        sender.endsWith(` ${email}`))
  );
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
        !titles.some(
          item => normalizedTaskTitle(item) === normalizedTaskTitle(title)
        )
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

/** Read-only work queue. CRM stage labels are not payment confirmation. */
export function paymentReviewCandidates<T extends { stage: string | null }>(
  scopedOpportunities: T[],
  review: ClientActionConfiguration["paymentReview"]
) {
  if (!review?.enabled) return [];
  const pending = new Set(review.pendingStages.map(normalizedTaskTitle));
  return scopedOpportunities.filter(
    item => item.stage && pending.has(normalizedTaskTitle(item.stage))
  );
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
  const workspace = await getOrganisationWorkspaceContext(input.organisationId);
  const pendingTaskReviewRows = await db
    .select({ payload: actionProposals.payload })
    .from(actionProposals)
    .where(
      and(
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.actionType, "complete_active_task"),
        inArray(actionProposals.state, ["review_required", "approved"])
      )
    );
  const pendingTaskExternalIds = Array.from(
    new Set(
      pendingTaskReviewRows
        .map(row => String(row.payload?.taskExternalId || "").trim())
        .filter(Boolean)
    )
  );
  const taskData = await getTodayTaskData({
    ...input,
    now,
    timezone: workspace.organisation.timezone,
    priorityTitles: taskPriorityTitles,
    backlogPolicy: workspace.backlogPolicy,
    excludeExternalIds: pendingTaskExternalIds,
  });
  const localDayEnd = new Date(taskData.bounds.endExclusive.getTime() - 1);
  const [
    mappings,
    opportunities,
    syncJobs,
    inboundRows,
    reminders,
    futureCommitments,
    futureCrmTasks,
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
      .from(crmOpportunities)
      .where(
        and(
          eq(crmOpportunities.organisationId, input.organisationId),
          personalOwnerSql(
            input,
            crmOpportunities.connectedSystemId,
            crmOpportunities.ownerExternalId
          )
        )
      )
      .orderBy(desc(crmOpportunities.updatedAt))
      .limit(600),
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
          eq(inboundMessages.needsAction, true),
          or(
            eq(inboundMessages.mailboxUserId, input.userId),
            and(
              isNull(inboundMessages.mailboxUserId),
              personalOwnerSql(
                input,
                crmContacts.connectedSystemId,
                crmContacts.ownerExternalId
              )
            )
          )
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
          lte(assistantReminders.dueAt, localDayEnd)
        )
      )
      .orderBy(desc(assistantReminders.dueAt))
      .limit(100),
    db
      .select()
      .from(assistantReminders)
      .where(
        and(
          eq(assistantReminders.organisationId, input.organisationId),
          eq(assistantReminders.userId, input.userId),
          eq(assistantReminders.source, "call_commitment"),
          or(
            eq(assistantReminders.status, "open"),
            eq(assistantReminders.status, "snoozed")
          ),
          gt(assistantReminders.dueAt, localDayEnd)
        )
      )
      .orderBy(desc(assistantReminders.dueAt))
      .limit(200),
    db
      .select()
      .from(crmTasks)
      .where(
        and(
          eq(crmTasks.organisationId, input.organisationId),
          personalOwnerSql(
            input,
            crmTasks.connectedSystemId,
            crmTasks.ownerExternalId
          ),
          gt(crmTasks.dueAt, localDayEnd)
        )
      )
      .orderBy(asc(crmTasks.dueAt))
      .limit(100),
    db
      .select()
      .from(callbackTasks)
      .where(
        and(
          eq(callbackTasks.organisationId, input.organisationId),
          eq(callbackTasks.userId, input.userId),
          eq(callbackTasks.state, "open"),
          lte(callbackTasks.dueAt, localDayEnd)
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
          eq(salesWorkItems.salespersonUserId, input.userId),
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
  const ownerIds = new Set(
    mappings
      .filter(mapping => mapping.connectedSystemId && mapping.externalUserId)
      .map(mapping => `${mapping.connectedSystemId}:${mapping.externalUserId}`)
  );
  const belongsToUser = (
    ownerExternalId: string | null,
    connectedSystemId: number | null
  ) =>
    Boolean(
      ownerExternalId &&
        connectedSystemId &&
        ownerIds.has(`${connectedSystemId}:${ownerExternalId}`)
    );
  const futureCommitmentContacts = new Set(
    futureCommitments
      .map(item => item.contactExternalId?.trim())
      .filter((value): value is string => Boolean(value))
  );
  const currentTask = <T extends { contactExternalId: string | null }>(
    task: T
  ) =>
    !task.contactExternalId ||
    !futureCommitmentContacts.has(task.contactExternalId);

  const taskContactExternalIds = Array.from(
    new Set(
      [
        ...taskData.queues.overdueTasks,
        ...taskData.queues.dueToday,
        ...reminders,
      ]
        .map(item => item.contactExternalId?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  const recentTaskActivities = taskContactExternalIds.length
    ? await db
        .select({
          connectedSystemId: crmActivities.connectedSystemId,
          contactExternalId: crmActivities.contactExternalId,
          ownerExternalId: crmActivities.ownerExternalId,
          activityType: crmActivities.activityType,
          occurredAt: crmActivities.occurredAt,
          raw: crmActivities.raw,
        })
        .from(crmActivities)
        .where(
          and(
            eq(crmActivities.organisationId, input.organisationId),
            inArray(crmActivities.contactExternalId, taskContactExternalIds)
          )
        )
        .orderBy(desc(crmActivities.occurredAt))
        .limit(5000)
    : [];
  const ownerEmailBySystemAndOwner = new Map(
    mappings.map(mapping => [
      `${mapping.connectedSystemId}:${mapping.externalUserId}`,
      mapping.email,
    ])
  );
  const taskWasAlreadyWorked = (
    task: (typeof taskData.queues.overdueTasks)[number]
  ) => {
    if (!task.contactExternalId || !task.ownerExternalId || !task.dueAt)
      return false;
    const ownerEmail =
      ownerEmailBySystemAndOwner.get(
        `${task.connectedSystemId}:${task.ownerExternalId}`
      ) || null;
    return recentTaskActivities.some(
      activity =>
        activity.connectedSystemId === task.connectedSystemId &&
        activity.contactExternalId === task.contactExternalId &&
        activity.occurredAt >= task.dueAt! &&
        salespersonActivityProvesTaskHandled(
          activity,
          task.ownerExternalId!,
          ownerEmail
        )
    );
  };
  const reminderWasAlreadyWorked = (
    reminder: (typeof reminders)[number]
  ) => {
    if (!reminder.contactExternalId || !reminder.dueAt) return false;
    return recentTaskActivities.some(activity => {
      if (
        activity.contactExternalId !== reminder.contactExternalId ||
        activity.occurredAt < reminder.dueAt ||
        !activity.ownerExternalId ||
        !belongsToUser(activity.ownerExternalId, activity.connectedSystemId)
      )
        return false;
      const ownerEmail =
        ownerEmailBySystemAndOwner.get(
          `${activity.connectedSystemId}:${activity.ownerExternalId}`
        ) || null;
      return salespersonActivityProvesTaskHandled(
        activity,
        activity.ownerExternalId,
        ownerEmail
      );
    });
  };
  const currentReminders = reminders.filter(
    reminder => !reminderWasAlreadyWorked(reminder)
  );
  const overdueTasks = taskData.queues.overdueTasks.filter(
    task => currentTask(task) && !taskWasAlreadyWorked(task)
  );
  const dueToday = taskData.queues.dueToday.filter(
    task => currentTask(task) && !taskWasAlreadyWorked(task)
  );
  const unscheduledTasks = taskData.queues.unscheduled.filter(currentTask);
  const scopedTasks = [...overdueTasks, ...dueToday, ...unscheduledTasks];
  const scopedOpportunities = opportunities.filter(
    opportunity =>
      belongsToUser(
        opportunity.ownerExternalId,
        opportunity.connectedSystemId
      ) &&
      !opportunityIsHistorical({
        stage: opportunity.stage || undefined,
        raw: opportunity.raw,
      })
  );
  const openTasks = scopedTasks.filter(task => isOpen(task.status));
  const upcomingTasks = futureCrmTasks
    .filter(task => isOpen(task.status) && Boolean(task.dueAt))
    .slice(0, 20);
  const upcomingCommitments = [
    ...upcomingTasks.map(task => ({
      id: `crm-task:${task.connectedSystemId}:${task.externalId}`,
      kind: "crm_task" as const,
      contactExternalId: task.contactExternalId,
      title: task.title,
      dueAt: task.dueAt!,
    })),
    ...futureCommitments.map(reminder => ({
      id: `reminder:${reminder.id}`,
      kind: "reminder" as const,
      contactExternalId: reminder.contactExternalId,
      title: reminder.title,
      dueAt: reminder.dueAt,
    })),
  ]
    .sort((a, b) => a.dueAt.valueOf() - b.dueAt.valueOf())
    .slice(0, 8);
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
      return belongsToUser(
        row.contactOwnerExternalId,
        row.message.connectedSystemId
      );
    })
    .map(row => row.message);
  const currentInbound = actionableInbound.filter(message =>
    isCurrentActionableInbound(message, now)
  );

  const newLeadWork = workItems.filter(
    item =>
      item.salespersonUserId === input.userId &&
      item.type === "NEW_LEAD" &&
      ["open", "in_progress"].includes(item.status) &&
      item.connectedSystemId &&
      item.contactExternalId &&
      !futureCommitmentContacts.has(item.contactExternalId)
  );

  const workContactExternalIds = Array.from(
    new Set(
      [
        ...overdueTasks.map(task => task.contactExternalId),
        ...dueToday.map(task => task.contactExternalId),
        ...currentInbound.map(message => message.contactExternalId),
        ...currentReminders.map(reminder => reminder.contactExternalId),
        ...newLeadWork.map(item => item.contactExternalId),
      ].filter((value): value is string => Boolean(value))
    )
  );
  const workContacts = workContactExternalIds.length
    ? await db
        .select({
          id: crmContacts.id,
          connectedSystemId: crmContacts.connectedSystemId,
          externalId: crmContacts.externalId,
          firstName: crmContacts.firstName,
          lastName: crmContacts.lastName,
          email: crmContacts.email,
          phone: crmContacts.phone,
          lifecycleStage: crmContacts.lifecycleStage,
          raw: crmContacts.raw,
        })
        .from(crmContacts)
        .where(
          and(
            eq(crmContacts.organisationId, input.organisationId),
            inArray(crmContacts.externalId, workContactExternalIds),
            personalOwnerSql(
              input,
              crmContacts.connectedSystemId,
              crmContacts.ownerExternalId
            )
          )
        )
    : [];

  const enrichedWorkContacts = workContacts.map(contact => {
    const interest = deriveCustomerInterest({
      mappings: workspace.customerFieldMappings,
      attributes: normalizedCustomerAttributes(contact.raw),
    });
    return {
      ...contact,
      raw: undefined,
      courseInterest: interest.primary,
      interestValues: interest.values,
      tags: interest.tags,
    };
  });
  const callQueue = buildTodayCallQueue({
    now,
    newLeads: newLeadWork.map(item => ({
      workItemId: item.id,
      connectedSystemId: item.connectedSystemId!,
      contactExternalId: item.contactExternalId!,
      createdAt: item.createdAt,
    })),
    overdueTasks,
    dueToday,
    inbound: currentInbound,
    reminders: currentReminders.map(reminder => ({
      id: reminder.id,
      contactExternalId: reminder.contactExternalId,
      title: reminder.title,
      dueAt: reminder.dueAt,
      source: reminder.source,
    })),
    contacts: enrichedWorkContacts,
  });
  const newLeadQueue = callQueue.filter(item => item.workItemIds.length > 0);
  const unlinkedTaskIds = new Set(
    unrepresentedTodayTasks(callQueue, [...overdueTasks, ...dueToday]).map(
      task => task.id
    )
  );
  const assignedTaskExceptions = [...overdueTasks, ...dueToday]
    .filter(task => unlinkedTaskIds.has(task.id))
    .map(task => {
      const raw =
        task.raw && typeof task.raw === "object" && !Array.isArray(task.raw)
          ? (task.raw as Record<string, unknown>)
          : {};
      const detail =
        typeof raw.description === "string" && raw.description.trim()
          ? raw.description.trim().slice(0, 500)
          : null;
      return {
        id: task.id,
        connectedSystemId: task.connectedSystemId,
        externalId: task.externalId,
        contactExternalId: task.contactExternalId,
        title: task.title,
        detail,
        dueAt: task.dueAt,
        status: task.status,
        reason:
          task.dueAt && task.dueAt < now
            ? ("Overdue assigned task" as const)
            : ("Assigned task due today" as const),
      };
    });

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
          task.connectedSystemId === opportunity.connectedSystemId &&
          task.dueAt &&
          task.dueAt <= localDayEnd
      );
      const inboundForContact = currentInbound.filter(
        message =>
          message.contactExternalId &&
          message.connectedSystemId === opportunity.connectedSystemId &&
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
  const visibleTaskData = {
    ...taskData,
    metrics: {
      ...taskData.metrics,
      overdue: overdueTasks.length,
      dueToday: dueToday.length,
    },
    queues: {
      ...taskData.queues,
      overdueTasks,
      dueToday,
      unscheduled: unscheduledTasks,
    },
  };

  return {
    generatedAt: now,
    workspace,
    taskData: visibleTaskData,
    freshness: {
      status: syncJobs.some(job => job.status === "error")
        ? "attention"
        : syncJobs.some(job => job.lastSucceededAt)
          ? "synchronized"
          : "not_synchronized",
      lastSuccessfulAt:
        syncJobs.find(job => job.lastSucceededAt)?.lastSucceededAt ?? null,
    },
    paymentReview: {
      enabled: actionConfiguration.paymentReview?.enabled === true,
      status: "manual_source_check_required" as const,
      candidates: paymentReviewCandidates(
        scopedOpportunities,
        actionConfiguration.paymentReview
      ).map(item => ({
        id: item.id,
        connectedSystemId: item.connectedSystemId,
        externalId: item.externalId,
        contactExternalId: item.contactExternalId,
        name: item.name,
        stage: item.stage,
      })),
    },
    role: membership.role,
    requiresOwnerMapping: ownerIds.size === 0,
    metrics: {
      dueToday:
        dueToday.length + currentReminders.length + callbacks.length,
      overdue: overdueTasks.length,
      staleOpportunities: staleOpportunities.length,
      noNextStep: noNextStep.length,
      priorityRecords: priority.length,
      inboundNeedsAction: currentInbound.length,
      remindersDue: currentReminders.length,
      callbacksDue: callbacks.length,
      awaitingTaskReview: pendingTaskExternalIds.length,
      newLeads: newLeadQueue.length,
      workItems: assignedWork.length,
      callQueue: callQueue.length,
      assignedTaskExceptions: assignedTaskExceptions.length,
    },
    queues: {
      dueToday: dueToday.slice(0, 12),
      overdueTasks: overdueTasks.slice(0, 12),
      inbound: currentInbound.slice(0, 20),
      reminders: currentReminders.slice(0, 20),
      callbacks: callbacks.slice(0, 20),
      priority,
      callQueue,
      newLeads: newLeadQueue,
      assignedTaskExceptions,
      upcoming: upcomingCommitments,
      work: assignedWork.slice(0, 100),
    },
  };
}
