import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb, recordAudit } from "./db";
import {
  canManageOrganisationForUser,
  requireOrganisationMembership,
} from "./organisation";
import {
  evaluateAutomationPolicy,
  type AutomationEvaluationContext,
} from "./automationPolicyEvaluator";

export type AutomationMode = "advise" | "review" | "auto_preapproved";
export type AutomationPreset = "assist_only" | "balanced" | "automated";
export type ActionApprovalMode =
  | "automatic"
  | "salesperson_approval"
  | "manager_approval"
  | "disabled";
export type AutomationPolicy = {
  mode: AutomationMode;
  preset: AutomationPreset;
  autoActionTypes: string[];
  requireReviewForCommunications: boolean;
  requireReviewForStageChanges: boolean;
  monitorKeys: string[];
  actionModes: Record<string, ActionApprovalMode>;
  scope: {
    userIds: number[];
    pipelineIds: string[];
    leadSources: string[];
  };
  triggerKeys: string[];
  conditions: Record<string, string[]>;
  schedule: {
    mode: "continuous" | "business_hours" | "daily" | "manual";
    timezone?: string;
    days: number[];
    startHour?: number;
    endHour?: number;
  };
  safety: {
    maximumActionsPerRun: number;
    deduplicationWindowMinutes: number;
    maximumRetries: number;
    quietHoursEnabled: boolean;
    allowedActionKeys: string[];
    allowedChannels: Array<"email" | "sms" | "whatsapp" | "dialler">;
    allowedTemplateIds: string[];
  };
};

const DEFAULT_POLICY: AutomationPolicy = {
  mode: "review",
  preset: "assist_only",
  autoActionTypes: [
    "append_contact_note",
    "schedule_callback",
    "complete_active_task",
    "create_activity",
  ],
  requireReviewForCommunications: true,
  requireReviewForStageChanges: true,
  monitorKeys: [
    "new_leads",
    "task_changes",
    "opportunities",
    "inbound_mail",
    "callbacks",
    "appointments",
    "stale_leads",
    "overdue_tasks",
  ],
  actionModes: {},
  scope: { userIds: [], pipelineIds: [], leadSources: [] },
  triggerKeys: [
    "new_lead",
    "field_or_stage_change",
    "inbound_email",
    "scheduled_time",
    "overdue_task",
    "callback_due",
    "opportunity_stalled",
    "explicit_user_action",
  ],
  conditions: {},
  schedule: { mode: "continuous", days: [1, 2, 3, 4, 5] },
  safety: {
    maximumActionsPerRun: 25,
    deduplicationWindowMinutes: 1_440,
    maximumRetries: 2,
    quietHoursEnabled: true,
    allowedActionKeys: [],
    allowedChannels: [],
    allowedTemplateIds: [],
  },
};

function cleanMode(value: unknown): AutomationMode {
  return value === "advise" ||
    value === "review" ||
    value === "auto_preapproved"
    ? value
    : DEFAULT_POLICY.mode;
}
function cleanActionTypes(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_POLICY.autoActionTypes;
  return Array.from(
    new Set(
      value.filter(
        (item): item is string =>
          typeof item === "string" && /^[a-z0-9_:-]{2,80}$/i.test(item)
      )
    )
  ).slice(0, 80);
}

function strings(value: unknown, maximum = 100) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter(
            (item): item is string =>
              typeof item === "string" && /^[a-z0-9_.:-]{1,180}$/i.test(item)
          )
        )
      ).slice(0, maximum)
    : [];
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

export function automationPolicyFromPreset(
  preset: AutomationPreset
): AutomationPolicy {
  const base = structuredClone(DEFAULT_POLICY);
  if (preset === "assist_only") return base;
  if (preset === "balanced")
    return {
      ...base,
      preset,
      mode: "auto_preapproved",
      autoActionTypes: ["schedule_callback"],
      actionModes: {
        schedule_callback: "automatic",
        append_contact_note: "salesperson_approval",
        send_email: "salesperson_approval",
        update_opportunity: "manager_approval",
      },
    };
  return {
    ...base,
    preset,
    mode: "auto_preapproved",
    autoActionTypes: [
      "append_contact_note",
      "schedule_callback",
      "complete_active_task",
      "create_activity",
    ],
    actionModes: {
      append_contact_note: "automatic",
      schedule_callback: "automatic",
      complete_active_task: "automatic",
      create_activity: "automatic",
      send_email: "salesperson_approval",
      send_sms: "manager_approval",
      send_whatsapp: "manager_approval",
      update_opportunity: "manager_approval",
    },
  };
}

export function normalizeAutomationPolicy(value: unknown): AutomationPolicy {
  const source = record(value);
  const preset: AutomationPreset = [
    "assist_only",
    "balanced",
    "automated",
  ].includes(String(source.preset))
    ? (source.preset as AutomationPreset)
    : DEFAULT_POLICY.preset;
  const presetDefaults = automationPolicyFromPreset(preset);
  const actionModes = Object.fromEntries(
    Object.entries(record(source.actionModes))
      .filter(
        ([key, mode]) =>
          /^[a-z0-9_.:-]{2,80}$/i.test(key) &&
          [
            "automatic",
            "salesperson_approval",
            "manager_approval",
            "disabled",
          ].includes(String(mode))
      )
      .slice(0, 100)
  ) as Record<string, ActionApprovalMode>;
  const scope = record(source.scope);
  const schedule = record(source.schedule);
  const safety = record(source.safety);
  const rawConditions = record(source.conditions);
  return {
    mode: source.mode ? cleanMode(source.mode) : presetDefaults.mode,
    preset,
    autoActionTypes: source.autoActionTypes
      ? cleanActionTypes(source.autoActionTypes)
      : presetDefaults.autoActionTypes,
    requireReviewForCommunications:
      source.requireReviewForCommunications !== false,
    requireReviewForStageChanges: source.requireReviewForStageChanges !== false,
    monitorKeys: source.monitorKeys
      ? strings(source.monitorKeys)
      : presetDefaults.monitorKeys,
    actionModes: Object.keys(actionModes).length
      ? actionModes
      : presetDefaults.actionModes,
    scope: {
      userIds: Array.isArray(scope.userIds)
        ? Array.from(
            new Set(
              scope.userIds
                .map(Number)
                .filter(value => Number.isInteger(value) && value > 0)
            )
          ).slice(0, 200)
        : [],
      pipelineIds: strings(scope.pipelineIds),
      leadSources: strings(scope.leadSources),
    },
    triggerKeys: source.triggerKeys
      ? strings(source.triggerKeys)
      : presetDefaults.triggerKeys,
    conditions: Object.fromEntries(
      Object.entries(rawConditions)
        .filter(([key]) => /^[a-z0-9_.:-]{1,100}$/i.test(key))
        .map(([key, values]) => [key, strings(values, 50)])
        .slice(0, 50)
    ),
    schedule: {
      mode: ["continuous", "business_hours", "daily", "manual"].includes(
        String(schedule.mode)
      )
        ? (schedule.mode as AutomationPolicy["schedule"]["mode"])
        : presetDefaults.schedule.mode,
      timezone:
        typeof schedule.timezone === "string"
          ? schedule.timezone.slice(0, 80)
          : undefined,
      days: Array.isArray(schedule.days)
        ? Array.from(
            new Set(
              schedule.days
                .map(Number)
                .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
            )
          )
        : presetDefaults.schedule.days,
      startHour:
        schedule.startHour === undefined
          ? undefined
          : integer(schedule.startHour, 8, 0, 23),
      endHour:
        schedule.endHour === undefined
          ? undefined
          : integer(schedule.endHour, 17, 1, 24),
    },
    safety: {
      maximumActionsPerRun: integer(
        safety.maximumActionsPerRun,
        presetDefaults.safety.maximumActionsPerRun,
        1,
        500
      ),
      deduplicationWindowMinutes: integer(
        safety.deduplicationWindowMinutes,
        presetDefaults.safety.deduplicationWindowMinutes,
        1,
        43_200
      ),
      maximumRetries: integer(
        safety.maximumRetries,
        presetDefaults.safety.maximumRetries,
        0,
        10
      ),
      quietHoursEnabled: safety.quietHoursEnabled !== false,
      allowedActionKeys: strings(safety.allowedActionKeys),
      allowedChannels: strings(safety.allowedChannels).filter(
        (channel): channel is "email" | "sms" | "whatsapp" | "dialler" =>
          ["email", "sms", "whatsapp", "dialler"].includes(channel)
      ),
      allowedTemplateIds: strings(safety.allowedTemplateIds),
    },
  };
}

export async function getAutomationPolicy(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (
    await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  if (!organisation) throw new Error("Organisation was not found.");
  return normalizeAutomationPolicy(
    (organisation.settings as Record<string, unknown>)?.automationPolicy
  );
}

export async function saveAutomationPolicy(input: {
  userId: number;
  organisationId: number;
  policy: AutomationPolicy;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners, managers, and platform owners can change automation policy."
    );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (
    await db
      .select()
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  if (!organisation) throw new Error("Organisation was not found.");
  const policy = normalizeAutomationPolicy(input.policy);
  const settings = {
    ...(organisation.settings as Record<string, unknown>),
    automationPolicy: policy,
  };
  await db
    .update(organisations)
    .set({ settings })
    .where(eq(organisations.id, input.organisationId));
  await recordAudit({
    userId: input.userId,
    eventType: "automation_policy_updated",
    entityType: "organisation",
    entityId: String(input.organisationId),
    summary: `Automation policy changed to ${policy.mode}.`,
    metadata: {
      mode: policy.mode,
      autoActionTypes: policy.autoActionTypes,
      requireReviewForCommunications: policy.requireReviewForCommunications,
      requireReviewForStageChanges: policy.requireReviewForStageChanges,
    },
  });
  return policy;
}

export function automationPolicyDecision(
  policy: AutomationPolicy,
  actionType: string,
  context: Partial<Omit<AutomationEvaluationContext, "actionType">> = {}
) {
  const evaluated = evaluateAutomationPolicy(policy, {
    phase: context.phase || "execution",
    actionType,
    manual: context.manual ?? true,
    ...context,
  });
  const autoMode = policy.mode === "auto_preapproved";
  const allowListed = policy.autoActionTypes.includes(actionType);
  const policyRequiresReview = evaluated.approvalRequired;
  return {
    autoMode,
    allowListed,
    policyRequiresReview,
    organisationAllowsAction: evaluated.mayExecute,
    mayAutoExecute: evaluated.mayExecute,
    approvalMode:
      evaluated.approvalMode === "manager"
        ? "manager_approval"
        : evaluated.approvalMode === "salesperson"
          ? "salesperson_approval"
          : "automatic",
    blockingReason:
      evaluated.outcome === "ALLOWED_AUTOMATIC" ? null : evaluated.outcome,
    evaluation: evaluated,
  } as const;
}

export function mayAutoExecute(policy: AutomationPolicy, actionType: string) {
  return automationPolicyDecision(policy, actionType).mayAutoExecute;
}
