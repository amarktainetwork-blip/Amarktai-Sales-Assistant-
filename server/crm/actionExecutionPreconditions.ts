import type { ActionProposal } from "../../drizzle/schema";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedActivity,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";

export type ExecutionPreconditionResult = {
  alreadySatisfied: boolean;
  detail: string;
  evidence?: Record<string, unknown>;
};

const CUSTOMER_BOUND_MUTATIONS = new Set([
  "append_contact_note",
  "schedule_callback",
  "complete_active_task",
  "update_contact_status",
  "update_contact",
  "update_current_opportunity",
  "update_opportunity",
  "send_sms_template",
  "send_sms",
  "send_whatsapp_template",
  "send_whatsapp",
  "apply_sequence",
  "create_activity",
]);

const OUTBOUND_ACTIONS = new Set([
  "send_sms_template",
  "send_sms",
  "send_whatsapp_template",
  "send_whatsapp",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function explicitExternalId(
  payload: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function fields(payload: Record<string, unknown>) {
  return (
    payload.fields &&
    typeof payload.fields === "object" &&
    !Array.isArray(payload.fields)
      ? payload.fields
      : payload.patch &&
          typeof payload.patch === "object" &&
          !Array.isArray(payload.patch)
        ? payload.patch
        : {}
  ) as Record<string, unknown>;
}

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function taskIsHistorical(task: Pick<NormalizedTask, "status" | "completedAt">) {
  return Boolean(task.completedAt) || /complete|closed|done|cancelled/i.test(task.status);
}

export function opportunityIsHistorical(
  opportunity: Pick<NormalizedOpportunity, "stage" | "raw">
) {
  return /closed|lost|won|rejected|not.?interested/i.test(
    `${opportunity.stage || ""} ${String(opportunity.raw.status || "")}`
  );
}

function samePatch(current: Record<string, unknown>, patch: Record<string, unknown>) {
  const entries = Object.entries(patch);
  return Boolean(entries.length) && entries.every(([key, value]) => norm(current[key]) === norm(value));
}

function contactStatus(contact: NormalizedContact) {
  return String(
    contact.lifecycleStage || contact.raw.status || contact.raw.lifecycleStage || ""
  ).trim();
}

function withinOfficeHours(value: unknown, now = new Date()) {
  const office = object(value);
  const start = typeof office.start === "string" ? office.start : "";
  const end = typeof office.end === "string" ? office.end : "";
  const days = Array.isArray(office.days)
    ? office.days.map(Number).filter(Number.isInteger)
    : [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || !days.length)
    return true;
  const timeZone =
    typeof office.timezone === "string" && office.timezone.trim()
      ? office.timezone.trim()
      : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    throw new Error(
      `WORKFLOW_OFFICE_HOURS_INVALID: '${timeZone}' is not a valid configured timezone.`
    );
  }
  const weekday = parts.find(part => part.type === "weekday")?.value || "";
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const hour = Number(parts.find(part => part.type === "hour")?.value || "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value || "0");
  const current = hour * 60 + minute;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return days.includes(dayIndex) && current >= startMinutes && current < endMinutes;
}

function matchesConfiguredStatus(value: string, configured: unknown) {
  if (!Array.isArray(configured)) return false;
  const current = norm(value);
  return configured.some(item => typeof item === "string" && norm(item) === current);
}

function activityBody(activity: NormalizedActivity) {
  return String(activity.body || activity.raw.body || activity.raw.message || activity.raw.content || "").trim();
}

function activityChannel(activity: NormalizedActivity) {
  return norm(activity.raw.channel || activity.raw.activityType || activity.activityType);
}

function isEquivalentTask(input: {
  task: NormalizedTask;
  contactExternalId: string;
  opportunityExternalId?: string;
  taskTitle: string;
  dueAt?: string;
}) {
  if (taskIsHistorical(input.task)) return false;
  if (input.task.contactExternalId && input.task.contactExternalId !== input.contactExternalId)
    return false;
  if (
    input.opportunityExternalId &&
    input.task.opportunityExternalId &&
    input.task.opportunityExternalId !== input.opportunityExternalId
  )
    return false;
  if (norm(input.task.title) !== norm(input.taskTitle)) return false;
  if (!input.dueAt) return true;
  return input.task.dueAt?.toISOString() === input.dueAt;
}

async function freshExactContact(input: {
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  contactExternalId: string;
}) {
  const contact = await input.adapter.getContact({
    connection: input.connection,
    secret: input.secret,
    externalId: input.contactExternalId,
  });
  if (!contact || contact.externalId !== input.contactExternalId)
    throw new Error(
      "EXECUTION_TARGET_STALE: the exact CRM customer can no longer be proven immediately before execution. Nothing was changed."
    );
  return contact;
}

function assertWorkflowEligibility(
  payload: Record<string, unknown>,
  contact: NormalizedContact
) {
  const workflow = object(payload.workflowConfiguration);
  const status = contactStatus(contact);
  if (status && matchesConfiguredStatus(status, workflow.stopStatuses))
    throw new Error(
      `WORKFLOW_STOP_STATUS: the customer is now '${status}', which is a configured stop status. Nothing was changed.`
    );
  if (Array.isArray(workflow.eligibilityStatuses) && workflow.eligibilityStatuses.length) {
    if (!status)
      throw new Error(
        "WORKFLOW_ELIGIBILITY_UNVERIFIED: the current CRM status could not be read immediately before execution. Nothing was changed."
      );
    if (!matchesConfiguredStatus(status, workflow.eligibilityStatuses))
      throw new Error(
        `WORKFLOW_NOT_ELIGIBLE: the customer's current CRM status '${status}' is not eligible for this configured workflow. Nothing was changed.`
      );
  }
}

/**
 * Re-reads the external system immediately before a reviewed write. The result
 * is intentionally deterministic: either the exact current target remains safe,
 * the requested postcondition is already satisfied (skip), or execution stops.
 */
export async function checkApprovedCrmExecutionPreconditions(input: {
  actionType: string;
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  proposal: ActionProposal;
  payload: Record<string, unknown>;
}): Promise<ExecutionPreconditionResult> {
  const contactExternalId = explicitExternalId(input.payload, "contactExternalId");
  if (CUSTOMER_BOUND_MUTATIONS.has(input.actionType) && !contactExternalId)
    throw new Error(
      "EXACT_CUSTOMER_REQUIRED: this reviewed CRM action has no stable external customer ID. Names are not accepted as execution targets."
    );

  let contact: NormalizedContact | undefined;
  if (contactExternalId) {
    contact = await freshExactContact({ ...input, contactExternalId });
    assertWorkflowEligibility(input.payload, contact);
  }

  const workflow = object(input.payload.workflowConfiguration);
  if (OUTBOUND_ACTIONS.has(input.actionType) && !withinOfficeHours(workflow.officeHours))
    throw new Error(
      "OUTSIDE_CONFIGURED_OFFICE_HOURS: this outbound action is outside the organisation's configured contact hours. Nothing was sent."
    );

  if (input.actionType === "complete_active_task") {
    const taskExternalId = explicitExternalId(input.payload, "taskExternalId", "externalId");
    if (!taskExternalId)
      throw new Error("EXACT_TASK_REQUIRED: the reviewed action has no stable current task ID.");
    const tasks = (await input.adapter.syncTasks({
      connection: input.connection,
      secret: input.secret,
    })).records;
    const task = tasks.find(item => item.externalId === taskExternalId);
    if (!task)
      throw new Error("EXECUTION_TASK_STALE: the exact current task no longer exists. Nothing was changed.");
    if (contactExternalId && task.contactExternalId && task.contactExternalId !== contactExternalId)
      throw new Error("EXECUTION_TASK_TARGET_MISMATCH: the task no longer belongs to the exact customer. Nothing was changed.");
    const opportunityExternalId = explicitExternalId(input.payload, "opportunityExternalId");
    if (opportunityExternalId && task.opportunityExternalId && task.opportunityExternalId !== opportunityExternalId)
      throw new Error("EXECUTION_TASK_OPPORTUNITY_MISMATCH: the task no longer belongs to the reviewed opportunity. Nothing was changed.");
    if (taskIsHistorical(task))
      return {
        alreadySatisfied: true,
        detail: "The exact task is already complete/historical, so it was not touched again.",
        evidence: { taskExternalId, status: task.status },
      };
    return { alreadySatisfied: false, detail: "The exact current task is still open and safe to complete." };
  }

  if (input.actionType === "update_current_opportunity" || input.actionType === "update_opportunity") {
    const opportunityExternalId = explicitExternalId(input.payload, "opportunityExternalId", "externalId");
    if (!opportunityExternalId)
      throw new Error("EXACT_OPPORTUNITY_REQUIRED: the reviewed action has no stable current opportunity ID.");
    const opportunity = await input.adapter.getOpportunity({
      connection: input.connection,
      secret: input.secret,
      externalId: opportunityExternalId,
    });
    if (!opportunity || opportunity.externalId !== opportunityExternalId)
      throw new Error("EXECUTION_OPPORTUNITY_STALE: the exact current opportunity no longer exists. Nothing was changed.");
    if (contactExternalId && opportunity.contactExternalId && opportunity.contactExternalId !== contactExternalId)
      throw new Error("EXECUTION_OPPORTUNITY_TARGET_MISMATCH: the opportunity no longer belongs to the exact customer. Nothing was changed.");
    if (opportunityIsHistorical(opportunity))
      throw new Error("HISTORICAL_OPPORTUNITY_PROTECTED: the reviewed opportunity is now closed/historical and will not be modified.");
    const patch = fields(input.payload);
    const current = { ...opportunity.raw, stage: opportunity.stage, pipeline: opportunity.pipeline };
    if (samePatch(current, patch))
      return {
        alreadySatisfied: true,
        detail: "The exact opportunity already satisfies the reviewed postcondition, so no duplicate write was made.",
        evidence: { opportunityExternalId },
      };
    return { alreadySatisfied: false, detail: "The exact current opportunity remains open and safe to update." };
  }

  if (input.actionType === "update_contact" || input.actionType === "update_contact_status") {
    const patch = fields(input.payload);
    if (!Object.keys(patch).length && input.payload.status !== undefined)
      patch.status = input.payload.status;
    const current = contact
      ? { ...contact.raw, lifecycleStage: contact.lifecycleStage, status: contact.raw.status || contact.lifecycleStage }
      : {};
    if (samePatch(current, patch))
      return {
        alreadySatisfied: true,
        detail: "The exact contact already satisfies the reviewed postcondition, so no duplicate write was made.",
        evidence: { contactExternalId },
      };
    return { alreadySatisfied: false, detail: "The exact contact remains safe to update." };
  }

  if (input.actionType === "schedule_callback") {
    const taskTitle = String(input.payload.taskTitle || input.payload.title || input.proposal.title).trim();
    const dueAt = typeof input.payload.dueAt === "string" ? input.payload.dueAt : undefined;
    if (!taskTitle)
      throw new Error("CALLBACK_TITLE_REQUIRED: the configured callback task title is missing.");
    const tasks = (await input.adapter.syncTasks({
      connection: input.connection,
      secret: input.secret,
    })).records;
    const opportunityExternalId = explicitExternalId(input.payload, "opportunityExternalId");
    const duplicate = tasks.find(task => isEquivalentTask({
      task,
      contactExternalId: contactExternalId!,
      opportunityExternalId,
      taskTitle,
      dueAt,
    }));
    if (duplicate)
      return {
        alreadySatisfied: true,
        detail: "An equivalent open/future CRM task already exists, so no duplicate callback was created.",
        evidence: { taskExternalId: duplicate.externalId },
      };
    return { alreadySatisfied: false, detail: "No equivalent open/future CRM task exists." };
  }

  if (input.actionType === "append_contact_note" || OUTBOUND_ACTIONS.has(input.actionType) || input.actionType === "apply_sequence") {
    const activities = (await input.adapter.syncActivities({
      connection: input.connection,
      secret: input.secret,
    })).records.filter(
      item => !item.contactExternalId || item.contactExternalId === contactExternalId
    );
    if (input.actionType === "append_contact_note") {
      const body = String(input.payload.content ?? input.payload.note ?? input.payload.message ?? input.proposal.title).trim();
      const duplicate = activities.find(item => activityBody(item) === body);
      if (duplicate)
        return {
          alreadySatisfied: true,
          detail: "The exact note content already exists in CRM activity, so it was not appended twice.",
          evidence: { activityExternalId: duplicate.externalId },
        };
    }
    if (OUTBOUND_ACTIONS.has(input.actionType)) {
      const body = String(input.payload.body ?? input.payload.templateText ?? input.payload.message ?? "").trim();
      const channel = input.actionType.includes("whatsapp") ? "whatsapp" : "sms";
      const duplicate = activities.find(item => {
        if (activityBody(item) !== body) return false;
        const observed = activityChannel(item);
        return !observed || observed.includes(channel) || observed.includes("message");
      });
      if (duplicate)
        return {
          alreadySatisfied: true,
          detail: `The exact ${channel.toUpperCase()} content is already present in external CRM activity, so it will not be sent twice.`,
          evidence: { activityExternalId: duplicate.externalId },
        };
    }
    if (input.actionType === "apply_sequence") {
      const sequence = String(input.payload.sequence ?? input.payload.templateName ?? "").trim();
      if (!sequence)
        throw new Error("SEQUENCE_REQUIRED: the configured CRM sequence is missing.");
      const duplicate = activities.find(item =>
        [item.raw.sequence, item.raw.sequenceName, item.raw.sequenceKey]
          .some(value => norm(value) === norm(sequence))
      );
      if (duplicate)
        return {
          alreadySatisfied: true,
          detail: "The configured sequence is already evidenced on the exact customer, so it will not be applied twice.",
          evidence: { activityExternalId: duplicate.externalId },
        };
    }
  }

  return {
    alreadySatisfied: false,
    detail: "Fresh external preconditions passed immediately before execution.",
  };
}
