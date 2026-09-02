import { and, eq } from "drizzle-orm";
import {
  auditEntries,
  connectedSystems,
  type ActionProposal,
} from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import {
  loadConnectionSecret,
  loadUserConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import { connectedSystemSupportsAction } from "../crmRouter";
import { getCrmAdapter } from "./adapterRegistry";
import type {
  AdapterConnection,
  AdapterEvidence,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedActivity,
} from "./types";
import { checkApprovedCrmExecutionPreconditions } from "./actionExecutionPreconditions";
import { sendSalesMessage } from "../communications";
import {
  createDelegatedOutlookCalendarEvent,
  sendDelegatedOutlookMail,
} from "../delegatedMailbox";
import {
  findDelegatedSentMailByReference,
  waitForDelegatedSentMailReadback,
} from "../delegatedMailboxReadback";
import {
  executeAssistantCrmBatch,
  validateAssistantCrmBatchPlan,
} from "./assistantBatchExecution";
import { runGenxAgent } from "../genx";

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

function activityBody(activity: NormalizedActivity) {
  return String(
    activity.body ||
      activity.raw.body ||
      activity.raw.message ||
      activity.raw.content ||
      ""
  ).trim();
}

function activityChannel(activity: NormalizedActivity) {
  return norm(
    activity.raw.channel || activity.raw.activityType || activity.activityType
  );
}

function activitySender(activity: NormalizedActivity) {
  return String(
    activity.raw.senderIdentity ||
      activity.raw.sender ||
      activity.raw.from ||
      activity.raw.fromNumber ||
      ""
  ).trim();
}

async function verifiedSystem(input: {
  organisationId: number;
  provider: string;
  actionType: string;
  connectedSystemId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const all = await db
    .select()
    .from(connectedSystems)
    .where(eq(connectedSystems.organisationId, input.organisationId));
  const priority = [
    "genie",
    "hubspot",
    "salesforce",
    "pipedrive",
    "zoho",
    "custom_browser",
  ];
  const candidates = all
    .filter(
      item =>
        (item.status === "ready" || item.status === "limited_permissions") &&
        (!input.connectedSystemId || item.id === input.connectedSystemId) &&
        (input.provider === "auto" || item.provider === input.provider) &&
        connectedSystemSupportsAction(item, input.actionType)
    )
    .sort(
      (a, b) => priority.indexOf(a.provider) - priority.indexOf(b.provider)
    );
  const system = candidates[0];
  if (!system)
    throw new Error(
      `EXECUTION_CAPABILITY_STALE: no verified CRM route can still perform '${input.actionType}'. Nothing was changed.`
    );
  return system;
}

async function connectionSecret(input: {
  userId: number;
  organisationId: number;
  system: typeof connectedSystems.$inferSelect;
}): Promise<ConnectionSecretPayload> {
  const browser =
    input.system.connectionMethod === "browser" ||
    input.system.connectionMethod === "sidecar";
  const secret = browser
    ? await loadUserConnectionSecret({
        userId: input.userId,
        organisationId: input.organisationId,
        connectedSystemId: input.system.id,
        secretKind: "browser",
      })
    : await loadConnectionSecret({
        organisationId: input.organisationId,
        connectedSystemId: input.system.id,
        secretKind: "oauth",
      });
  if (!secret)
    throw new Error(
      browser
        ? "Your private CRM session expired before execution. Sign in again; nothing was changed."
        : "The CRM credential is no longer available. Nothing was changed."
    );
  return secret;
}

function calendarAttendees(payload: Record<string, unknown>, fallback: string) {
  const supplied = Array.isArray(payload.attendees)
    ? payload.attendees.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  if (typeof payload.to === "string") supplied.push(payload.to);
  if (!supplied.length && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallback))
    supplied.push(fallback);
  return Array.from(new Set(supplied));
}

function stableMicrosoftReference(proposal: ActionProposal) {
  return `proposal:${proposal.id}:${proposal.idempotencyKey}`.slice(0, 180);
}

async function executeMicrosoft(input: {
  organisationId: number;
  proposal: ActionProposal;
  correlationId: string;
  payload: Record<string, unknown>;
}) {
  const reference = stableMicrosoftReference(input.proposal);
  if (
    input.proposal.actionType === "send_email" ||
    input.proposal.actionType === "send_email_template"
  ) {
    const prior = await findDelegatedSentMailByReference({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      reviewReference: reference,
    });
    if (prior.found)
      return {
        success: true,
        skipped: true,
        duplicatePrevented: true,
        detail:
          "Microsoft Sent Items already contains this exact approved action reference, so the email was not sent twice.",
        provider: "microsoft_delegated",
        correlationId: input.correlationId,
        completedAt: prior.sentDateTime || new Date().toISOString(),
        providerResult: prior,
        retryable: false,
      };
    await sendDelegatedOutlookMail({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      to: String(input.payload.to ?? input.payload.email ?? ""),
      subject: String(input.payload.subject ?? input.proposal.title),
      body: String(input.payload.body ?? input.payload.message ?? ""),
      reviewReference: reference,
      contactExternalId:
        typeof input.payload.contactExternalId === "string"
          ? input.payload.contactExternalId
          : undefined,
    });
    const readback = await waitForDelegatedSentMailReadback({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      reviewReference: reference,
    });
    if (!readback.found)
      return {
        success: false,
        acceptedByProvider: true,
        detail:
          "Microsoft accepted the approved email, but Sent Items readback was not visible in the bounded verification window. The stable action reference prevents blind resend; reconcile before any retry.",
        provider: "microsoft_delegated",
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: readback,
        retryable: false,
      };
    return {
      success: true,
      detail:
        "Approved email was sent from the user's delegated Microsoft mailbox and read back from Sent Items using the stable action reference.",
      provider: "microsoft_delegated",
      correlationId: input.correlationId,
      completedAt: readback.sentDateTime || new Date().toISOString(),
      providerResult: readback,
      retryable: false,
    };
  }
  if (input.proposal.actionType === "create_calendar_event") {
    const startIso =
      typeof input.payload.startIso === "string"
        ? input.payload.startIso
        : typeof input.payload.start === "string"
          ? input.payload.start
          : "";
    const endIso =
      typeof input.payload.endIso === "string"
        ? input.payload.endIso
        : typeof input.payload.end === "string"
          ? input.payload.end
          : "";
    const result = await createDelegatedOutlookCalendarEvent({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      subject: String(
        input.payload.subject ?? input.payload.title ?? input.proposal.title
      ),
      body: String(
        input.payload.body ??
          input.payload.message ??
          input.payload.content ??
          input.proposal.title
      ),
      startIso,
      endIso,
      attendees: calendarAttendees(input.payload, input.proposal.targetLabel),
      timezone:
        typeof input.payload.timezone === "string"
          ? input.payload.timezone
          : undefined,
      reviewReference: reference,
    });
    return {
      success: Boolean(result.eventId),
      detail: result.eventId
        ? "Approved calendar invitation was created with a stable Microsoft transaction ID and returned an external event ID."
        : "Microsoft did not return a calendar event ID. Do not retry until the stable transaction reference is reconciled.",
      provider: "microsoft_delegated",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: result,
      retryable: false,
    };
  }
  throw new Error("Unsupported delegated Microsoft action.");
}

async function verifyCrmPostcondition(input: {
  actionType: string;
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  proposal: ActionProposal;
  payload: Record<string, unknown>;
}) {
  const contactExternalId = explicitExternalId(input.payload, "contactExternalId");
  if (input.actionType === "verify_contact_context") {
    if (!contactExternalId) return { verified: false, detail: "No exact contact ID." };
    const contact = await input.adapter.getContact({
      connection: input.connection,
      secret: input.secret,
      externalId: contactExternalId,
    });
    const verified = Boolean(contact && contact.externalId === contactExternalId);
    return {
      verified,
      detail: verified
        ? "Exact CRM contact context was read back immediately."
        : "Exact CRM contact context could not be proven.",
    };
  }
  if (input.actionType === "update_contact" || input.actionType === "update_contact_status") {
    if (!contactExternalId)
      return { verified: false, detail: "Contact update has no exact external ID." };
    const contact = await input.adapter.getContact({
      connection: input.connection,
      secret: input.secret,
      externalId: contactExternalId,
    });
    const patch = fields(input.payload);
    if (!Object.keys(patch).length && input.payload.status !== undefined)
      patch.status = input.payload.status;
    const current: Record<string, unknown> = contact
      ? {
          ...contact.raw,
          status: contact.raw.status || contact.lifecycleStage,
          lifecycleStage: contact.lifecycleStage,
        }
      : {};
    const verified = Boolean(
      contact &&
        Object.entries(patch).every(
          ([key, value]) => norm(current[key]) === norm(value)
        )
    );
    return {
      verified,
      detail: verified
        ? "The exact contact fields were read back from the CRM."
        : "Contact readback did not prove the reviewed update.",
    };
  }
  if (
    input.actionType === "update_current_opportunity" ||
    input.actionType === "update_opportunity"
  ) {
    const opportunityExternalId = explicitExternalId(
      input.payload,
      "opportunityExternalId",
      "externalId"
    );
    if (!opportunityExternalId)
      return { verified: false, detail: "Opportunity update has no exact external ID." };
    const opportunity = await input.adapter.getOpportunity({
      connection: input.connection,
      secret: input.secret,
      externalId: opportunityExternalId,
    });
    const current: Record<string, unknown> = opportunity
      ? {
          ...opportunity.raw,
          stage: opportunity.stage,
          pipeline: opportunity.pipeline,
        }
      : {};
    const patch = fields(input.payload);
    const verified = Boolean(
      opportunity &&
        Object.entries(patch).every(
          ([key, value]) => norm(current[key]) === norm(value)
        )
    );
    return {
      verified,
      detail: verified
        ? "The exact opportunity fields were read back from the CRM."
        : "Opportunity readback did not prove the reviewed update.",
    };
  }
  if (
    input.actionType === "complete_active_task" ||
    input.actionType === "schedule_callback"
  ) {
    const tasks = (
      await input.adapter.syncTasks({
        connection: input.connection,
        secret: input.secret,
      })
    ).records;
    if (input.actionType === "complete_active_task") {
      const taskExternalId = explicitExternalId(
        input.payload,
        "taskExternalId",
        "externalId"
      );
      const task = tasks.find(item => item.externalId === taskExternalId);
      const verified = Boolean(
        task &&
          (task.completedAt ||
            /complete|closed|done|cancelled/i.test(task.status))
      );
      return {
        verified,
        detail: verified
          ? "The exact task completion was read back from the CRM."
          : "Task readback did not prove completion.",
      };
    }
    const title = String(
      input.payload.taskTitle || input.payload.title || input.proposal.title
    ).trim();
    const dueAt =
      typeof input.payload.dueAt === "string" ? input.payload.dueAt : undefined;
    const task = tasks.find(
      item =>
        (!item.contactExternalId ||
          item.contactExternalId === contactExternalId) &&
        norm(item.title) === norm(title) &&
        (!dueAt || item.dueAt?.toISOString() === dueAt)
    );
    return {
      verified: Boolean(task),
      detail: task
        ? "The exact callback task was read back from the CRM."
        : "Callback task readback did not prove creation.",
    };
  }
  if (
    input.actionType === "append_contact_note" ||
    /^send_(?:sms|whatsapp)/.test(input.actionType) ||
    input.actionType === "apply_sequence" ||
    input.actionType === "create_activity"
  ) {
    const activities = (
      await input.adapter.syncActivities({
        connection: input.connection,
        secret: input.secret,
      })
    ).records.filter(
      item =>
        !item.contactExternalId || item.contactExternalId === contactExternalId
    );
    if (input.actionType === "append_contact_note") {
      const body = String(
        input.payload.content ??
          input.payload.note ??
          input.payload.message ??
          input.proposal.title
      ).trim();
      const match = activities.find(item => activityBody(item) === body);
      return {
        verified: Boolean(match),
        detail: match
          ? "The exact note content was read back from CRM activity."
          : "CRM activity did not prove the note append.",
      };
    }
    if (/^send_(?:sms|whatsapp)/.test(input.actionType)) {
      const body = String(
        input.payload.body ??
          input.payload.templateText ??
          input.payload.message ??
          ""
      ).trim();
      const channel = input.actionType.includes("whatsapp")
        ? "whatsapp"
        : "sms";
      const expectedSender = String(input.payload.senderIdentity || "").trim();
      const match = activities.find(item => {
        if (activityBody(item) !== body) return false;
        const observedChannel = activityChannel(item);
        if (
          observedChannel &&
          !observedChannel.includes(channel) &&
          !observedChannel.includes("message")
        )
          return false;
        const observedSender = activitySender(item);
        return (
          !expectedSender ||
          (observedSender && norm(observedSender) === norm(expectedSender))
        );
      });
      return {
        verified: Boolean(match),
        detail: match
          ? `The exact ${channel.toUpperCase()} content and commissioned sender were read back from external CRM activity.`
          : `External CRM activity did not prove both the exact ${channel.toUpperCase()} content and commissioned sender.`,
      };
    }
    if (input.actionType === "apply_sequence") {
      const sequence = String(
        input.payload.sequence ?? input.payload.templateName ?? ""
      ).trim();
      const match = activities.find(item =>
        [item.raw.sequence, item.raw.sequenceName, item.raw.sequenceKey].some(
          value => norm(value) === norm(sequence)
        )
      );
      return {
        verified: Boolean(match),
        detail: match
          ? "The configured sequence is evidenced on the exact CRM customer."
          : "CRM activity did not prove sequence application.",
      };
    }
    const activityFields = object(input.payload.fields);
    const body = String(
      activityFields.body ||
        activityFields.content ||
        input.payload.body ||
        input.payload.content ||
        ""
    ).trim();
    const match = body
      ? activities.find(item => activityBody(item) === body)
      : undefined;
    return {
      verified: Boolean(match),
      detail: match
        ? "The created activity was read back from the CRM."
        : "CRM activity readback did not prove creation.",
    };
  }
  return {
    verified: true,
    detail: "The action completed through its verified adapter contract.",
  };
}

async function executeBatch(input: {
  organisationId: number;
  proposal: ActionProposal;
  correlationId: string;
  payload: Record<string, unknown>;
  connection: AdapterConnection;
  adapter: CrmAdapter;
  secret: ConnectionSecretPayload;
}) {
  const plan = validateAssistantCrmBatchPlan(input.payload.batchPlan);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const priorCompletions = await db
    .select({ metadata: auditEntries.metadata })
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.organisationId, input.organisationId),
        eq(auditEntries.eventType, "assistant_crm_batch_record_completed"),
        eq(auditEntries.entityType, "action_proposal"),
        eq(auditEntries.entityId, String(input.proposal.id))
      )
    );
  const completedKeys = new Set(
    priorCompletions
      .map(entry =>
        typeof entry.metadata.idempotencyKey === "string"
          ? entry.metadata.idempotencyKey
          : ""
      )
      .filter(Boolean)
  );
  return executeAssistantCrmBatch({
    organisationId: input.organisationId,
    proposalId: input.proposal.id,
    correlationId: input.correlationId,
    instruction:
      typeof input.payload.instruction === "string"
        ? input.payload.instruction
        : input.proposal.title,
    plan,
    connection: input.connection,
    adapter: input.adapter,
    secret: input.secret,
    alreadyCompleted: async key => completedKeys.has(key),
    markCompleted: async key => {
      if (completedKeys.has(key)) return;
      completedKeys.add(key);
      await recordAudit({
        userId: input.proposal.userId,
        organisationId: input.organisationId,
        eventType: "assistant_crm_batch_record_completed",
        entityType: "action_proposal",
        entityId: String(input.proposal.id),
        summary:
          "One approved CRM batch record completed deterministic readback.",
        metadata: {
          correlationId: input.correlationId,
          connectedSystemId: input.connection.id,
          operationKey: plan.operationKey,
          idempotencyKey: key,
        },
      });
    },
    resolveAmbiguous: async record => {
      const result = await runGenxAgent({
        agentKey: "supervisor",
        modelTier: "fast",
        billing: {
          userId: input.proposal.userId,
          organisationId: input.organisationId,
          feature: "assistant_batch_ambiguity",
          reference: `proposal:${input.proposal.id}:record:${record.externalId}`,
        },
        messages: [
          {
            role: "user",
            content: `The approved batch predicate is '${plan.structuredPredicate}'. Determine whether this one ambiguous CRM record qualifies. Return only YES or NO.\n${JSON.stringify({ externalId: record.externalId, raw: record.raw }).slice(0, 8_000)}`,
          },
        ],
      });
      if (result.provider !== "genx")
        throw new Error(
          "AMBIGUOUS_BATCH_RECORD_REQUIRES_AI: Amarktai intelligence is unavailable for this record."
        );
      return /^yes\b/i.test(result.content.trim());
    },
    onProgress: async progress => {
      await recordAudit({
        userId: input.proposal.userId,
        organisationId: input.organisationId,
        eventType: "assistant_crm_batch_progress",
        entityType: "action_proposal",
        entityId: String(input.proposal.id),
        summary: `Approved CRM batch progress: ${progress.completed} changed, ${progress.skipped} skipped, ${progress.failed} failed.`,
        metadata: {
          correlationId: input.correlationId,
          connectedSystemId: input.connection.id,
          operationKey: plan.operationKey,
          ...progress,
        },
      });
    },
    pageSize: 100,
    concurrency: 8,
    maxRetries: 2,
  });
}

async function executeMutation(input: {
  proposal: ActionProposal;
  correlationId: string;
  payload: Record<string, unknown>;
  connection: AdapterConnection;
  adapter: CrmAdapter;
  secret: ConnectionSecretPayload;
}) {
  const contactExternalId = explicitExternalId(input.payload, "contactExternalId");
  let evidence: AdapterEvidence;
  switch (input.proposal.actionType) {
    case "verify_contact_context": {
      if (!contactExternalId)
        throw new Error(
          "EXACT_CUSTOMER_REQUIRED: context verification requires the stable external contact ID."
        );
      const contact = await input.adapter.getContact({
        connection: input.connection,
        secret: input.secret,
        externalId: contactExternalId,
      });
      if (!contact || contact.externalId !== contactExternalId)
        throw new Error(
          "EXECUTION_TARGET_STALE: the exact customer could not be read from the CRM."
        );
      return {
        operation: "verify_contact_context",
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: { contact },
      } satisfies AdapterEvidence;
    }
    case "append_contact_note":
      evidence = await input.adapter.createNote({
        connection: input.connection,
        secret: input.secret,
        externalId: contactExternalId!,
        body: String(
          input.payload.content ??
            input.payload.note ??
            input.payload.message ??
            input.proposal.title
        ),
        correlationId: input.correlationId,
      });
      break;
    case "schedule_callback": {
      const title = String(
        input.payload.taskTitle || input.payload.title || input.proposal.title
      );
      const dueAt =
        typeof input.payload.dueAt === "string"
          ? input.payload.dueAt
          : undefined;
      if (
        (input.connection.connectionMethod === "browser" ||
          input.connection.connectionMethod === "sidecar") &&
        input.adapter.executeCustomAction
      )
        evidence = await input.adapter.executeCustomAction({
          connection: input.connection,
          secret: input.secret,
          actionName: "task.create_callback",
          payload: {
            ...input.payload,
            contactExternalId,
            title,
            taskTitle: title,
            dueAt,
          },
          correlationId: input.correlationId,
        });
      else
        evidence = await input.adapter.createTask({
          connection: input.connection,
          secret: input.secret,
          title,
          dueAt,
          contactExternalId,
          opportunityExternalId: explicitExternalId(
            input.payload,
            "opportunityExternalId"
          ),
          correlationId: input.correlationId,
        });
      break;
    }
    case "complete_active_task": {
      const taskExternalId = explicitExternalId(
        input.payload,
        "taskExternalId",
        "externalId"
      );
      if (!taskExternalId)
        throw new Error("EXACT_TASK_REQUIRED: no stable task ID is present.");
      evidence = await input.adapter.completeTask({
        connection: input.connection,
        secret: input.secret,
        externalId: taskExternalId,
        correlationId: input.correlationId,
      });
      break;
    }
    case "update_contact_status":
    case "update_contact": {
      const patch = fields(input.payload);
      if (!Object.keys(patch).length && input.payload.status !== undefined)
        patch.status = input.payload.status;
      evidence = await input.adapter.updateContact({
        connection: input.connection,
        secret: input.secret,
        externalId: contactExternalId!,
        patch,
        correlationId: input.correlationId,
      });
      break;
    }
    case "update_current_opportunity":
    case "update_opportunity": {
      const opportunityExternalId = explicitExternalId(
        input.payload,
        "opportunityExternalId",
        "externalId"
      );
      if (!opportunityExternalId)
        throw new Error(
          "EXACT_OPPORTUNITY_REQUIRED: no stable opportunity ID is present."
        );
      evidence = await input.adapter.updateOpportunity({
        connection: input.connection,
        secret: input.secret,
        externalId: opportunityExternalId,
        patch: fields(input.payload),
        correlationId: input.correlationId,
      });
      break;
    }
    case "create_contact":
      if (!input.adapter.createContact)
        throw new Error("The verified CRM adapter cannot create contacts.");
      evidence = await input.adapter.createContact({
        connection: input.connection,
        secret: input.secret,
        fields: fields(input.payload),
        correlationId: input.correlationId,
      });
      break;
    case "create_company":
      if (!input.adapter.createCompany)
        throw new Error("The verified CRM adapter cannot create companies.");
      evidence = await input.adapter.createCompany({
        connection: input.connection,
        secret: input.secret,
        fields: fields(input.payload),
        correlationId: input.correlationId,
      });
      break;
    case "create_opportunity":
      if (!input.adapter.createOpportunity)
        throw new Error("The verified CRM adapter cannot create opportunities.");
      evidence = await input.adapter.createOpportunity({
        connection: input.connection,
        secret: input.secret,
        fields: fields(input.payload),
        correlationId: input.correlationId,
      });
      break;
    case "send_email":
    case "send_email_template":
      throw new Error(
        "EMAIL_EXECUTION_OWNER_INVALID: salesperson email must execute through the user's delegated Microsoft mailbox."
      );
    case "send_sms":
    case "send_sms_template":
      evidence = await sendSalesMessage({
        adapter: input.adapter,
        connection: input.connection,
        secret: input.secret,
        correlationId: input.correlationId,
        message: {
          channel: "sms",
          to: String(input.payload.to ?? input.payload.phone ?? ""),
          body: String(
            input.payload.body ??
              input.payload.templateText ??
              input.payload.message ??
              ""
          ),
          templateName:
            typeof input.payload.templateName === "string"
              ? input.payload.templateName
              : undefined,
          senderIdentity:
            typeof input.payload.senderIdentity === "string"
              ? input.payload.senderIdentity
              : undefined,
          idempotencyKey: input.proposal.idempotencyKey,
          contactExternalId,
          opportunityExternalId: explicitExternalId(
            input.payload,
            "opportunityExternalId"
          ),
        },
      });
      break;
    case "send_whatsapp":
    case "send_whatsapp_template":
      evidence = await sendSalesMessage({
        adapter: input.adapter,
        connection: input.connection,
        secret: input.secret,
        correlationId: input.correlationId,
        message: {
          channel: "whatsapp",
          to: String(input.payload.to ?? input.payload.phone ?? ""),
          body: String(
            input.payload.body ??
              input.payload.templateText ??
              input.payload.message ??
              ""
          ),
          templateName:
            typeof input.payload.templateName === "string"
              ? input.payload.templateName
              : undefined,
          senderIdentity:
            typeof input.payload.senderIdentity === "string"
              ? input.payload.senderIdentity
              : undefined,
          idempotencyKey: input.proposal.idempotencyKey,
          contactExternalId,
          opportunityExternalId: explicitExternalId(
            input.payload,
            "opportunityExternalId"
          ),
        },
      });
      break;
    case "apply_sequence": {
      const sequence = String(
        input.payload.sequence ?? input.payload.templateName ?? ""
      );
      if (!sequence.trim())
        throw new Error("SEQUENCE_REQUIRED: no configured CRM sequence is present.");
      if (input.adapter.applySequence)
        evidence = await input.adapter.applySequence({
          connection: input.connection,
          secret: input.secret,
          externalId: contactExternalId!,
          sequence,
          correlationId: input.correlationId,
        });
      else if (input.adapter.executeCustomAction)
        evidence = await input.adapter.executeCustomAction({
          connection: input.connection,
          secret: input.secret,
          actionName: "applySequence",
          payload: {
            externalId: contactExternalId,
            sequence,
            ...input.payload,
          },
          correlationId: input.correlationId,
        });
      else
        throw new Error("The verified CRM adapter has no sequence operation.");
      break;
    }
    case "create_activity":
      evidence = await input.adapter.createActivity({
        connection: input.connection,
        secret: input.secret,
        activity: {
          ...fields(input.payload),
          contactExternalId,
          opportunityExternalId: explicitExternalId(
            input.payload,
            "opportunityExternalId"
          ),
          contactName: input.proposal.targetLabel,
        },
        correlationId: input.correlationId,
      });
      break;
    case "custom_crm_action": {
      const target = explicitExternalId(
        input.payload,
        "externalId",
        "contactExternalId",
        "opportunityExternalId",
        "taskExternalId"
      );
      if (!target)
        throw new Error(
          "EXACT_EXTERNAL_TARGET_REQUIRED: generic custom actions cannot execute from a displayed name."
        );
      if (!input.adapter.executeCustomAction)
        throw new Error("The verified CRM adapter has no commissioned custom action.");
      evidence = await input.adapter.executeCustomAction({
        connection: input.connection,
        secret: input.secret,
        actionName: String(input.payload.actionName ?? ""),
        payload: input.payload,
        correlationId: input.correlationId,
      });
      break;
    }
    default:
      throw new Error(
        `The verified CRM adapter has no approved execution mapping for '${input.proposal.actionType}'.`
      );
  }
  return evidence;
}

/** Canonical execution boundary for manual Review and permitted automation. */
export async function executeCanonicalApprovedAction(input: {
  organisationId: number;
  proposal: ActionProposal;
  correlationId: string;
}) {
  const payload = input.proposal.payload as Record<string, unknown>;
  if (payload.reviewRequired !== true)
    throw new Error(
      "This proposal does not carry the required review-first guardrail."
    );
  const route = object(payload.crmRoute) as {
    routable?: boolean;
    provider?: string;
    connectedSystemId?: number;
  };
  if (!route.routable || !route.provider)
    throw new Error("This proposal has no verified execution route.");
  if (route.provider === "microsoft_delegated")
    return executeMicrosoft({ ...input, payload });

  const batchPlan =
    input.proposal.actionType === "deterministic_crm_batch"
      ? validateAssistantCrmBatchPlan(payload.batchPlan)
      : undefined;
  const effectiveActionType = batchPlan?.actionType || input.proposal.actionType;
  const system = await verifiedSystem({
    organisationId: input.organisationId,
    provider: route.provider,
    actionType: effectiveActionType,
    connectedSystemId: route.connectedSystemId,
  });
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(system.provider);
  const secret = await connectionSecret({
    userId: input.proposal.userId,
    organisationId: input.organisationId,
    system,
  });

  if (batchPlan)
    return executeBatch({
      ...input,
      payload,
      connection,
      adapter,
      secret,
    });

  const precondition = await checkApprovedCrmExecutionPreconditions({
    actionType: input.proposal.actionType,
    adapter,
    connection,
    secret,
    proposal: input.proposal,
    payload,
  });
  if (precondition.alreadySatisfied)
    return {
      success: true,
      skipped: true,
      duplicatePrevented: true,
      detail: precondition.detail,
      provider: system.provider,
      connectionId: system.id,
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: precondition.evidence || {},
      retryable: false,
    };

  const evidence = await executeMutation({
    proposal: input.proposal,
    correlationId: input.correlationId,
    payload,
    connection,
    adapter,
    secret,
  });
  const shadowMode =
    (
      evidence.providerResult as
        | { data?: { shadowMode?: string } }
        | undefined
    )?.data?.shadowMode === "true";
  if (shadowMode)
    return {
      success: true,
      detail:
        "Shadow-mode simulation completed; no external CRM write was performed.",
      shadowMode: true,
      provider: system.provider,
      connectionId: system.id,
      correlationId: input.correlationId,
      completedAt: evidence.completedAt,
      providerResult: evidence.providerResult,
      screenshotPath: evidence.screenshotPath,
      retryable: false,
    };

  const postcondition = await verifyCrmPostcondition({
    actionType: input.proposal.actionType,
    adapter,
    connection,
    secret,
    proposal: input.proposal,
    payload,
  });
  return {
    success: postcondition.verified,
    detail: postcondition.detail,
    guardedReadbackVerified: postcondition.verified,
    provider: system.provider,
    connectionId: system.id,
    correlationId: input.correlationId,
    completedAt: evidence.completedAt,
    providerResult: evidence.providerResult,
    screenshotPath: evidence.screenshotPath,
    retryable: false,
  };
}
