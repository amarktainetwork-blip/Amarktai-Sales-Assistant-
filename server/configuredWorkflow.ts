import type { WorkflowKey } from "./agentCatalog";
import {
  getClientActionConfiguration,
  type ClientActionConfiguration,
  type WorkflowActionConfiguration,
} from "./clientActionConfiguration";
import {
  findConfiguredTemplate,
  materializeConfiguredCommunication,
  resolveConfiguredSender,
} from "./communicationContent";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";
import {
  buildWorkflowPlan,
  type ProposedAction,
  type WorkflowPlan,
  type WorkflowRequest,
} from "./workflowRules";

const SEQUENCE_ACTIONS = new Set([
  "verify_contact_context",
  "append_contact_note",
  "schedule_callback",
  "complete_active_task",
  "update_contact_status",
  "update_contact",
  "update_current_opportunity",
  "update_opportunity",
  "send_email_template",
  "send_sms_template",
  "send_whatsapp_template",
  "apply_sequence",
]);

function safeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 100);
}

function sequenceAction(
  token: string,
  leadLabel: string,
  index: number
): ProposedAction {
  const [rawAction, ...rest] = token.split(":");
  const actionType = rawAction.trim();
  const purpose = rest.join(":").trim() || actionType;
  if (!SEQUENCE_ACTIONS.has(actionType))
    throw new Error(
      `WORKFLOW_SEQUENCE_ACTION_INVALID: '${actionType}' is not an approved reusable workflow action.`
    );
  const payload: Record<string, unknown> = {
    reviewRequired: true,
    workflowPurpose: purpose,
    duplicateProtection:
      "Re-read the exact external record and skip when the configured postcondition is already satisfied.",
  };
  if (/^send_(?:email|sms|whatsapp)_template$/.test(actionType))
    payload.templatePurpose = purpose;
  if (
    actionType === "schedule_callback" ||
    actionType === "complete_active_task"
  )
    payload.taskPurpose = purpose;
  if (actionType === "update_contact_status") payload.statusIntent = purpose;
  if (
    actionType === "update_current_opportunity" ||
    actionType === "update_opportunity"
  )
    payload.transitionIntent = purpose;
  if (actionType === "apply_sequence") payload.sequencePurpose = purpose;
  return {
    actionType,
    title: `${actionType.replace(/_/g, " ")} · ${purpose}`,
    targetLabel: leadLabel,
    idempotencyKey: `${safeKey(leadLabel)}:configured:${String(index + 1).padStart(2, "0")}:${safeKey(actionType)}:${safeKey(purpose)}`,
    payload,
  };
}

function actionsFromConfiguration(
  base: WorkflowPlan,
  workflow: WorkflowActionConfiguration,
  leadLabel: string
) {
  if (!workflow.sequence.length) return base.actions;
  const configured = workflow.sequence.map((token, index) =>
    sequenceAction(token, leadLabel, index)
  );
  if (
    !configured.some(
      action => action.actionType === "verify_contact_context"
    )
  )
    configured.unshift(
      sequenceAction("verify_contact_context:current_customer", leadLabel, -1)
    );
  return configured;
}

function uniqueStrings(...sets: string[][]) {
  return Array.from(
    new Set(sets.flat().map(item => item.trim()).filter(Boolean))
  );
}

function configuredActionMetadata(input: {
  action: ProposedAction;
  configuration: ClientActionConfiguration;
  workflow: WorkflowActionConfiguration;
  workflowKey: string;
}) {
  const payload = input.action.payload;
  const taskPurpose =
    typeof payload.taskPurpose === "string" ? payload.taskPurpose : undefined;
  const timingRule = taskPurpose
    ? input.workflow.timingRules[taskPurpose]
    : undefined;
  const taskTitle = taskPurpose
    ? input.workflow.taskAliases[taskPurpose]
    : undefined;
  const transitionIntent =
    typeof payload.transitionIntent === "string"
      ? payload.transitionIntent
      : undefined;
  const statusIntent =
    typeof payload.statusIntent === "string"
      ? payload.statusIntent
      : undefined;
  const opportunityStage = transitionIntent
    ? input.workflow.opportunityMappings[transitionIntent]
    : undefined;
  const contactStatus = statusIntent
    ? input.workflow.statusMappings[statusIntent] ||
      input.configuration.closureMapping[statusIntent]
    : undefined;
  const requiredPostconditions = uniqueStrings(
    input.workflow.requiredPostconditions,
    input.configuration.requiredPostconditions[input.action.actionType] || []
  );
  const duplicateRules = uniqueStrings(
    input.configuration.duplicateRules,
    input.workflow.duplicateRules
  );

  return {
    workflowConfiguration: {
      workflowKey: input.workflowKey,
      eligibilityStatuses: input.workflow.eligibilityStatuses,
      stopStatuses: input.workflow.stopStatuses,
      officeHours: input.configuration.officeHours || null,
    },
    ...(taskTitle ? { taskTitle } : {}),
    ...(timingRule ? { timingRule } : {}),
    ...(opportunityStage
      ? {
          patch: {
            ...(payload.patch as Record<string, unknown> | undefined),
            stage: opportunityStage,
          },
        }
      : {}),
    ...(contactStatus
      ? {
          fields: {
            ...(payload.fields as Record<string, unknown> | undefined),
            status: contactStatus,
          },
          status: contactStatus,
        }
      : {}),
    duplicateRules,
    requiredPostconditions,
  };
}

async function materializeTemplateAction(input: {
  organisationId: number;
  action: ProposedAction;
  workflow: WorkflowActionConfiguration;
  configuration: ClientActionConfiguration;
  customer: ResolvedAssistantCustomerContext;
}) {
  const channel = input.action.actionType.includes("email")
    ? "email"
    : input.action.actionType.includes("sms")
      ? "sms"
      : input.action.actionType.includes("whatsapp")
        ? "whatsapp"
        : undefined;
  if (!channel) return input.action;
  const purpose =
    typeof input.action.payload.templatePurpose === "string"
      ? input.action.payload.templatePurpose
      : typeof input.action.payload.workflowPurpose === "string"
        ? input.action.payload.workflowPurpose
        : "";
  const templateKey = purpose
    ? input.workflow.templates[purpose]
    : undefined;
  if (!templateKey)
    throw new Error(
      `WORKFLOW_TEMPLATE_REQUIRED: configure the '${purpose || input.action.actionType}' ${channel.toUpperCase()} template for this workflow before it can be prepared.`
    );
  const template = findConfiguredTemplate({
    configuration: input.configuration,
    channel,
    templateKey,
  });
  if (!template)
    throw new Error(
      `WORKFLOW_TEMPLATE_NOT_FOUND: configured template key '${templateKey}' is missing or is not approved for ${channel}.`
    );
  const to = channel === "email" ? input.customer.email : input.customer.phone;
  if (!to)
    throw new Error(
      `WORKFLOW_RECIPIENT_REQUIRED: the exact normalized customer has no ${channel === "email" ? "email address" : "phone number"}.`
    );
  const materialized = await materializeConfiguredCommunication({
    organisationId: input.organisationId,
    channel,
    to,
    template,
  });
  const senderIdentity = resolveConfiguredSender({
    configuration: input.configuration,
    channel,
    template,
  });
  return {
    ...input.action,
    payload: {
      ...input.action.payload,
      to: materialized.to,
      body: materialized.body,
      ...(materialized.subject ? { subject: materialized.subject } : {}),
      templateName: materialized.templateName,
      templateKey,
      contentSource: materialized.contentSource,
      ...(senderIdentity ? { senderIdentity } : {}),
      executionOwner:
        channel === "email" ? "microsoft_delegated" : "commissioned_crm",
      actionVerification: {
        ...((input.action.payload.actionVerification as Record<string, unknown>) || {}),
        recipientVerified: true,
        senderVerified: channel === "email" ? true : Boolean(senderIdentity),
      },
    },
  };
}

function workflowConfigurationKey(request: WorkflowRequest) {
  return request.callOutcome
    ? `${request.workflowKey}:${request.callOutcome}`
    : request.workflowKey;
}

/**
 * Minimal generic workflow materializer. Client-specific subjects, stages,
 * task names, senders, timing and sequence order are data, never engine
 * constants. Outcome-specific variants can be commissioned with keys such as
 * 'post_consultation_follow_up:answered' without teaching the engine client
 * names or statuses.
 */
export async function buildConfiguredWorkflowPlan(input: {
  organisationId: number;
  request: WorkflowRequest;
  customer: ResolvedAssistantCustomerContext;
}) {
  const configuration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const variantKey = workflowConfigurationKey(input.request);
  const workflow =
    configuration.workflows[variantKey] ||
    configuration.workflows[input.request.workflowKey];
  if (!workflow)
    throw new Error(
      `WORKFLOW_CONFIGURATION_REQUIRED: '${variantKey}' has not been commissioned for this organisation.`
    );
  const base = buildWorkflowPlan(input.request);
  const source = actionsFromConfiguration(
    base,
    workflow,
    input.customer.contactName
  );
  const actions: ProposedAction[] = [];
  for (const raw of source) {
    const metadata = configuredActionMetadata({
      action: raw,
      configuration,
      workflow,
      workflowKey: variantKey,
    });
    const configured: ProposedAction = {
      ...raw,
      payload: { ...raw.payload, ...metadata },
    };
    actions.push(
      await materializeTemplateAction({
        organisationId: input.organisationId,
        action: configured,
        workflow,
        configuration,
        customer: input.customer,
      })
    );
  }
  return {
    verificationSummary:
      `${base.verificationSummary} Client sequence, templates, task aliases, mappings, sender identities, timing, duplicate rules and postconditions were resolved from organisation configuration '${variantKey}'.`,
    actions,
    configuration: {
      workflowKey: variantKey,
      sequence: workflow.sequence,
      eligibilityStatuses: workflow.eligibilityStatuses,
      stopStatuses: workflow.stopStatuses,
    },
  };
}
