import {
  normalizeSkillDefinition,
  type SkillCondition,
  type SkillDefinition,
  type SkillStep,
} from "../shared/skillBuilder";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";
import { resolveApprovedCommunicationTemplate } from "./approvedTemplates";
import type { ProposedAction } from "./workflowRules";

type RuntimeInputs = Record<string, unknown>;

function norm(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function sourceRecord(input: {
  condition: SkillCondition;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs: RuntimeInputs;
}) {
  const customer = input.customer;
  if (input.condition.source === "customer")
    return {
      name: customer.contactName,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      email: customer.email,
      phone: customer.phone,
      status: customer.contactStatus,
      courseInterest: customer.courseInterest,
      tags: customer.customerTags || [],
      attributes: customer.customerAttributes || {},
    };
  if (input.condition.source === "task") {
    const task =
      customer.operationalRecordState.openTasks.find(
        item =>
          item.externalId === customer.operationalRecordState.currentActiveTaskExternalId
      ) || customer.operationalRecordState.openTasks[0];
    return {
      title: task?.title,
      status: task?.status,
      dueAt: task?.dueAt,
      dueState: input.runtimeInputs.taskDueState,
      externalId: task?.externalId,
    };
  }
  if (input.condition.source === "opportunity") {
    const opportunity =
      customer.operationalRecordState.openOpportunities.find(
        item =>
          item.externalId ===
          customer.operationalRecordState.currentActiveOpportunityExternalId
      ) || customer.operationalRecordState.openOpportunities[0];
    return {
      name: opportunity?.name,
      stage: opportunity?.stage,
      externalId: opportunity?.externalId,
      pendingWrite: input.runtimeInputs.opportunityPendingWrite,
      owner: input.runtimeInputs.opportunityOwner,
      followers: input.runtimeInputs.opportunityFollowers,
    };
  }
  if (input.condition.source === "history") return input.runtimeInputs;
  return {
    now: input.runtimeInputs.now || new Date().toISOString(),
    ...input.runtimeInputs,
  };
}

function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function conditionMatches(input: {
  condition: SkillCondition;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs: RuntimeInputs;
}) {
  const actual = getPath(sourceRecord(input), input.condition.field);
  const expected = input.condition.value;
  switch (input.condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "not_exists":
      return actual === undefined || actual === null || actual === "";
    case "equals":
      return norm(actual) === norm(expected);
    case "not_equals":
      return norm(actual) !== norm(expected);
    case "contains": {
      if (Array.isArray(actual))
        return actual.some(item => norm(item) === norm(expected));
      return norm(actual).includes(norm(expected));
    }
    case "not_contains": {
      if (Array.isArray(actual))
        return !actual.some(item => norm(item) === norm(expected));
      return !norm(actual).includes(norm(expected));
    }
    case "one_of":
      return Array.isArray(expected)
        ? expected.some(item => norm(item) === norm(actual))
        : false;
    case "before":
    case "after": {
      const left = new Date(String(actual || "")).valueOf();
      const right = new Date(String(expected || "")).valueOf();
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return input.condition.operator === "before" ? left < right : left > right;
    }
  }
}

export function skillMatchesContext(input: {
  definition: unknown;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs?: RuntimeInputs;
}) {
  const definition = normalizeSkillDefinition(input.definition);
  const runtimeInputs = input.runtimeInputs || {};
  const run = (condition: SkillCondition) =>
    conditionMatches({ condition, customer: input.customer, runtimeInputs });
  if (definition.match.stopIf.some(run)) return false;
  if (definition.match.all.some(condition => !run(condition))) return false;
  if (
    definition.match.any.length &&
    !definition.match.any.some(condition => run(condition))
  )
    return false;
  return true;
}

function runtimeValue(step: SkillStep, key: string, runtimeInputs: RuntimeInputs) {
  if (step.inputs && key in step.inputs) return step.inputs[key];
  return runtimeInputs[key];
}

function exactTarget(customer: ResolvedAssistantCustomerContext) {
  return {
    contactExternalId: customer.contactExternalId,
    preferredConnectedSystemId: customer.connectedSystemId,
    preferredProvider: customer.provider,
    requireFreshCustomerContext: true,
  };
}

function safeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function proposalForStep(input: {
  skillKey: string;
  definition: SkillDefinition;
  step: SkillStep;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs: RuntimeInputs;
  index: number;
}): ProposedAction | undefined {
  const { step, customer, runtimeInputs } = input;
  if (
    step.action === "read_customer" ||
    step.action === "read_tasks" ||
    step.action === "read_history" ||
    step.action === "read_opportunity" ||
    step.action === "set_internal_priority"
  )
    return undefined;

  const missing = (step.requiresInput || []).filter(
    key => runtimeValue(step, key, runtimeInputs) === undefined
  );
  const base = {
    reviewRequired: true,
    duplicateProtection:
      "Re-read the exact external record immediately before execution and skip when the postcondition is already true.",
    learnedSkill: {
      key: input.skillKey,
      kind: input.definition.kind,
      stepId: step.id,
      stepLabel: step.label,
    },
    ...exactTarget(customer),
    ...(missing.length
      ? {
          draftOnly: true,
          executionReady: false,
          blockedReason: "Required runtime facts are missing.",
          missingRuntimeInputs: missing,
        }
      : {}),
  } as Record<string, unknown>;

  let actionType = "";
  const payload: Record<string, unknown> = { ...base, ...(step.inputs || {}) };
  if (step.action === "prepare_note") {
    actionType = "append_contact_note";
    payload.content =
      runtimeValue(step, "consultationNotes", runtimeInputs) ??
      runtimeValue(step, "note", runtimeInputs) ??
      step.inputs?.content ??
      "";
  } else if (step.action === "prepare_email") {
    actionType = "send_email_template";
    payload.to = customer.email || "";
    payload.templateName = step.templateKey;
    payload.templatePurpose = step.templateKey;
    payload.templateTransformation = step.inputs || {};
    if (!customer.email) {
      payload.draftOnly = true;
      payload.executionReady = false;
      payload.blockedReason = "No verified customer email address is available.";
    }
  } else if (step.action === "prepare_sms") {
    actionType = "send_sms_template";
    payload.to =
      step.inputs?.recipientOverride ?? customer.phone ?? "";
    payload.templateName = step.templateKey;
    payload.templatePurpose = step.templateKey;
    payload.templateTransformation = step.inputs || {};
    if (!payload.to) {
      payload.draftOnly = true;
      payload.executionReady = false;
      payload.blockedReason = "No verified SMS recipient is available.";
    }
  } else if (step.action === "prepare_whatsapp") {
    actionType = "send_whatsapp_template";
    payload.to = customer.phone || "";
    payload.templateName = step.templateKey;
    payload.templatePurpose = step.templateKey;
    payload.templateTransformation = step.inputs || {};
    if (!customer.phone) {
      payload.draftOnly = true;
      payload.executionReady = false;
      payload.blockedReason = "No verified WhatsApp recipient is available.";
    }
  } else if (step.action === "prepare_task") {
    const customOperation =
      typeof step.inputs?.operationKey === "string" &&
      step.inputs.operationKey.startsWith("custom.write.")
        ? step.inputs.operationKey
        : undefined;
    if (customOperation) {
      actionType = "custom_crm_action";
      payload.actionName = customOperation;
      payload.externalId =
        customer.operationalRecordState.currentActiveTaskExternalId || "";
      payload.taskExternalId =
        customer.operationalRecordState.currentActiveTaskExternalId || "";
    } else {
      actionType = "schedule_callback";
      payload.taskPurpose =
        runtimeValue(step, "taskTitle", runtimeInputs) ??
        step.inputs?.taskTitle ??
        step.label;
      payload.dueAt =
        runtimeValue(step, "agreedFollowUpDate", runtimeInputs) ??
        runtimeValue(step, "dueAt", runtimeInputs);
      payload.timingRule = step.timingRule;
    }
  } else if (step.action === "prepare_contact_update") {
    actionType = "update_contact";
    payload.fields = step.inputs?.fields || step.inputs || {};
  } else if (step.action === "prepare_opportunity_update") {
    actionType = "update_current_opportunity";
    payload.opportunityExternalId =
      customer.operationalRecordState.currentActiveOpportunityExternalId || "";
    payload.fields = step.inputs?.fields || step.inputs || {};
    payload.transitionIntent =
      runtimeValue(step, "transitionIntent", runtimeInputs) ?? step.label;
  } else if (step.action === "complete_task_after_review") {
    actionType = "complete_active_task";
    payload.taskExternalId =
      customer.operationalRecordState.currentActiveTaskExternalId || "";
    payload.requiredEvidence = step.requiredEvidence || [];
  }
  if (!actionType) return undefined;

  return {
    actionType,
    title: step.label,
    targetLabel: customer.contactName,
    idempotencyKey: [
      "learned-skill",
      safeKey(input.skillKey),
      safeKey(customer.contactExternalId),
      String(input.index + 1).padStart(2, "0"),
      safeKey(step.id),
    ].join(":"),
    payload,
  };
}

export function compileLearnedSkillRuntime(input: {
  skillKey: string;
  definition: unknown;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs?: RuntimeInputs;
}) {
  const definition = normalizeSkillDefinition(input.definition);
  const runtimeInputs = input.runtimeInputs || {};
  const matches = skillMatchesContext({
    definition,
    customer: input.customer,
    runtimeInputs,
  });
  const internalEffects = definition.steps.flatMap(step => {
    if (step.action !== "set_internal_priority") return [];
    const conditionalPriority = step.inputs?.priorityWhenFundingReady;
    if (conditionalPriority !== undefined) {
      const fundingReady =
        runtimeInputs.fundingReady === true ||
        norm(runtimeInputs.fundingReady) === "yes" ||
        norm(runtimeInputs.ableToFundTraining) === "yes";
      if (!fundingReady) return [];
      return [
        {
          type: "priority" as const,
          value: String(conditionalPriority),
          reason: step.label,
        },
      ];
    }
    return [
      {
        type: "priority" as const,
        value: String(step.inputs?.priority || "high"),
        reason: step.label,
      },
    ];
  });
  if (!matches)
    return {
      matches: false,
      actions: [] as ProposedAction[],
      internalEffects: [],
      blocked: [],
    };
  const actions = definition.steps.flatMap((step, index) => {
    const action = proposalForStep({
      skillKey: input.skillKey,
      definition,
      step,
      customer: input.customer,
      runtimeInputs,
      index,
    });
    return action ? [action] : [];
  });
  const blocked = actions
    .filter(action => action.payload.executionReady === false)
    .map(action => ({
      stepId: String(
        (action.payload.learnedSkill as Record<string, unknown>)?.stepId || ""
      ),
      reason: String(action.payload.blockedReason || "Blocked"),
      missingRuntimeInputs: Array.isArray(action.payload.missingRuntimeInputs)
        ? action.payload.missingRuntimeInputs
        : [],
    }));
  return { matches, actions, internalEffects, blocked };
}

function replaceOpeningLine(body: string, replacement: string) {
  const newline = body.search(/\r?\n/);
  if (newline > 0)
    return replacement + body.slice(newline);
  const sentence = body.match(/^.*?[.!?](?:\s|$)/);
  if (!sentence)
    throw new Error(
      "TEMPLATE_TRANSFORMATION_UNSAFE: the approved template has no deterministic opening sentence/line to replace."
    );
  return replacement + body.slice(sentence[0].length);
}

function validateTemplateTransformation(input: {
  body: string;
  transformation: Record<string, unknown>;
}) {
  let body = input.body;
  const opening = String(input.transformation.openingLineOverride || "").trim();
  if (opening) body = replaceOpeningLine(body, opening);

  const requiredPhrase = String(input.transformation.requiredPhrase || "").trim();
  if (
    requiredPhrase &&
    !body.toLowerCase().includes(requiredPhrase.toLowerCase())
  )
    throw new Error(
      `TEMPLATE_TRANSFORMATION_REQUIRED: the approved template has not yet been deterministically tailored to include '${requiredPhrase}'.`
    );

  const forbidden = String(
    input.transformation.forbiddenProgrammeReferences || ""
  )
    .split("|")
    .map(value => value.trim())
    .filter(Boolean);
  const found = forbidden.find(value =>
    body.toLowerCase().includes(value.toLowerCase())
  );
  if (found)
    throw new Error(
      `TEMPLATE_VALIDATION_FAILED: the prepared communication still references '${found}'.`
    );
  return body;
}

export async function materializeLearnedSkillCommunications(input: {
  organisationId: number;
  actions: ProposedAction[];
}) {
  const output: ProposedAction[] = [];
  for (const action of input.actions) {
    const channel =
      action.actionType === "send_email_template"
        ? "email"
        : action.actionType === "send_sms_template"
          ? "sms"
          : action.actionType === "send_whatsapp_template"
            ? "whatsapp"
            : undefined;
    if (!channel) {
      output.push(action);
      continue;
    }
    const to = String(action.payload.to || "").trim();
    const templateName = String(action.payload.templateName || "").trim();
    if (!to || !templateName) {
      output.push({
        ...action,
        payload: {
          ...action.payload,
          draftOnly: true,
          executionReady: false,
          blockedReason: !to
            ? "No verified recipient is available."
            : "No approved template is mapped.",
        },
      });
      continue;
    }
    try {
      const materialized = await resolveApprovedCommunicationTemplate({
        organisationId: input.organisationId,
        channel,
        templateName,
        to,
      });
      const transformation =
        action.payload.templateTransformation &&
        typeof action.payload.templateTransformation === "object" &&
        !Array.isArray(action.payload.templateTransformation)
          ? (action.payload.templateTransformation as Record<string, unknown>)
          : {};
      const body = validateTemplateTransformation({
        body: materialized.body,
        transformation,
      });
      output.push({
        ...action,
        payload: {
          ...action.payload,
          ...materialized,
          body,
          draftOnly: false,
          executionReady: true,
          blockedReason: undefined,
        },
      });
    } catch (error) {
      output.push({
        ...action,
        payload: {
          ...action.payload,
          draftOnly: true,
          executionReady: false,
          blockedReason:
            error instanceof Error
              ? error.message
              : "Approved template could not be materialised safely.",
        },
      });
    }
  }
  return output;
}
