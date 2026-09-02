import { createHash } from "node:crypto";
import {
  createWorkflowRun,
  listActionProposals,
  searchApprovedKnowledge,
} from "./db";
import { getWorkingContextForContact } from "./liveCalls/context";
import { listConnectedSystemsForUser } from "./connectedSystems";
import { routeConnectedSystemActions } from "./crmRouter";
import { runGenxAgent } from "./genx";
import { getAutomationPolicy } from "./automationPolicy";
import { executeAutoPreapprovedActions } from "./governedActions";

export type DirectAssistantActionResponse = {
  content: string;
  suggestedAction?: { label: string; path: string };
  reviewRequired?: boolean;
};

type Channel = "email" | "sms" | "whatsapp";

function channelFromRequest(value: string): Channel | undefined {
  const normalized = value.toLowerCase();
  if (!/\b(send|draft|write|prepare|reply|respond|email|text)\b/.test(normalized))
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
    if (subject) return /^re:/i.test(subject) ? subject.slice(0, 180) : `Re: ${subject}`.slice(0, 180);
  }
  const explicit = request.match(/\b(?:about|regarding|subject(?: is|:))\s+([^.!?\n]{3,120})/i)?.[1]?.trim();
  return explicit ? explicit.slice(0, 180) : "Following up";
}

function idempotencyKey(input: {
  channel: Channel;
  contactExternalId: string;
  request: string;
}) {
  const minute = new Date().toISOString().slice(0, 16);
  const digest = createHash("sha256")
    .update(`${input.channel}\0${input.contactExternalId}\0${input.request.trim().toLowerCase()}\0${minute}`)
    .digest("hex")
    .slice(0, 28);
  return `assistant-direct:${input.channel}:${digest}`;
}

export async function tryPrepareDirectAssistantAction(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  request: string;
}): Promise<DirectAssistantActionResponse | undefined> {
  const channel = channelFromRequest(input.request);
  if (!channel) return undefined;

  if (!input.contactId)
    return {
      content:
        "Choose the customer in the customer selector above first. I will use that exact CRM record so I never guess who should receive the message.",
    };

  const customer = await getWorkingContextForContact({
    organisationId: input.organisationId,
    contactId: input.contactId,
  });
  const destination = channel === "email" ? customer.email : customer.phone;
  if (!destination)
    return {
      content:
        channel === "email"
          ? `${customer.contactName} does not have a verified email address in the synchronized CRM record yet. I have not created or sent anything.`
          : `${customer.contactName} does not have a verified phone number in the synchronized CRM record yet. I have not created or sent anything.`,
    };

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
  const body = cleanDraft(draft.content);
  if (!body)
    return {
      content:
        "I could not produce a safe draft from the available evidence, so nothing was prepared or sent.",
    };

  const reply = channel === "email" && isReply(input.request);
  const actionType =
    channel === "email"
      ? reply
        ? "send_email_template"
        : "send_email"
      : channel === "sms"
        ? "send_sms"
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
    }),
    payload: {
      reviewRequired: true,
      duplicateProtection:
        "Verify the exact recipient and external state immediately before execution; never repeat a completed communication.",
      to: destination,
      body,
      ...(channel === "email"
        ? { subject: emailSubject(input.request, customer.recentInbound) }
        : {}),
      contactExternalId: customer.contactExternalId,
      preferredConnectedSystemId: customer.connectedSystemId,
      preferredProvider: customer.provider,
      source: "assistant_selected_customer",
      userRequestedDraftOnly: isDraftOnly(input.request),
    },
  };

  const systems = await listConnectedSystemsForUser(
    input.userId,
    input.organisationId
  );
  const [routed] = routeConnectedSystemActions([action], systems);
  const route = routed.payload.crmRoute as
    | { routable?: boolean; reason?: string; displayName?: string }
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
      source: "assistant_selected_customer",
      channel,
      contactExternalId: customer.contactExternalId,
      draftOnly: isDraftOnly(input.request),
    },
    verificationSummary:
      channel === "email"
        ? "Prepared for the exact selected CRM customer and routed to the salesperson's delegated Microsoft mailbox. Recipient, suppression, duplicate and approval/autonomy checks remain mandatory."
        : `Prepared for the exact selected CRM customer and routed only through the LIVE_PROVEN ${channel.toUpperCase()} CRM capability. Recipient, suppression, duplicate and approval/autonomy checks remain mandatory.`,
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
            ? `Sent to ${customer.contactName} from your connected Microsoft mailbox under your approved autonomy policy.`
            : `Sent the ${channel === "sms" ? "SMS" : "WhatsApp message"} to ${customer.contactName} through the verified CRM capability under your approved autonomy policy.`,
      };
  }

  return {
    content:
      `I prepared the ${channel === "email" ? "email" : channel === "sms" ? "SMS" : "WhatsApp message"} for ${customer.contactName}. ` +
      "Nothing has been sent yet. Open Review to edit or approve it.",
    suggestedAction: { label: "Open Review", path: "/reviews" },
    reviewRequired: true,
  };
}
