import { eq } from "drizzle-orm";
import {
  connectedSystems,
  type ActionProposal,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  loadConnectionSecret,
  loadUserConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import { connectedSystemSupportsAction } from "../crmRouter";
import { getCrmAdapter } from "./adapterRegistry";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedActivity,
} from "./types";
import { checkApprovedCrmExecutionPreconditions } from "./actionExecutionPreconditions";
import { executeApprovedCrmAction } from "./executeApprovedAction";
import {
  createDelegatedOutlookCalendarEvent,
  sendDelegatedOutlookMail,
} from "../delegatedMailbox";
import {
  findDelegatedSentMailByReference,
  waitForDelegatedSentMailReadback,
} from "../delegatedMailboxReadback";

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
  const system = all.find(
    item =>
      (item.status === "ready" || item.status === "limited_permissions") &&
      (!input.connectedSystemId || item.id === input.connectedSystemId) &&
      (input.provider === "auto" || item.provider === input.provider) &&
      connectedSystemSupportsAction(item, input.actionType)
  );
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
  return supplied;
}

function stableMicrosoftReference(proposal: ActionProposal) {
  return `proposal:${proposal.id}:${proposal.idempotencyKey}`.slice(0, 180);
}

async function executeDelegatedMicrosoft(input: {
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
          "Microsoft accepted the approved email, but Sent Items readback did not become visible during the bounded verification window. Do not retry this action; reconcile the stable review reference first.",
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
      // Graph Calendar transactionId is idempotent only when this value is
      // stable across retries. Correlation IDs are intentionally per-attempt.
      reviewReference: reference,
    });
    if (!result.eventId)
      return {
        success: false,
        detail:
          "Microsoft did not return a calendar event ID, so the external postcondition is not proven. Do not retry until the stable transaction reference is reconciled.",
        provider: "microsoft_delegated",
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: result,
        retryable: false,
      };
    return {
      success: true,
      detail:
        "Approved calendar invitation was created with a stable Microsoft transaction ID and returned an external event ID.",
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
    return {
      verified: Boolean(contact && contact.externalId === contactExternalId),
      detail: "Exact CRM contact context readback completed.",
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
    const current = contact
      ? {
          ...contact.raw,
          status: contact.raw.status || contact.lifecycleStage,
          lifecycleStage: contact.lifecycleStage,
        }
      : {};
    const matches = Boolean(
      contact &&
        Object.entries(patch).every(
          ([key, value]) => norm(current[key]) === norm(value)
        )
    );
    return {
      verified: matches,
      detail: matches
        ? "The exact contact fields were read back from the CRM."
        : "Contact readback did not prove the reviewed update.",
    };
  }

  if (input.actionType === "update_current_opportunity" || input.actionType === "update_opportunity") {
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
    const current = opportunity
      ? { ...opportunity.raw, stage: opportunity.stage, pipeline: opportunity.pipeline }
      : {};
    const patch = fields(input.payload);
    const matches = Boolean(
      opportunity &&
        Object.entries(patch).every(
          ([key, value]) => norm(current[key]) === norm(value)
        )
    );
    return {
      verified: matches,
      detail: matches
        ? "The exact opportunity fields were read back from the CRM."
        : "Opportunity readback did not prove the reviewed update.",
    };
  }

  if (input.actionType === "complete_active_task" || input.actionType === "schedule_callback") {
    const tasks = (await input.adapter.syncTasks({
      connection: input.connection,
      secret: input.secret,
    })).records;
    if (input.actionType === "complete_active_task") {
      const taskExternalId = explicitExternalId(input.payload, "taskExternalId", "externalId");
      const task = tasks.find(item => item.externalId === taskExternalId);
      const verified = Boolean(
        task &&
          (task.completedAt || /complete|closed|done|cancelled/i.test(task.status))
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
    const dueAt = typeof input.payload.dueAt === "string" ? input.payload.dueAt : undefined;
    const task = tasks.find(
      item =>
        (!item.contactExternalId || item.contactExternalId === contactExternalId) &&
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
    const activities = (await input.adapter.syncActivities({
      connection: input.connection,
      secret: input.secret,
    })).records.filter(
      item => !item.contactExternalId || item.contactExternalId === contactExternalId
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
        input.payload.body ?? input.payload.templateText ?? input.payload.message ?? ""
      ).trim();
      const channel = input.actionType.includes("whatsapp") ? "whatsapp" : "sms";
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
        return !expectedSender || (observedSender && norm(observedSender) === norm(expectedSender));
      });
      return {
        verified: Boolean(match),
        detail: match
          ? `The exact ${channel.toUpperCase()} and commissioned sender were read back from external CRM activity.`
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
    const body = String(
      object(input.payload.fields).body ||
        object(input.payload.fields).content ||
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

  return { verified: true, detail: "The underlying executor supplied the required postcondition." };
}

/**
 * Canonical execution wrapper for every reviewed/auto-preapproved action.
 * It performs fresh external preconditions before the irreversible write and
 * independent external readback afterwards. Microsoft uses stable action
 * references rather than per-attempt correlation IDs for idempotency.
 */
export async function executeGuardedApprovedCrmAction(input: {
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
    return executeDelegatedMicrosoft({ ...input, payload });

  const batchPlan = object(payload.batchPlan);
  const effectiveActionType =
    input.proposal.actionType === "deterministic_crm_batch" &&
    typeof batchPlan.actionType === "string"
      ? batchPlan.actionType
      : input.proposal.actionType;
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

  if (input.proposal.actionType !== "deterministic_crm_batch") {
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
  }

  const result = await executeApprovedCrmAction(input);
  if (input.proposal.actionType === "deterministic_crm_batch") return result;
  const postcondition = await verifyCrmPostcondition({
    actionType: input.proposal.actionType,
    adapter,
    connection,
    secret,
    proposal: input.proposal,
    payload,
  });
  if (!postcondition.verified)
    return {
      ...result,
      success: false,
      detail: postcondition.detail,
      retryable: false,
      guardedReadbackVerified: false,
    };
  return {
    ...result,
    success: true,
    detail: postcondition.detail,
    guardedReadbackVerified: true,
  };
}
