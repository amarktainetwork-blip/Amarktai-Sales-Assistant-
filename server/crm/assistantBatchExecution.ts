import { createHash } from "node:crypto";
import type { ProposedAction } from "../workflowRules";
import { runDeterministicCrmBatch } from "./deterministicBatch";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedActivity,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";

export type AssistantCrmBatchRecord =
  | NormalizedContact
  | NormalizedOpportunity
  | NormalizedTask
  | NormalizedActivity;

export type AssistantCrmBatchPlan = {
  source: "contacts" | "opportunities" | "tasks" | "activities";
  actionType:
    | "schedule_callback"
    | "update_opportunity"
    | "complete_active_task";
  operationKey:
    | "task.create_callback"
    | "opportunity.update"
    | "task.complete";
  structuredPredicate:
    | "overdue_without_next_action"
    | "callback_requested_yesterday"
    | "accepted_wrong_stage"
    | "stale_superseded_task";
  title?: string;
  dueAt?: string;
  patch?: Record<string, unknown>;
};

export function validateAssistantCrmBatchPlan(
  value: unknown
): AssistantCrmBatchPlan {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("ASSISTANT_BATCH_PLAN_REQUIRED");
  const plan = value as Record<string, unknown>;
  const sources = ["contacts", "opportunities", "tasks", "activities"];
  const actions = ["schedule_callback", "update_opportunity", "complete_active_task"];
  const operations = ["task.create_callback", "opportunity.update", "task.complete"];
  const predicates = [
    "overdue_without_next_action",
    "callback_requested_yesterday",
    "accepted_wrong_stage",
    "stale_superseded_task",
  ];
  if (!sources.includes(String(plan.source)) ||
      !actions.includes(String(plan.actionType)) ||
      !operations.includes(String(plan.operationKey)) ||
      !predicates.includes(String(plan.structuredPredicate)))
    throw new Error("ASSISTANT_BATCH_PLAN_INVALID");
  const expectedOperation = {
    schedule_callback: "task.create_callback",
    update_opportunity: "opportunity.update",
    complete_active_task: "task.complete",
  }[String(plan.actionType)];
  if (expectedOperation !== plan.operationKey)
    throw new Error("ASSISTANT_BATCH_CAPABILITY_MISMATCH");
  return {
    source: plan.source as AssistantCrmBatchPlan["source"],
    actionType: plan.actionType as AssistantCrmBatchPlan["actionType"],
    operationKey: plan.operationKey as AssistantCrmBatchPlan["operationKey"],
    structuredPredicate: plan.structuredPredicate as AssistantCrmBatchPlan["structuredPredicate"],
    title: typeof plan.title === "string" ? plan.title.slice(0, 300) : undefined,
    dueAt: typeof plan.dueAt === "string" ? plan.dueAt.slice(0, 100) : undefined,
    patch: plan.patch && typeof plan.patch === "object" && !Array.isArray(plan.patch)
      ? plan.patch as Record<string, unknown>
      : undefined,
  };
}

function stableInstructionKey(instruction: string) {
  return createHash("sha256")
    .update(instruction.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/** Deterministic intent planning for the explicitly structured batch forms. */
export function planAssistantCrmBatchInstruction(
  instruction: string
): ProposedAction | undefined {
  const normalized = instruction.trim().toLowerCase();
  const common = {
    targetLabel: "CRM records selected by the approved batch plan",
    idempotencyKey: `assistant-batch:${stableInstructionKey(instruction)}`,
  };
  let plan: AssistantCrmBatchPlan | undefined;
  if (/\b(all|every)\b.*\boverdue\b.*\b(next action|follow.?up|callback)\b/.test(normalized))
    plan = {
      source: "contacts",
      actionType: "schedule_callback",
      operationKey: "task.create_callback",
      structuredPredicate: "overdue_without_next_action",
      title: "Amarktai overdue lead next action",
    };
  else if (/\b(everyone|all)\b.*\b(yesterday)\b.*\b(call again|callback)\b/.test(normalized))
    plan = {
      source: "activities",
      actionType: "schedule_callback",
      operationKey: "task.create_callback",
      structuredPredicate: "callback_requested_yesterday",
      title: "Requested callback",
    };
  else if (/\b(all|every)\b.*\b(deal|opportunit)\w*\b.*\baccepted\b.*\bstage\b/.test(normalized))
    plan = {
      source: "opportunities",
      actionType: "update_opportunity",
      operationKey: "opportunity.update",
      structuredPredicate: "accepted_wrong_stage",
      patch: { stage: "accepted" },
    };
  else if (/\b(all|every)\b.*\b(stale|overdue)\b.*\b(task|follow.?up)\w*\b.*\b(superseded|replaced)\b/.test(normalized))
    plan = {
      source: "tasks",
      actionType: "complete_active_task",
      operationKey: "task.complete",
      structuredPredicate: "stale_superseded_task",
    };
  if (!plan) return undefined;
  return {
    ...common,
    actionType: "deterministic_crm_batch",
    title: `Review batch CRM work: ${instruction.trim().slice(0, 180)}`,
    payload: {
      reviewRequired: true,
      approvalScope: "one approved structured batch plan",
      instruction: instruction.trim().slice(0, 12_000),
      batchPlan: plan,
      duplicateProtection:
        "Every record uses a stable idempotency key and deterministic readback.",
    },
  };
}

function raw(record: AssistantCrmBatchRecord) {
  return record.raw || {};
}
function truthy(value: unknown) {
  return value === true || value === 1 ||
    (typeof value === "string" && /^(?:true|yes|1)$/i.test(value.trim()));
}
function text(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function evaluateStructuredBatchRecord(
  record: AssistantCrmBatchRecord,
  plan: AssistantCrmBatchPlan,
  now = new Date()
): boolean | "ambiguous" {
  const source = raw(record);
  if (plan.structuredPredicate === "overdue_without_next_action") {
    const due = source.dueAt || source.nextStepDueAt || source.followUpDueAt;
    const overdue = truthy(source.overdue) ||
      (typeof due === "string" && !Number.isNaN(Date.parse(due)) && Date.parse(due) < now.valueOf());
    const hasNext = Boolean(source.nextAction || source.nextStepAt || source.nextTaskId);
    if (!overdue && due === undefined && source.overdue === undefined)
      return "ambiguous";
    return overdue && !hasNext;
  }
  if (plan.structuredPredicate === "callback_requested_yesterday") {
    const activity = record as NormalizedActivity;
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const sameDay = activity.occurredAt.toISOString().slice(0, 10) ===
      yesterday.toISOString().slice(0, 10);
    const requested = truthy(source.callbackRequested) ||
      /call (?:me |us )?again|callback/.test(text(activity.body));
    return sameDay && requested;
  }
  if (plan.structuredPredicate === "accepted_wrong_stage") {
    const opportunity = record as NormalizedOpportunity;
    const accepted = text(opportunity.stage) === "accepted" ||
      text(source.status) === "accepted" || truthy(source.accepted);
    const correct = truthy(source.correctStage) || text(source.targetStage) === text(opportunity.stage);
    if (!opportunity.stage && source.status === undefined && source.accepted === undefined)
      return "ambiguous";
    return accepted && !correct;
  }
  const task = record as NormalizedTask;
  const stale = task.dueAt ? task.dueAt.valueOf() < now.valueOf() : truthy(source.stale);
  const superseded = truthy(source.superseded) || Boolean(source.supersededByTaskId);
  if (!task.dueAt && source.stale === undefined) return "ambiguous";
  return stale && superseded && !/complete|closed/i.test(task.status);
}

function isRateLimit(error: unknown) {
  return /(?:\b429\b|rate.?limit|too many requests)/i.test(
    error instanceof Error ? error.message : String(error)
  );
}

export async function executeAssistantCrmBatch(input: {
  organisationId: number;
  proposalId: number;
  correlationId: string;
  instruction: string;
  plan: AssistantCrmBatchPlan;
  connection: AdapterConnection;
  adapter: CrmAdapter;
  secret: ConnectionSecretPayload;
  resolveAmbiguous?: (
    record: AssistantCrmBatchRecord,
    plan: AssistantCrmBatchPlan
  ) => Promise<boolean>;
  alreadyCompleted?: (key: string) => Promise<boolean>;
  markCompleted?: (key: string) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
  onProgress?: (progress: {
    discovered: number;
    completed: number;
    skipped: number;
    failed: number;
    cancelled: boolean;
  }) => Promise<void> | void;
  pageSize?: number;
  concurrency?: number;
  maxRetries?: number;
}) {
  let ambiguityCalls = 0;
  let crmOperations = 0;
  let readbacks = 0;
  const fetchPage = async (cursor: string | undefined) => {
    const common = {
      connection: input.connection,
      secret: input.secret,
      cursor,
    };
    const page = input.plan.source === "contacts"
      ? await input.adapter.syncContacts(common)
      : input.plan.source === "opportunities"
        ? await input.adapter.syncOpportunities(common)
        : input.plan.source === "tasks"
          ? await input.adapter.syncTasks(common)
          : await input.adapter.syncActivities(common);
    return { records: page.records, nextCursor: page.cursor };
  };
  const result = await runDeterministicCrmBatch<AssistantCrmBatchRecord, AssistantCrmBatchPlan>({
    jobId: `proposal-${input.proposalId}`,
    instruction: input.instruction,
    interpretInstruction: async () => input.plan,
    fetchPage: async (_plan, cursor) => fetchPage(cursor),
    recordId: record => record.externalId,
    qualify: async record => {
      const structured = evaluateStructuredBatchRecord(record, input.plan);
      if (structured !== "ambiguous") return structured;
      if (!input.resolveAmbiguous) return false;
      ambiguityCalls += 1;
      return input.resolveAmbiguous(record, input.plan);
    },
    execute: async (record, plan, idempotencyKey) => {
      crmOperations += 1;
      if (plan.actionType === "schedule_callback") {
        const contactExternalId = plan.source === "activities"
          ? (record as NormalizedActivity).contactExternalId
          : record.externalId;
        if (!contactExternalId)
          throw new Error("BATCH_CONTACT_ID_REQUIRED");
        await input.adapter.createTask({
          connection: input.connection,
          secret: input.secret,
          title: plan.title || "Amarktai next action",
          dueAt: plan.dueAt,
          contactExternalId,
          correlationId: `${input.correlationId}:${idempotencyKey.slice(0, 16)}`,
        });
        return;
      }
      if (plan.actionType === "update_opportunity") {
        await input.adapter.updateOpportunity({
          connection: input.connection,
          secret: input.secret,
          externalId: record.externalId,
          patch: plan.patch || {},
          correlationId: `${input.correlationId}:${idempotencyKey.slice(0, 16)}`,
        });
        return;
      }
      await input.adapter.completeTask({
        connection: input.connection,
        secret: input.secret,
        externalId: record.externalId,
        correlationId: `${input.correlationId}:${idempotencyKey.slice(0, 16)}`,
      });
    },
    verify: async (record, plan) => {
      readbacks += 1;
      if (plan.actionType === "update_opportunity") {
        const current = await input.adapter.getOpportunity({
          connection: input.connection,
          secret: input.secret,
          externalId: record.externalId,
        });
        return Boolean(current) && Object.entries(plan.patch || {}).every(
          ([key, value]) => String((current!.raw as Record<string, unknown>)[key] ??
            (key === "stage" ? current!.stage : "")) === String(value)
        );
      }
      const tasks = await input.adapter.syncTasks({
        connection: input.connection,
        secret: input.secret,
      });
      if (plan.actionType === "complete_active_task")
        return tasks.records.some(task =>
          task.externalId === record.externalId && /complete|closed/i.test(task.status)
        );
      const contactExternalId = plan.source === "activities"
        ? (record as NormalizedActivity).contactExternalId
        : record.externalId;
      return tasks.records.some(task =>
        task.contactExternalId === contactExternalId &&
        task.title === (plan.title || "Amarktai next action")
      );
    },
    alreadyCompleted: input.alreadyCompleted,
    markCompleted: input.markCompleted,
    isCancelled: input.isCancelled,
    onProgress: progress => input.onProgress?.(progress),
    retryDelayMs: (attempt, error) =>
      isRateLimit(error) ? Math.min(4_000, 250 * 2 ** (attempt - 1)) : 0,
    pageSize: input.pageSize,
    concurrency: input.concurrency,
    maxRetries: input.maxRetries,
  });
  return {
    success: !result.progress.cancelled && !result.partialFailure,
    detail: `Batch finished: ${result.progress.discovered} processed, ${result.progress.completed} changed, ${result.progress.skipped} already correct or skipped, ${result.progress.failed} failed.`,
    correlationId: input.correlationId,
    provider: input.connection.provider,
    completedAt: new Date().toISOString(),
    providerResult: {
      organisationId: input.organisationId,
      connectedSystemId: input.connection.id,
      operationKey: input.plan.operationKey,
      progress: result.progress,
      failedRecords: result.results.filter(item => item.status === "failed").slice(0, 200),
      aiCalls: { planning: 0, ambiguity: ambiguityCalls },
      crmOperations,
      deterministicReadbacks: readbacks,
    },
    retryable: result.partialFailure,
  };
}
