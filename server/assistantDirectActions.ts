import { createHash } from "node:crypto";
import {
  createWorkflowRun,
  listActionProposals,
  searchApprovedKnowledge,
} from "./db";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { routeConnectedSystemActionsForUser } from "./crmRouter";
import { runGenxAgent } from "./genx";
import { getAutomationPolicy } from "./automationPolicy";
import { executeAutoPreapprovedActions } from "./governedActions";
import {
  requestUsesCurrentCustomerReference,
  resolveAssistantCustomerContext,
  type AssistantCrmSurfaceContext,
} from "./assistantCustomerContext";
import {
  getClientActionConfiguration,
  type ClientActionConfiguration,
  type ConfiguredTemplate,
} from "./clientActionConfiguration";
import {
  prepareCustomCommunication,
  resolveApprovedCommunicationTemplate,
} from "./approvedTemplates";
import { getOutboundSuppressionStatus } from "./communications";

export type DirectAssistantActionResponse = {
  content: string;
  suggestedAction?: { label: string; path: string };
  reviewRequired?: boolean;
  workflowRunId?: number;
  proposalCount?: number;
  actionPreview?: Record<string, unknown>;
};

type Channel = "email" | "sms" | "whatsapp";

function channelFromRequest(value: string): Channel | undefined {
  const normalized = value.toLowerCase();
  if (!/\b(send|draft|write|prepare|reply|respond|email|text|message)\b/.test(normalized))
    return undefined;
  if (/\bwhats\s*app\b/.test(normalized)) return "whatsapp";
  if (/\b(sms|text message)\b/.test(normalized)) return "sms";
  if (/\b(e-?mail|email|reply|respond)\b/.test(normalized)) return "email";
  return undefined;
}

function isDraftOnly(value: string) {
  const normalized = value.toLowerCase();
  return /\b(draft|write|prepare)\b/.test(normalized) && !/\bsend\b/.test(normalized);
}

function isReply(value: string) {
  return /\b(reply|respond)\b/i.test(value);
}

function cleanDraft(value: string) {
  return value
    .replace(/^```(?:html|markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^subject\s*:[^\n]*\n+/i, "")
    .replace(/^body\s*:\s*/i, "")
    .trim()
    .slice(0, 20_000);
}

function emailSubject(request: string, recentInbound?: string) {
  if (isReply(request) && recentInbound) {
    const subject = recentInbound.split(":", 1)[0]?.trim();
    if (subject)
      return /^re:/i.test(subject)
        ? subject.slice(0, 180)
        : `Re: ${subject}`.slice(0, 180);
  }
  const explicit = request.match(
    /\b(?:about|regarding|subject(?: is|:))\s+([^.!?\n]{3,120})/i
  )?.[1]?.trim();
  return explicit ? explicit.slice(0, 180) : "Following up";
}

function idempotencyKey(input: {
  channel: Channel;
  contactExternalId: string;
  request: string;
  templateKey?: string;
}) {
  const day = new Date().toISOString().slice(0, 10);
  const digest = createHash("sha256")
    .update(
      `${input.channel}\0${input.contactExternalId}\0${input.templateKey || "custom"}\0${input.request.trim().toLowerCase()}\0${day}`
    )
    .digest("hex")
    .slice(0, 28);
  return `assistant-direct:${input.channel}:${digest}`;
}

function matchingConfiguredTemplate(
  configuration: ClientActionConfiguration,
  channel: Channel,
  request: string
) {
  const normalized = request.toLowerCase();
  return Object.values(configuration.templates).find(
    template =>
      template.channel === channel &&
      [template.key, template.templateName].some(
        value => value.length >= 3 && normalized.includes(value.toLowerCase())
      )
  );
}

async function materializeConfiguredTemplate(input: {
  organisationId: number;
  channel: Channel;
  to: string;
  template: ConfiguredTemplate;
}) {
  if (input.template.source === "organisation_approved") {
    const resolved = await resolveApprovedCommunicationTemplate({
      organisationId: input.organisationId,
      channel: input.channel,
      templateName: input.template.templateName,
      to: input.to,
    });
    return {
      body: resolved.body,
      subject:
        input.channel === "email"
          ? input.template.requiredSubject || resolved.subject
          : undefined,
      templateName: resolved.templateName || input.template.templateName,
      contentSource: {
        kind: "organisation_approved_template",
        templateKey: input.template.key,
        templateName: input.template.templateName,
        approvalTemplateId: resolved.approvalTemplateId,
        approvalTemplateVersion: resolved.approvalTemplateVersion,
      },
    };
  }
  if (!input.template.body)
    throw new Error(
      input.template.source === "crm_saved"
        ? `TEMPLATE_SOURCE_NOT_COMMISSIONED: '${input.template.templateName}' is configured as a CRM-saved template, but its exact content has not been commissioned into the client configuration yet. Nothing was prepared.`
        : `TEMPLATE_CONTENT_REQUIRED: '${input.template.templateName}' has no configured exact content.`
    );
  if (input.channel === "email" && !input.template.requiredSubject)
    throw new Error(
      `TEMPLATE_SUBJECT_REQUIRED: '${input.template.templateName}' needs its exact saved subject in the client configuration before it can be used.`
    );
  const message = prepareCustomCommunication({
    channel: input.channel,
    to: input.to,
    subject:
      input.channel === "email" ? input.template.requiredSubject : undefined,
    body: input.template.body,
  });
  return {
    body: message.body,
    subject: message.subject,
    templateName: input.template.templateName,
    contentSource: {
      kind:
        input.template.source === "crm_saved"
          ? "commissioned_crm_saved_template"
          : "client_configuration_template",
      templateKey: input.template.key,
      templateName: input.template.templateName,
    },
  };
}

function configuredSender(input: {
  configuration: ClientActionConfiguration;
  channel: Channel;
  template?: ConfiguredTemplate;
}) {
  if (input.channel === "email") return undefined;
  const approved = input.configuration.approvedSenders[input.channel] || [];
  const requested = input.template?.senderIdentity;
  if (requested) {
    if (approved.length && !approved.includes(requested))
      throw new Error(
        `SENDER_NOT_APPROVED: configured sender '${requested}' is not in the organisation's approved ${input.channel.toUpperCase()} sender list.`
      );
    return requested;
  }
  if (approved.length === 1) return approved[0];
  if (approved.length > 1)
    throw new Error(
      `SENDER_REQUIRED: choose or configure the approved ${input.channel.toUpperCase()} sender identity for this action.`
    );
  return undefined;
}

export async function tryPrepareDirectAssistantAction(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  crmContext?: AssistantCrmSurfaceContext;
  request: string;
}): Promise<DirectAssistantActionResponse | undefined> {
  const channel = channelFromRequest(input.request);
  if (!channel) return undefined;

  const currentReference = requestUsesCurrentCustomerReference(input.request);
  const customer = await resolveAssistantCustomerContext({
    organisationId: input.organisationId,
    contactId: input.contactId,
    crmContext: input.crmContext,
  });
  if (!customer)
    return {
      content: currentReference
        ? "I cannot prove which CRM record is the current customer from this page yet. Open a commissioned customer record or choose the customer explicitly. I will not guess from a displayed name."
        : "Choose the customer first. I need one exact normalized CRM record before I can prepare a communication.",
    };

  const destination = channel === "email" ? customer.email : customer.phone;
  if (!destination)
    return {
      content:
        channel === "email"
          ? `${customer.contactName} does not have a verified email address in the normalized CRM record. Nothing was prepared or sent.`
          : `${customer.contactName} does not have a verified phone number in the normalized CRM record. Nothing was prepared or sent.`,
    };

  const configuration = await getClientActionConfiguration({
    organisationId: input.organisationId,
  });
  const configuredTemplate = matchingConfiguredTemplate(
    configuration,
    channel,
    input.request
  );
  let body = "";
  let subject: string | undefined;
  let templateName: string | undefined;
  let contentSource: Record<string, unknown>;

  if (configuredTemplate) {
    const materialized = await materializeConfiguredTemplate({
      organisationId: input.organisationId,
      channel,
      to: destination,
      template: configuredTemplate,
    });
    body = materialized.body;
    subject = materialized.subject;
    templateName = materialized.templateName;
    contentSource = materialized.contentSource;
  } else {
    const knowledge = await searchApprovedKnowledge(
      input.userId,
      input.organisationId,
      input.request
    );
    const draft = await runGenxAgent({
      agentKey: "communications",
      messages: [
        {
          role: "user",
          content:
            `Draft only the ${channel === "email" ? "email body" : channel.toUpperCase() + " message"} for the salesperson's requested customer communication. ` +
            "Use only the supplied customer context and approved business knowledge. Preserve any factual wording the user explicitly supplied. Do not invent prices, availability, guarantees, commitments, dates, customer facts or policy. Do not add commentary about drafting.\n\n" +
            `User request: ${input.request}`,
        },
      ],
      approvedKnowledge: knowledge
        .map(source => `${source.title}\n${source.content || source.sourceUrl || ""}`)
        .join("\n\n"),
      workingContext: JSON.stringify({
        selectedCustomer: customer,
        channel,
        executionBoundary:
          channel === "email"
            ? "Send from the salesperson's delegated Microsoft mailbox."
            : "Execute only through the exact LIVE_PROVEN CRM communication capability.",
      }),
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: `assistant_${channel}_draft`,
        reference: `contact:${customer.contactExternalId}`,
      },
      maxOutputTokens: channel === "email" ? 700 : 220,
    });
    body = cleanDraft(draft.content);
    if (!body)
      return {
        content:
          "I could not produce a safe draft from the available evidence, so nothing was prepared or sent.",
      };
    subject =
      channel === "email"
        ? emailSubject(input.request, customer.recentInbound)
        : undefined;
    contentSource = {
      kind: "assistant_draft",
      approvedKnowledgeOnly: true,
      userRequest: input.request.slice(0, 500),
    };
  }

  const senderIdentity = configuredSender({
    configuration,
    channel,
    template: configuredTemplate,
  });
  const validated = prepareCustomCommunication({
    channel,
    to: destination,
    subject,
    body,
  });
  const suppression = await getOutboundSuppressionStatus({
    organisationId: input.organisationId,
    message: {
      ...validated,
      contactExternalId: customer.contactExternalId,
      opportunityExternalId: customer.opportunityExternalId,
      templateName,
    },
  });
  if (suppression.suppressed)
    return {
      content: `${customer.contactName} is suppressed or opted out for this channel. Nothing was prepared or sent.`,
    };

  const reply = channel === "email" && isReply(input.request);
  const actionType =
    channel === "email"
      ? "send_email"
      : channel === "sms"
        ? configuredTemplate
          ? "send_sms_template"
          : "send_sms"
        : configuredTemplate
          ? "send_whatsapp_template"
          : "send_whatsapp";
  const title =
    channel === "email"
      ? `${reply ? "Reply to" : "Email"} ${customer.contactName}`
      : `${channel === "sms" ? "SMS" : "WhatsApp"} ${customer.contactName}`;
  const action = {
    actionType,
    title,
    targetLabel: customer.contactName,
    idempotencyKey: idempotencyKey({
      channel,
      contactExternalId: customer.contactExternalId,
      request: input.request,
      templateKey: configuredTemplate?.key,
    }),
    payload: {
      reviewRequired: true,
      communicationIntent: reply ? "reply" : "new_message",
      to: validated.to,
      body: validated.body,
      ...(validated.subject ? { subject: validated.subject } : {}),
      ...(templateName ? { templateName } : {}),
      ...(senderIdentity ? { senderIdentity } : {}),
      contactExternalId: customer.contactExternalId,
      opportunityExternalId: customer.opportunityExternalId,
      preferredConnectedSystemId: customer.connectedSystemId,
      preferredProvider: customer.provider,
      source: "shared_assistant_action_planner",
      customerContext: {
        source: customer.targetVerification.source,
        connectedSystemId: customer.connectedSystemId,
        contactExternalId: customer.contactExternalId,
      },
      contentSource,
      executionOwner:
        channel === "email" ? "microsoft_delegated" : "commissioned_crm",
      actionVerification: {
        targetVerified: true,
        recipientVerified: true,
        senderVerified:
          channel === "email" ? true : senderIdentity ? true : undefined,
      },
      compliance: {
        suppressionVerified: suppression.verified,
        optedOut: false,
      },
      duplicateVerification: {
        state: "unknown",
        rule:
          "Execution must re-check external communication history/idempotency immediately before the irreversible send.",
      },
      requiredPostconditions:
        configuration.requiredPostconditions[actionType] || [],
      userRequestedDraftOnly: isDraftOnly(input.request),
    },
  };

  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const [routed] = await routeConnectedSystemActionsForUser({
    userId: input.userId,
    organisationId: input.organisationId,
    actions: [action],
    systems,
  });
  const route = routed.payload.crmRoute as
    | {
        routable?: boolean;
        reason?: string;
        displayName?: string;
        mailbox?: string;
        requiredCapability?: string;
      }
    | undefined;
  if (!route?.routable)
    return {
      content:
        route?.reason ||
        `The ${channel} action is not available on the current verified connections yet. Nothing was sent.`,
    };

  const workflowRunId = await createWorkflowRun({
    userId: input.userId,
    organisationId: input.organisationId,
    workflowKey: "generic_sales_automation",
    leadLabel: customer.contactName,
    payload: {
      source: "shared_assistant_action_planner",
      channel,
      contactExternalId: customer.contactExternalId,
      draftOnly: isDraftOnly(input.request),
    },
    verificationSummary:
      channel === "email"
        ? "Prepared for one exact normalized CRM customer. Content source and Microsoft execution ownership are separate. Recipient, suppression, duplicate and effective-autonomy checks remain explicit."
        : `Prepared for one exact normalized CRM customer and the exact commissioned ${channel.toUpperCase()} CRM capability. Sender, recipient, suppression, duplicate and effective-autonomy checks remain explicit.`,
    actions: [routed],
  });

  if (!isDraftOnly(input.request)) {
    const policy = await getAutomationPolicy({
      userId: input.userId,
      organisationId: input.organisationId,
    });
    const proposals = await listActionProposals(
      input.userId,
      input.organisationId,
      workflowRunId
    );
    const executions = await executeAutoPreapprovedActions({
      userId: input.userId,
      organisationId: input.organisationId,
      proposals,
      policy,
    });
    const completed = executions.find(item => item.success === true);
    if (completed)
      return {
        content:
          channel === "email"
            ? `Sent to ${customer.contactName} from your connected Microsoft mailbox under the effective action policy.`
            : `Sent the ${channel === "sms" ? "SMS" : "WhatsApp message"} to ${customer.contactName} through the verified CRM capability under the effective action policy.`,
        workflowRunId,
        proposalCount: 1,
      };
  }

  return {
    content:
      `I prepared the ${channel === "email" ? "email" : channel === "sms" ? "SMS" : "WhatsApp message"} for ${customer.contactName}. ` +
      "Nothing has been sent yet. Review shows the exact target, content source and execution owner before approval.",
    suggestedAction: { label: "Open Review", path: "/reviews" },
    reviewRequired: true,
    workflowRunId,
    proposalCount: 1,
    actionPreview: {
      target: customer.contactName,
      contactExternalId: customer.contactExternalId,
      recipient: validated.to,
      channel,
      sender:
        channel === "email"
          ? route.mailbox || "Your connected Microsoft mailbox"
          : senderIdentity || "CRM-configured sender",
      subject: validated.subject || null,
      body: validated.body,
      templateName: templateName || null,
      contentSource,
      executionOwner:
        channel === "email" ? "Microsoft delegated mailbox" : route.displayName,
      duplicateVerification: "required_before_execution",
    },
  };
}
