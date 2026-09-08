import { and, eq, sql } from "drizzle-orm";
import {
  crmTasks,
  externalUserMappings,
  inboundMessages,
  organisations,
  salesWorkItems,
} from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import { evaluateStoredAutomationPolicy } from "./automationPolicyEvaluator";
import { canViewTeamData, requireOrganisationMembership } from "./organisation";
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

export type ContactBaselineSemantics = {
  baselineComplete: boolean;
  existingExternalIds: ReadonlySet<string>;
};

export type SalesWorkAction =
  | "start"
  | "open_context"
  | "snooze"
  | "reschedule"
  | "complete"
  | "block";
type SalesWorkStatus =
  | "open"
  | "in_progress"
  | "snoozed"
  | "completed"
  | "blocked";

export function nextSalesWorkStatus(
  current: string,
  action: SalesWorkAction
): SalesWorkStatus {
  if (action === "open_context") {
    if (
      ["open", "in_progress", "snoozed", "completed", "blocked"].includes(
        current
      )
    )
      return current as SalesWorkStatus;
    throw new Error(`WORK_ITEM_TRANSITION_INVALID:${current}:${action}`);
  }
  if (action === "start") {
    if (["open", "snoozed", "blocked", "in_progress"].includes(current))
      return "in_progress" as const;
  }
  if (action === "snooze") {
    if (["open", "in_progress", "snoozed"].includes(current))
      return "snoozed" as const;
  }
  if (action === "reschedule") {
    if (["open", "in_progress", "snoozed"].includes(current))
      return current === "in_progress" ? "in_progress" : ("open" as const);
  }
  if (action === "complete" && current === "completed")
    return "completed" as const;
  if (
    action === "complete" &&
    ["open", "in_progress", "snoozed"].includes(current)
  )
    return "completed" as const;
  if (action === "block" && current !== "completed") return "blocked" as const;
  throw new Error(`WORK_ITEM_TRANSITION_INVALID:${current}:${action}`);
}

function explicitNewContact(record: NormalizedContact) {
  const event = String(
    record.raw.eventType || record.raw.event || record.raw.changeType || ""
  ).toLowerCase();
  return (
    record.raw.isNew === true ||
    ["created", "contact.created", "lead.created", "new_lead"].includes(event)
  );
}

function taskOpen(status: string) {
  return !/completed|closed|done|cancelled/i.test(status);
}

export function deriveCrmWorkCandidates(
  systemId: number,
  resource: CrmResource,
  now = new Date(),
  contactBaseline?: ContactBaselineSemantics
): SalesWorkCandidate[] {
  if (resource.type === "contacts")
    return resource.records
      .filter(
        contact =>
          explicitNewContact(contact) ||
          (contactBaseline?.baselineComplete === true &&
            !contactBaseline.existingExternalIds.has(contact.externalId))
      )
      .map(contact => ({
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
        metadata: {
          lifecycleStage: contact.lifecycleStage || null,
          sourceTrigger: explicitNewContact(contact)
            ? "provider_new_contact_event"
            : "newly_observed_after_baseline",
        },
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
  contactBaseline?: ContactBaselineSemantics;
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
    input.now,
    input.contactBaseline
  );
  const organisation = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  const storedPolicy = (organisation?.settings as Record<string, unknown>)
    ?.automationPolicy;
  for (const candidate of candidates) {
    const salespersonUserId = candidate.externalOwnerId
      ? usersByExternalOwner.get(candidate.externalOwnerId) || null
      : null;
    const monitorKey =
      candidate.type === "NEW_LEAD"
        ? "new_leads"
        : candidate.type === "CALLBACK_DUE"
          ? "callbacks"
          : candidate.type.includes("OPPORTUNITY")
            ? "opportunities"
            : candidate.type === "OVERDUE_TASK"
              ? "overdue_tasks"
              : "task_changes";
    const triggerKey =
      candidate.type === "NEW_LEAD"
        ? "new_lead"
        : candidate.type === "CALLBACK_DUE"
          ? "callback_due"
          : candidate.type.includes("OPPORTUNITY")
            ? "opportunity_stalled"
            : candidate.type === "OVERDUE_TASK"
              ? "overdue_task"
              : "field_or_stage_change";
    const evaluationContext = {
      actionType: "work_item",
      monitorKey,
      triggerKey,
      userId: salespersonUserId,
      pipelineId:
        typeof candidate.metadata.pipeline === "string"
          ? candidate.metadata.pipeline
          : undefined,
      leadSource:
        typeof candidate.metadata.leadSource === "string"
          ? candidate.metadata.leadSource
          : undefined,
      attributes: candidate.metadata,
      now: input.now,
      manual: false,
    } as const;
    const triggerPolicy = evaluateStoredAutomationPolicy(storedPolicy, {
      ...evaluationContext,
      phase: "trigger",
    });
    const policy = triggerPolicy.allowedToCreate
      ? evaluateStoredAutomationPolicy(storedPolicy, {
          ...evaluationContext,
          phase: "work",
        })
      : triggerPolicy;
    const policyStatus =
      candidate.status === "completed"
        ? "completed"
        : ["OUTSIDE_SCHEDULE", "QUIET_HOURS"].includes(policy.outcome)
          ? "snoozed"
          : policy.allowedToCreate
            ? "open"
            : "blocked";
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
      status: policyStatus as "open" | "snoozed" | "completed" | "blocked",
      completedAt: policyStatus === "completed" ? new Date() : null,
      recommendedNextAction: candidate.recommendedNextAction,
      automationEligibility: policy.mayExecute
        ? ("automatic" as const)
        : policy.allowedToCreate
          ? ("propose" as const)
          : ("disabled" as const),
      approvalRequirement: policy.approvalMode,
      freshness: "current" as const,
      sourceUpdatedAt: candidate.sourceUpdatedAt ?? null,
      syncedAt: new Date(),
      metadata: {
        ...candidate.metadata,
        automationPolicyOutcome: policy.outcome,
        monitorKey,
        triggerKey,
      },
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
          ...(input.resource.type === "tasks"
            ? { completedAt: values.completedAt }
            : {}),
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

type SalesWorkRow = typeof salesWorkItems.$inferSelect;

export function canUserOperateSalesWorkItem(
  role: string,
  userId: number,
  salespersonUserId: number | null
) {
  return canViewTeamData(
    role as "owner" | "manager" | "salesperson" | "auditor"
  )
    ? role !== "auditor"
    : salespersonUserId === userId;
}

export function isSalesWorkTransitionReplay(
  lastTransitionKey: string | null | undefined,
  requestedTransitionKey: string | null | undefined
) {
  return Boolean(
    requestedTransitionKey && lastTransitionKey === requestedTransitionKey
  );
}

function workContext(item: SalesWorkRow) {
  return {
    route: item.connectedSystemId
      ? `/crm/${item.connectedSystemId}`
      : "/customers",
    connectedSystemId: item.connectedSystemId,
    contactExternalId: item.contactExternalId,
    companyExternalId: item.companyExternalId,
    opportunityExternalId: item.opportunityExternalId,
    taskExternalId: item.taskExternalId,
  };
}

async function requireAuthoritativeCompletion(input: {
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  item: SalesWorkRow;
  explicitHandled?: boolean;
}) {
  if (input.item.sourceType === "crm_task" && input.item.taskExternalId) {
    const task = (
      await input.db
        .select({ status: crmTasks.status })
        .from(crmTasks)
        .where(
          and(
            eq(crmTasks.organisationId, input.item.organisationId),
            eq(crmTasks.connectedSystemId, input.item.connectedSystemId!),
            eq(crmTasks.externalId, input.item.taskExternalId)
          )
        )
        .limit(1)
    )[0];
    if (!task || taskOpen(task.status))
      throw new Error(
        "Complete this task in the CRM first, then refresh Amarktai so the verified CRM result can close it here."
      );
    return;
  }
  if (input.item.sourceType === "inbound_message") {
    const message = (
      await input.db
        .select()
        .from(inboundMessages)
        .where(
          and(
            eq(inboundMessages.organisationId, input.item.organisationId),
            eq(inboundMessages.externalMessageId, input.item.sourceExternalId)
          )
        )
        .limit(1)
    )[0];
    if (!message) throw new Error("The source message is no longer available.");
    if (message.needsAction && input.explicitHandled !== true)
      throw new Error(
        "Confirm that this message was handled before completing the work item."
      );
    if (message.needsAction)
      await input.db
        .update(inboundMessages)
        .set({ needsAction: false, status: "archived" })
        .where(eq(inboundMessages.id, message.id));
    return;
  }
  if (input.explicitHandled !== true)
    throw new Error(
      "Confirm that the recommended action was handled before completing this work item."
    );
}

export async function transitionSalesWorkItem(input: {
  userId: number;
  organisationId: number;
  workItemId: number;
  action: SalesWorkAction;
  dueAt?: Date;
  reason?: string;
  explicitHandled?: boolean;
  transitionKey?: string;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const item = (
    await db
      .select()
      .from(salesWorkItems)
      .where(
        and(
          eq(salesWorkItems.id, input.workItemId),
          eq(salesWorkItems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!item) throw new Error("Sales work item was not found.");
  if (
    input.action === "open_context" &&
    (canViewTeamData(membership.role) ||
      item.salespersonUserId === input.userId)
  )
    return { item, context: workContext(item) };
  if (
    !canUserOperateSalesWorkItem(
      membership.role,
      input.userId,
      item.salespersonUserId
    )
  )
    throw new Error("This sales work item is assigned to another salesperson.");
  if (isSalesWorkTransitionReplay(item.lastTransitionKey, input.transitionKey))
    return { item, context: workContext(item), idempotent: true };

  const status = nextSalesWorkStatus(item.status, input.action);
  const now = new Date();
  if (["snooze", "reschedule"].includes(input.action) && !input.dueAt)
    throw new Error("Choose when this work should return to the queue.");
  if (input.action === "snooze" && input.dueAt!.valueOf() <= now.valueOf())
    throw new Error("Choose a future time for snoozed work.");
  if (input.action === "complete")
    await requireAuthoritativeCompletion({
      db,
      item,
      explicitHandled: input.explicitHandled,
    });

  await db
    .update(salesWorkItems)
    .set({
      status,
      salespersonUserId:
        input.action === "start" && item.salespersonUserId == null
          ? input.userId
          : item.salespersonUserId,
      startedAt:
        input.action === "start" && !item.startedAt ? now : item.startedAt,
      completedAt: status === "completed" ? item.completedAt || now : null,
      snoozedUntil: input.action === "snooze" ? input.dueAt! : null,
      dueAt: ["snooze", "reschedule"].includes(input.action)
        ? input.dueAt!
        : item.dueAt,
      blockedReason:
        input.action === "block"
          ? input.reason?.trim().slice(0, 2_000) || "Needs attention."
          : null,
      lastTransitionKey: input.transitionKey?.slice(0, 120) || null,
      stateVersion: sql`${salesWorkItems.stateVersion} + 1`,
    })
    .where(
      and(
        eq(salesWorkItems.id, item.id),
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.stateVersion, item.stateVersion)
      )
    );
  const updated = (
    await db
      .select()
      .from(salesWorkItems)
      .where(eq(salesWorkItems.id, item.id))
      .limit(1)
  )[0];
  if (!updated || updated.stateVersion !== item.stateVersion + 1)
    throw new Error("This work item changed elsewhere. Refresh and try again.");
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "sales_work_transitioned",
    entityType: "sales_work_item",
    entityId: String(item.id),
    summary: `Sales work item moved from ${item.status} to ${updated.status}.`,
    metadata: {
      action: input.action,
      previousStatus: item.status,
      status: updated.status,
      stateVersion: updated.stateVersion,
      sourceType: item.sourceType,
      sourceExternalId: item.sourceExternalId,
    },
  });
  return { item: updated, context: workContext(updated) };
}

/** Closes only the exact work whose external action has completed verified readback. */
export async function resolveSalesWorkAfterVerifiedAction(input: {
  userId: number;
  organisationId: number;
  actionType: string;
  payload: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const inboundMessageId = Number(input.payload.inboundMessageId || 0);
  if (
    inboundMessageId > 0 &&
    /^send_(?:email|sms|whatsapp)/.test(input.actionType)
  ) {
    const message = (
      await db
        .select({ id: inboundMessages.id })
        .from(inboundMessages)
        .where(
          and(
            eq(inboundMessages.id, inboundMessageId),
            eq(inboundMessages.organisationId, input.organisationId)
          )
        )
        .limit(1)
    )[0];
    if (!message) return false;
    await db
      .update(inboundMessages)
      .set({ needsAction: false, status: "archived" })
      .where(eq(inboundMessages.id, message.id));
    await db
      .update(salesWorkItems)
      .set({
        status: "completed",
        completedAt: now,
        blockedReason: null,
        snoozedUntil: null,
        stateVersion: sql`${salesWorkItems.stateVersion} + 1`,
      })
      .where(
        and(
          eq(salesWorkItems.organisationId, input.organisationId),
          eq(salesWorkItems.sourceKey, `mailbox:inbound:${message.id}`)
        )
      );
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "sales_work_resolved_by_verified_action",
      entityType: "inbound_message",
      entityId: String(message.id),
      summary: "Verified outbound reply resolved the exact inbound work item.",
      metadata: { actionType: input.actionType },
    });
    return true;
  }
  const taskExternalId = String(input.payload.taskExternalId || "").trim();
  if (input.actionType === "complete_active_task" && taskExternalId) {
    await db
      .update(salesWorkItems)
      .set({
        status: "completed",
        completedAt: now,
        blockedReason: null,
        snoozedUntil: null,
        stateVersion: sql`${salesWorkItems.stateVersion} + 1`,
      })
      .where(
        and(
          eq(salesWorkItems.organisationId, input.organisationId),
          eq(salesWorkItems.taskExternalId, taskExternalId)
        )
      );
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "sales_work_resolved_by_verified_action",
      entityType: "crm_task",
      entityId: taskExternalId,
      summary:
        "Verified CRM task completion resolved the exact sales work item.",
      metadata: { actionType: input.actionType },
    });
    return true;
  }
  return false;
}

export function selectCallbackWorkForVerifiedCall<
  T extends {
    status: string;
    taskExternalId: string | null;
    opportunityExternalId: string | null;
    contactExternalId: string | null;
    dueAt: Date | null;
    priority: number;
    sourceKey: string;
  },
>(
  rows: T[],
  identity: {
    contactExternalId?: string;
    opportunityExternalId?: string;
    taskExternalId?: string;
  }
) {
  const candidates = rows
    .filter(item => item.status !== "completed")
    .filter(item =>
      identity.taskExternalId
        ? item.taskExternalId === identity.taskExternalId
        : identity.opportunityExternalId
          ? item.opportunityExternalId === identity.opportunityExternalId
          : Boolean(
              identity.contactExternalId &&
                item.contactExternalId === identity.contactExternalId
            )
    )
    .sort(
      (left, right) =>
        Number(right.status === "in_progress") -
          Number(left.status === "in_progress") ||
        (left.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
          (right.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER) ||
        right.priority - left.priority ||
        left.sourceKey.localeCompare(right.sourceKey)
    );
  return candidates[0];
}

export async function completeCallbackWorkAfterVerifiedCall(input: {
  userId: number;
  organisationId: number;
  contactExternalId?: string;
  opportunityExternalId?: string;
  taskExternalId?: string;
}) {
  if (
    !input.contactExternalId &&
    !input.opportunityExternalId &&
    !input.taskExternalId
  )
    return 0;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select()
    .from(salesWorkItems)
    .where(
      and(
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.type, "CALLBACK_DUE")
      )
    )
    .limit(250);
  const target = selectCallbackWorkForVerifiedCall(rows, input);
  const exact = target ? [target] : [];
  const now = new Date();
  for (const item of exact) {
    await db
      .update(salesWorkItems)
      .set({
        status: "completed",
        completedAt: item.completedAt || now,
        blockedReason: null,
        snoozedUntil: null,
        stateVersion: sql`${salesWorkItems.stateVersion} + 1`,
      })
      .where(
        and(
          eq(salesWorkItems.id, item.id),
          eq(salesWorkItems.stateVersion, item.stateVersion)
        )
      );
  }
  if (exact.length)
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "sales_work_resolved_by_verified_call",
      entityType: "sales_work_item",
      summary: "Completed call resolved matching callback work.",
      metadata: {
        count: exact.length,
        contactExternalId: input.contactExternalId || null,
        opportunityExternalId: input.opportunityExternalId || null,
        taskExternalId: input.taskExternalId || null,
      },
    });
  return exact.length;
}
