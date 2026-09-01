import { and, eq } from "drizzle-orm";
import {
  auditEntries,
  connectedSystems,
  inboundMessages,
  type ActionProposal,
} from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import { getCrmAdapter } from "./adapterRegistry";
import {
  loadConnectionSecret,
  loadUserConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import { sendSalesMessage } from "../communications";
import { connectedSystemSupportsAction } from "../crmRouter";
import { createOutlookCalendarEvent, getOutlookReadiness } from "../outlook";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedContact,
} from "./types";
import {
  executeAssistantCrmBatch,
  validateAssistantCrmBatchPlan,
} from "./assistantBatchExecution";
import { runGenxAgent } from "../genx";
import { sendDelegatedOutlookMail } from "../delegatedMailbox";

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

async function verifiedSystem(
  organisationId: number,
  provider: string,
  actionType: string,
  requestedId?: unknown
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const requested = typeof requestedId === "number" ? requestedId : undefined;
  const all = await db
    .select()
    .from(connectedSystems)
    .where(eq(connectedSystems.organisationId, organisationId));
  const candidates = all.filter(
    system =>
      (system.status === "ready" || system.status === "limited_permissions") &&
      (!requested || system.id === requested) &&
      (provider === "auto" || system.provider === provider) &&
      connectedSystemSupportsAction(system, actionType)
  );
  const priority = [
    "genie",
    "hubspot",
    "salesforce",
    "pipedrive",
    "zoho",
    "custom_browser",
  ];
  candidates.sort(
    (a, b) => priority.indexOf(a.provider) - priority.indexOf(b.provider)
  );
  const system = candidates[0];
  if (!system)
    throw new Error(
      `No organisation CRM with an independently verified capability can perform '${actionType}'. Verify that specific CRM function and retry.`
    );
  return system;
}

async function connectionSecret(
  userId: number,
  organisationId: number,
  system: typeof connectedSystems.$inferSelect
): Promise<ConnectionSecretPayload> {
  const browser =
    system.connectionMethod === "browser" ||
    system.connectionMethod === "sidecar";
  const secret = browser
    ? await loadUserConnectionSecret({
        userId,
        organisationId,
        connectedSystemId: system.id,
        secretKind: "browser",
      })
    : await loadConnectionSecret({
        organisationId,
        connectedSystemId: system.id,
        secretKind: "oauth",
      });
  if (!secret && browser)
    throw new Error(
      "Your CRM needs you to sign in again before this approved change can be applied."
    );
  if (!secret)
    throw new Error(
      "The CRM connection needs attention before this approved change can be applied."
    );
  return secret;
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
function contactLabel(contact: NormalizedContact) {
  return `${contact.firstName || ""} ${contact.lastName || ""}`
    .trim()
    .toLowerCase();
}
async function resolveContact(input: {
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  proposal: ActionProposal;
  payload: Record<string, unknown>;
}) {
  const direct = explicitExternalId(input.payload, "contactExternalId");
  if (direct) {
    const contact = await input.adapter.getContact({
      connection: input.connection,
      secret: input.secret,
      externalId: direct,
    });
    return contact || { externalId: direct, raw: {} };
  }
  const query = input.proposal.targetLabel.trim();
  const matches = await input.adapter.searchContacts({
    connection: input.connection,
    secret: input.secret,
    query,
  });
  if (!matches.length)
    throw new Error(
      `No CRM contact matched '${query}'. Open the target record or supply its external contact ID.`
    );
  if (matches.length === 1) return matches[0];
  const normalized = query.toLowerCase();
  const exact = matches.filter(
    contact =>
      contact.externalId === query ||
      contact.email?.toLowerCase() === normalized ||
      contactLabel(contact) === normalized
  );
  if (exact.length === 1) return exact[0];
  throw new Error(
    `CRM search returned ${matches.length} possible contacts for '${query}'. Supply the exact external contact ID to avoid acting on the wrong person.`
  );
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

async function verifyApprovedCrmPostcondition(input: {
  actionType: string;
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  proposal: ActionProposal;
  payload: Record<string, unknown>;
  evidence: { providerResult?: Record<string, unknown> };
}) {
  const id = explicitExternalId(
    input.payload,
    "externalId",
    "contactExternalId",
    "opportunityExternalId",
    "taskExternalId"
  );
  const patch = fields(input.payload);
  if (input.actionType === "update_contact") {
    if (!id)
      return {
        verified: false,
        detail: "Contact update has no stable external ID for readback.",
      };
    const contact = await input.adapter.getContact({
      connection: input.connection,
      secret: input.secret,
      externalId: id,
    });
    const matches =
      contact &&
      Object.entries(patch).every(
        ([key, value]) => String(contact.raw[key] ?? "") === String(value)
      );
    return {
      verified: Boolean(matches),
      detail: matches
        ? "Contact fields were read back from the CRM."
        : "Contact readback did not prove the requested update.",
    };
  }
  if (input.actionType === "update_opportunity") {
    if (!id)
      return {
        verified: false,
        detail: "Opportunity update has no stable external ID for readback.",
      };
    const opportunity = await input.adapter.getOpportunity({
      connection: input.connection,
      secret: input.secret,
      externalId: id,
    });
    const matches =
      opportunity &&
      Object.entries(patch).every(
        ([key, value]) => String(opportunity.raw[key] ?? "") === String(value)
      );
    return {
      verified: Boolean(matches),
      detail: matches
        ? "Opportunity fields were read back from the CRM."
        : "Opportunity readback did not prove the requested update.",
    };
  }
  if (
    input.actionType === "schedule_callback" ||
    input.actionType === "complete_active_task"
  ) {
    const tasks = (
      await input.adapter.syncTasks({
        connection: input.connection,
        secret: input.secret,
      })
    ).records;
    const dueAt =
      typeof input.payload.dueAt === "string" ? input.payload.dueAt : undefined;
    const task = tasks.find(
      item =>
        (id && item.externalId === id) ||
        (!id &&
          item.title
            .toLowerCase()
            .includes(input.proposal.targetLabel.toLowerCase()))
    );
    const complete =
      input.actionType === "complete_active_task"
        ? Boolean(task && /complete|closed|done/i.test(task.status))
        : Boolean(task && (!dueAt || task.dueAt?.toISOString() === dueAt));
    return {
      verified: complete,
      detail: complete
        ? "Task postcondition was read back from the CRM."
        : "Task readback did not prove the requested postcondition.",
    };
  }
  const browserReadback =
    (
      input.evidence.providerResult as
        | { data?: { readbackVerified?: boolean } }
        | undefined
    )?.data?.readbackVerified === true;
  return {
    verified: browserReadback,
    detail: browserReadback
      ? "The adapter supplied explicit deterministic readback evidence."
      : "This write has no deterministic CRM readback evidence.",
  };
}

export async function executeApprovedCrmAction(input: {
  organisationId: number;
  proposal: ActionProposal;
  correlationId: string;
}) {
  const payload = input.proposal.payload as Record<string, unknown>;
  if (payload.reviewRequired !== true)
    throw new Error(
      "This proposal does not carry the required review-first guardrail."
    );
  const route = payload.crmRoute as
    | { routable?: boolean; provider?: string; connectedSystemId?: number }
    | undefined;
  if (!route?.routable || !route.provider)
    throw new Error("This proposal has no verified execution route.");

  if (
    route.provider === "microsoft_delegated" &&
    (input.proposal.actionType === "send_email" ||
      input.proposal.actionType === "send_email_template")
  ) {
    const result = await sendDelegatedOutlookMail({
      userId: input.proposal.userId,
      organisationId: input.organisationId,
      to: String(payload.to ?? payload.email ?? ""),
      subject: String(payload.subject ?? input.proposal.title),
      body: String(payload.body ?? payload.message ?? ""),
      reviewReference: input.correlationId,
      contactExternalId:
        typeof payload.contactExternalId === "string"
          ? payload.contactExternalId
          : undefined,
    });
    const inboundMessageId = Number(payload.inboundMessageId);
    if (Number.isInteger(inboundMessageId) && inboundMessageId > 0) {
      const db = await getDb();
      if (db)
        await db
          .update(inboundMessages)
          .set({ needsAction: false, status: "archived" })
          .where(
            and(
              eq(inboundMessages.id, inboundMessageId),
              eq(inboundMessages.organisationId, input.organisationId),
              eq(inboundMessages.mailboxUserId, input.proposal.userId)
            )
          );
    }
    return {
      success: true,
      detail: "Approved email sent from your connected Microsoft mailbox.",
      provider: "microsoft_delegated",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: result,
      retryable: false,
    };
  }

  if (input.proposal.actionType === "create_calendar_event") {
    if (route.provider !== "outlook" || !getOutlookReadiness().ready)
      throw new Error(
        "Microsoft Outlook calendar is not configured for this approved action."
      );
    const startIso =
      typeof payload.startIso === "string"
        ? payload.startIso
        : typeof payload.start === "string"
          ? payload.start
          : "";
    const endIso =
      typeof payload.endIso === "string"
        ? payload.endIso
        : typeof payload.end === "string"
          ? payload.end
          : "";
    const result = await createOutlookCalendarEvent({
      subject: String(payload.subject ?? payload.title ?? input.proposal.title),
      body: String(
        payload.body ??
          payload.message ??
          payload.content ??
          input.proposal.title
      ),
      startIso,
      endIso,
      attendees: calendarAttendees(payload, input.proposal.targetLabel),
      timezone:
        typeof payload.timezone === "string" ? payload.timezone : undefined,
      reviewReference: input.correlationId,
    });
    return {
      success: true,
      detail: "Approved Microsoft Outlook calendar event created.",
      provider: "outlook",
      correlationId: input.correlationId,
      completedAt: new Date().toISOString(),
      providerResult: result,
      retryable: false,
    };
  }

  const batchPlan =
    input.proposal.actionType === "deterministic_crm_batch"
      ? validateAssistantCrmBatchPlan(payload.batchPlan)
      : undefined;
  const effectiveActionType =
    batchPlan?.actionType || input.proposal.actionType;
  const system = await verifiedSystem(
    input.organisationId,
    route.provider,
    effectiveActionType,
    route.connectedSystemId
  );
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(system.provider);
  const secret = await connectionSecret(
    input.proposal.userId,
    input.organisationId,
    system
  );
  if (batchPlan) {
    const instruction =
      typeof payload.instruction === "string"
        ? payload.instruction
        : input.proposal.title;
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
      instruction,
      plan: batchPlan,
      connection,
      adapter,
      secret,
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
            connectedSystemId: system.id,
            operationKey: batchPlan.operationKey,
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
              content: `The approved batch predicate is '${batchPlan.structuredPredicate}'. Determine whether this one ambiguous CRM record qualifies. Return only YES or NO.\n${JSON.stringify({ externalId: record.externalId, raw: record.raw }).slice(0, 8_000)}`,
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
            connectedSystemId: system.id,
            operationKey: batchPlan.operationKey,
            ...progress,
          },
        });
      },
      pageSize: 100,
      concurrency: 8,
      maxRetries: 2,
    });
  }
  const browserTarget = () =>
    explicitExternalId(
      payload,
      "externalId",
      "contactExternalId",
      "opportunityExternalId",
      "taskExternalId"
    ) || input.proposal.targetLabel.trim();
  let evidence;

  switch (input.proposal.actionType) {
    case "verify_contact_context": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      return {
        success: true,
        detail: "CRM contact context verified.",
        provider: system.provider,
        connectionId: system.id,
        correlationId: input.correlationId,
        completedAt: new Date().toISOString(),
        providerResult: { contact },
        retryable: false,
      };
    }
    case "append_contact_note": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      evidence = await adapter.createNote({
        connection,
        secret,
        externalId: contact.externalId,
        body: String(
          payload.content ??
            payload.note ??
            payload.message ??
            input.proposal.title
        ),
        correlationId: input.correlationId,
      });
      break;
    }
    case "schedule_callback": {
      let contactExternalId = explicitExternalId(payload, "contactExternalId");
      if (
        !contactExternalId &&
        connection.connectionMethod !== "browser" &&
        connection.connectionMethod !== "sidecar"
      )
        contactExternalId = (
          await resolveContact({
            adapter,
            connection,
            secret,
            proposal: input.proposal,
            payload,
          })
        ).externalId;
      if (
        (connection.connectionMethod === "browser" ||
          connection.connectionMethod === "sidecar") &&
        adapter.executeCustomAction
      )
        evidence = await adapter.executeCustomAction({
          connection,
          secret,
          actionName: "task.create_callback",
          payload: {
            ...payload,
            contactExternalId,
            title: String(
              payload.taskTitle ?? payload.title ?? input.proposal.title
            ),
            dueAt:
              typeof payload.dueAt === "string" ? payload.dueAt : undefined,
          },
          correlationId: input.correlationId,
        });
      else
        evidence = await adapter.createTask({
          connection,
          secret,
          title: String(
            payload.taskTitle ?? payload.title ?? input.proposal.title
          ),
          dueAt: typeof payload.dueAt === "string" ? payload.dueAt : undefined,
          contactExternalId,
          opportunityExternalId: explicitExternalId(
            payload,
            "opportunityExternalId"
          ),
          correlationId: input.correlationId,
        });
      break;
    }
    case "complete_active_task": {
      const taskId =
        explicitExternalId(payload, "taskExternalId", "externalId") ||
        (connection.connectionMethod === "browser" ||
        connection.connectionMethod === "sidecar"
          ? browserTarget()
          : undefined);
      if (!taskId)
        throw new Error(
          "Completing a CRM task requires its external task ID for API-connected CRMs."
        );
      evidence = await adapter.completeTask({
        connection,
        secret,
        externalId: taskId,
        correlationId: input.correlationId,
      });
      break;
    }
    case "update_contact_status":
    case "update_contact": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      const patch = fields(payload);
      if (!Object.keys(patch).length && payload.status !== undefined)
        patch.status = payload.status;
      evidence = await adapter.updateContact({
        connection,
        secret,
        externalId: contact.externalId,
        patch,
        correlationId: input.correlationId,
      });
      break;
    }
    case "update_current_opportunity":
    case "update_opportunity": {
      const opportunityId =
        explicitExternalId(payload, "opportunityExternalId", "externalId") ||
        (connection.connectionMethod === "browser" ||
        connection.connectionMethod === "sidecar"
          ? browserTarget()
          : undefined);
      if (!opportunityId)
        throw new Error(
          "Updating an opportunity requires its external opportunity ID for API-connected CRMs."
        );
      evidence = await adapter.updateOpportunity({
        connection,
        secret,
        externalId: opportunityId,
        patch: fields(payload),
        correlationId: input.correlationId,
      });
      break;
    }
    case "create_contact":
      if (!adapter.createContact)
        throw new Error(
          `${system.provider} does not support creating contacts through its verified adapter.`
        );
      else {
        evidence = await adapter.createContact({
          connection,
          secret,
          fields: fields(payload),
          correlationId: input.correlationId,
        });
        break;
      }
    case "create_company":
      if (!adapter.createCompany)
        throw new Error(
          `${system.provider} does not support creating companies through its verified adapter.`
        );
      else {
        evidence = await adapter.createCompany({
          connection,
          secret,
          fields: fields(payload),
          correlationId: input.correlationId,
        });
        break;
      }
    case "create_opportunity":
      if (!adapter.createOpportunity)
        throw new Error(
          `${system.provider} does not support creating opportunities through its verified adapter.`
        );
      else {
        evidence = await adapter.createOpportunity({
          connection,
          secret,
          fields: fields(payload),
          correlationId: input.correlationId,
        });
        break;
      }
    case "send_email_template":
    case "send_email": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      evidence = await sendSalesMessage({
        adapter,
        connection,
        secret,
        correlationId: input.correlationId,
        message: {
          channel: "email",
          to: String(payload.to ?? payload.email ?? contact.email ?? ""),
          subject: String(
            payload.subject ??
              payload.savedSubject ??
              payload.templateName ??
              input.proposal.title
          ),
          body: String(
            payload.body ?? payload.templateText ?? payload.message ?? ""
          ),
          templateName:
            typeof payload.templateName === "string"
              ? payload.templateName
              : undefined,
          contactExternalId: contact.externalId,
          opportunityExternalId: explicitExternalId(
            payload,
            "opportunityExternalId"
          ),
        },
      });
      break;
    }
    case "send_sms_template":
    case "send_sms": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      evidence = await sendSalesMessage({
        adapter,
        connection,
        secret,
        correlationId: input.correlationId,
        message: {
          channel: "sms",
          to: String(payload.to ?? payload.phone ?? contact.phone ?? ""),
          body: String(
            payload.body ?? payload.templateText ?? payload.message ?? ""
          ),
          templateName:
            typeof payload.templateName === "string"
              ? payload.templateName
              : undefined,
          contactExternalId: contact.externalId,
          opportunityExternalId: explicitExternalId(
            payload,
            "opportunityExternalId"
          ),
        },
      });
      break;
    }
    case "send_whatsapp_template":
    case "send_whatsapp": {
      const contact = await resolveContact({
        adapter,
        connection,
        secret,
        proposal: input.proposal,
        payload,
      });
      evidence = await sendSalesMessage({
        adapter,
        connection,
        secret,
        correlationId: input.correlationId,
        message: {
          channel: "whatsapp",
          to: String(payload.to ?? payload.phone ?? contact.phone ?? ""),
          body: String(
            payload.body ?? payload.templateText ?? payload.message ?? ""
          ),
          templateName:
            typeof payload.templateName === "string"
              ? payload.templateName
              : undefined,
          contactExternalId: contact.externalId,
          opportunityExternalId: explicitExternalId(
            payload,
            "opportunityExternalId"
          ),
        },
      });
      break;
    }
    case "apply_sequence":
      if (adapter.applySequence)
        evidence = await adapter.applySequence({
          connection,
          secret,
          externalId: browserTarget(),
          sequence: String(payload.sequence ?? payload.templateName ?? ""),
          correlationId: input.correlationId,
        });
      else if (adapter.executeCustomAction)
        evidence = await adapter.executeCustomAction({
          connection,
          secret,
          actionName: "applySequence",
          payload: { externalId: browserTarget(), ...payload },
          correlationId: input.correlationId,
        });
      else
        throw new Error(
          `${system.provider} does not expose a verified sequence operation.`
        );
      break;
    case "create_activity":
      evidence = await adapter.createActivity({
        connection,
        secret,
        activity: {
          ...fields(payload),
          contactExternalId: explicitExternalId(payload, "contactExternalId"),
          opportunityExternalId: explicitExternalId(
            payload,
            "opportunityExternalId"
          ),
          contactName: input.proposal.targetLabel,
        },
        correlationId: input.correlationId,
      });
      break;
    case "custom_crm_action":
      if (!adapter.executeCustomAction)
        throw new Error(
          `${system.provider} does not allow reviewed custom actions.`
        );
      else {
        evidence = await adapter.executeCustomAction({
          connection,
          secret,
          actionName: String(payload.actionName ?? ""),
          payload,
          correlationId: input.correlationId,
        });
        break;
      }
    default:
      throw new Error(
        `The ${system.provider} adapter has no approved execution mapping for '${input.proposal.actionType}'.`
      );
  }
  const shadowMode =
    (evidence.providerResult as { data?: { shadowMode?: string } } | undefined)
      ?.data?.shadowMode === "true";
  if (!shadowMode) {
    const postcondition = await verifyApprovedCrmPostcondition({
      actionType: input.proposal.actionType,
      adapter,
      connection,
      secret,
      proposal: input.proposal,
      payload,
      evidence,
    });
    if (!postcondition.verified)
      return {
        success: false,
        detail: postcondition.detail,
        provider: system.provider,
        connectionId: system.id,
        correlationId: input.correlationId,
        completedAt: evidence.completedAt,
        providerResult: evidence.providerResult,
        screenshotPath: evidence.screenshotPath,
        retryable: false,
      };
  }
  return {
    success: true,
    detail: shadowMode
      ? "Shadow-mode simulation completed; no external CRM write was performed."
      : "Approved CRM action completed and its postcondition was read back from the verified CRM.",
    shadowMode,
    provider: system.provider,
    connectionId: system.id,
    correlationId: input.correlationId,
    completedAt: evidence.completedAt,
    providerResult: evidence.providerResult,
    screenshotPath: evidence.screenshotPath,
    retryable: evidence.retryable ?? false,
  };
}
