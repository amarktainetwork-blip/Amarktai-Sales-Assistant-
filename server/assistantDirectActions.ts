import { getOrganisationWorkspaceContext } from "./organisationWorkspace";
import { createHash } from "node:crypto";
import {
  createWorkflowRun,
  getDb,
  listActionProposals,
  searchApprovedKnowledge,
} from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getExactCustomerDetail } from "./customerData";
import { customerHistory } from "../shared/customerHistory";
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
import { renderConfiguredTemplateText } from "./communicationContent";
import { listRelevantAssistantMemories } from "./memory";
import {
  buildGroundedDraftInstruction,
  groundedDraftIssues,
  type GroundedDraftContext,
} from "./assistantDraftGrounding";

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
  if (
    !/\b(send|draft|write|prepare|reply|respond|email|text|message)\b/.test(
      normalized
    )
  )
    return undefined;
  if (/\bwhats\s*app\b/.test(normalized)) return "whatsapp";
  if (/\b(sms|text message)\b/.test(normalized)) return "sms";
  if (/\b(e-?mail|email|reply|respond)\b/.test(normalized)) return "email";
  return undefined;
}

export function isDraftOnly(value: string) {
  const normalized = value.toLowerCase();
  return (
    /\b(draft|write|prepare)\b/.test(normalized) &&
    (!/\bsend\b/.test(normalized) ||
      /\b(?:don['’]t|do not|never|without)\s+send(?:ing)?\b/.test(normalized))
  );
}

function isReply(value: string) {
  return /\b(reply|respond)\b/i.test(value);
}

function draftTimelineBody(value: string) {
  const quoteIndex = value.search(
    /<blockquote|<div[^>]*gmail_quote|\bOn .{0,220}\bwrote:/i
  );
  const current = quoteIndex >= 0 ? value.slice(0, quoteIndex) : value;
  return current
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 700);
}

export function groundedDraftCustomerHistory(
  detail: NonNullable<Awaited<ReturnType<typeof getExactCustomerDetail>>>
) {
  const timeline = customerHistory(
    detail.activities.items,
    detail.communications.items
  )
    .slice(0, 36)
    .map(item => {
      const body = draftTimelineBody(item.body);
      const subject = item.subject ? ` | ${item.subject.slice(0, 180)}` : "";
      return `${new Date(item.occurredAt).toISOString()} | ${item.channel} | ${item.direction}${subject}\n${body || "[No body recorded]"}`;
    });

  const completed = detail.tasks.completed
    .slice(0, 12)
    .map(
      task =>
        `${task.completedAt || task.sourceUpdatedAt || task.dueAt || ""} | Completed task | ${task.title}`
    );
  const opportunities = detail.opportunities.items
    .slice(0, 8)
    .map(
      opportunity =>
        `${opportunity.updatedAt || ""} | Opportunity | ${opportunity.name} | ${opportunity.stage || "stage not recorded"}`
    );

  return [
    "VERIFIED CONVERSATION HISTORY — NEWEST FIRST:",
    ...timeline,
    completed.length ? "RECENT COMPLETED TASKS:" : "",
    ...completed,
    opportunities.length ? "OPPORTUNITY HISTORY:" : "",
    ...opportunities,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 14_000);
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

function emailSubject(request: string, recentInboundSubject?: string) {
  if (isReply(request) && recentInboundSubject) {
    const subject = recentInboundSubject.trim();
    if (subject)
      return /^re:/i.test(subject)
        ? subject.slice(0, 180)
        : `Re: ${subject}`.slice(0, 180);
  }
  const explicit = request
    .match(/\b(?:about|regarding|subject(?: is|:))\s+([^.!?\n]{3,120})/i)?.[1]
    ?.trim();
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
  variables?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    companyName?: string;
  };
}) {
  if (input.template.source === "organisation_approved") {
    const resolved = await resolveApprovedCommunicationTemplate({
      organisationId: input.organisationId,
      channel: input.channel,
      templateName: input.template.templateName,
      to: input.to,
    });
    return {
      body: renderConfiguredTemplateText(resolved.body, input.variables),
      subject:
        input.channel === "email"
          ? renderConfiguredTemplateText(
              input.template.requiredSubject || resolved.subject || "",
              input.variables
            )
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
      input.channel === "email"
        ? renderConfiguredTemplateText(
            input.template.requiredSubject || "",
            input.variables
          )
        : undefined,
    body: renderConfiguredTemplateText(input.template.body, input.variables),
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
    userId: input.userId,
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
  const workspace = await getOrganisationWorkspaceContext(input.organisationId);
  const db = await getDb();
  const salesperson = db
    ? (
        await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
      )[0]
    : undefined;
  const draftingPreferences = await listRelevantAssistantMemories({
    userId: input.userId,
    organisationId: input.organisationId,
    query: `${channel} communication writing style ${input.request}`,
    contactExternalId: customer.contactExternalId,
    maximum: 8,
  });
  const personalStyle = draftingPreferences
    .filter(
      memory =>
        memory.memoryType === "user_preference" && !memory.contactExternalId
    )
    .map(memory => `${memory.subject}: ${memory.content}`)
    .join("\n")
    .slice(0, 4_000);
  const mappedCustomerContext = workspace.customerFieldMappings
    .map(mapping => {
      const value =
        customer.customerAttributes?.customFields?.[mapping.sourceFieldId];
      if (value == null || value === "") return null;
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      return `${mapping.label}: ${rendered}`;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 12)
    .join("\n");
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
      variables: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        fullName: customer.contactName,
        companyName: customer.companyName,
      },
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
    const approvedKnowledge = knowledge
      .map(
        source => `${source.title}\n${source.content || source.sourceUrl || ""}`
      )
      .join("\n\n");
    const exactDetail = await getExactCustomerDetail({
      userId: input.userId,
      organisationId: input.organisationId,
      contactId: customer.contactId,
    });
    if (!exactDetail)
      return {
        content:
          "I could not verify the selected customer's current history, so nothing was prepared or sent.",
      };
    const verifiedHistory = groundedDraftCustomerHistory(exactDetail);
    const grounding: GroundedDraftContext = {
      request: input.request,
      channel,
      salespersonName: salesperson?.name?.trim() || undefined,
      brandVoice:
        workspace.businessContext &&
        typeof workspace.businessContext === "object" &&
        "brandVoice" in workspace.businessContext &&
        typeof workspace.businessContext.brandVoice === "string"
          ? workspace.businessContext.brandVoice
          : undefined,
      personalStyle: personalStyle || undefined,
      contactName: customer.contactName,
      companyName: customer.companyName,
      emailSubject: customer.recentInboundSubject,
      inboundMessage: customer.recentInboundBody || customer.recentInbound,
      opportunityName: customer.opportunityName,
      stage: customer.stage,
      courseInterest: customer.courseInterest,
      customerContext: [
        verifiedHistory,
        mappedCustomerContext,
        ...(customer.operationalRecordState?.openTasks || [])
          .slice(0, 3)
          .map(
            task =>
              `Current task: ${task.title}${task.dueAt ? `; due ${task.dueAt}` : ""}`
          ),
        customer.customerTags?.length
          ? `CRM tags: ${customer.customerTags.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      lastInteraction: customer.lastInteraction,
      outstandingCommitment: customer.objective,
      approvedKnowledge,
    };
    const draft = await runGenxAgent({
      agentKey: "communications",
      messages: [
        {
          role: "user",
          content: buildGroundedDraftInstruction(grounding),
        },
      ],
      approvedKnowledge,
      workingContext: JSON.stringify({
        selectedCustomerId: customer.contactId,
        contactExternalId: customer.contactExternalId,
        channel,
        executionBoundary:
          channel === "email"
            ? "Execute only through the member-selected email source after that exact route is verified and explicitly authorised."
            : "Execute only through the exact LIVE_PROVEN CRM communication capability.",
      }),
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: `assistant_${channel}_draft`,
        reference: `contact:${customer.contactExternalId}`,
      },
      maxContextChars: 50_000,
      maxWorkingContextChars: 6_000,
      maxOutputTokens: channel === "email" ? 700 : 220,
    });
    body = cleanDraft(draft.content);
    const issues = groundedDraftIssues(body, grounding);
    if (issues.length) {
      const repaired = await runGenxAgent({
        agentKey: "communications",
        messages: [
          {
            role: "user",
            content: `${buildGroundedDraftInstruction(grounding)}\n\nThe previous draft failed these deterministic safeguards: ${issues.join(", ")}. Correct those issues and return only the revised message body.`,
          },
        ],
        approvedKnowledge,
        workingContext: JSON.stringify({
          selectedCustomerId: customer.contactId,
          contactExternalId: customer.contactExternalId,
          channel,
        }),
        billing: {
          userId: input.userId,
          organisationId: input.organisationId,
          feature: `assistant_${channel}_draft_grounding_repair`,
          reference: `contact:${customer.contactExternalId}`,
        },
        maxContextChars: 50_000,
        maxWorkingContextChars: 6_000,
        maxOutputTokens: channel === "email" ? 700 : 220,
      });
      body = cleanDraft(repaired.content);
      if (groundedDraftIssues(body, grounding).length)
        return {
          content:
            "I could not produce a draft that stayed consistent with the current customer context, so nothing was prepared or sent.",
        };
    }
    if (!body)
      return {
        content:
          "I could not produce a safe draft from the available evidence, so nothing was prepared or sent.",
      };
    subject =
      channel === "email"
        ? emailSubject(input.request, customer.recentInboundSubject)
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
      contactId: customer.contactId,
      contactExternalId: customer.contactExternalId,
      opportunityExternalId: customer.opportunityExternalId,
      preferredConnectedSystemId: customer.connectedSystemId,
      preferredProvider: customer.provider,
      source: "shared_assistant_action_planner",
      requireFreshCustomerContext: true,
      workflowConfiguration: {
        officeHours: configuration.officeHours || null,
      },
      customerContext: {
        source: customer.targetVerification.source,
        contactId: customer.contactId,
        connectedSystemId: customer.connectedSystemId,
        contactExternalId: customer.contactExternalId,
      },
      contentSource,
      executionOwner:
        channel === "email"
          ? "member_selected_email_source"
          : "commissioned_crm",
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
        rule: "Execution must re-check external communication history/idempotency immediately before the irreversible send.",
      },
      requiredPostconditions:
        configuration.requiredPostconditions[actionType] || [],
      userRequestedDraftOnly: isDraftOnly(input.request),
      draftOnly: isDraftOnly(input.request),
      executionReady: false,
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
  if (!route?.routable && !isDraftOnly(input.request))
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
      contactId: customer.contactId,
      contactExternalId: customer.contactExternalId,
      draftOnly: isDraftOnly(input.request),
    },
    verificationSummary:
      channel === "email"
        ? "Prepared for one exact normalized CRM customer. Content source and the member-selected email execution route are separate. Recipient, suppression, duplicate and effective-autonomy checks remain explicit."
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
    suggestedAction: {
      label: "Open Review",
      path: `/reviews?contactId=${customer.contactId}`,
    },
    reviewRequired: true,
    workflowRunId,
    proposalCount: 1,
    actionPreview: {
      target: customer.contactName,
      contactId: customer.contactId,
      contactExternalId: customer.contactExternalId,
      recipient: validated.to,
      channel,
      sender:
        channel === "email"
          ? route?.mailbox ||
            (typeof routed.payload.executionOwner === "string"
              ? routed.payload.executionOwner
              : "Selected email source is not ready")
          : senderIdentity || "CRM-configured sender",
      subject: validated.subject || null,
      body: validated.body,
      templateName: templateName || null,
      contentSource,
      executionOwner:
        channel === "email"
          ? typeof routed.payload.executionOwner === "string"
            ? routed.payload.executionOwner
            : route?.displayName || "Selected email source is not ready"
          : route?.displayName || "Not configured",
      duplicateVerification: "required_before_execution",
    },
  };
}
