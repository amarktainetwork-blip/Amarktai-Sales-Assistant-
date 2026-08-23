import { and, eq } from "drizzle-orm";
import { connectedSystems, type ActionProposal } from "../../drizzle/schema";
import { getDb } from "../db";
import { getCrmAdapter } from "./adapterRegistry";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { sendSalesMessage } from "../communications";
import { connectedSystemSupportsAction } from "../crmRouter";
import { createOutlookCalendarEvent, getOutlookReadiness } from "../outlook";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedContact,
} from "./types";

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
  organisationId: number,
  system: typeof connectedSystems.$inferSelect
): Promise<ConnectionSecretPayload> {
  const kind =
    system.connectionMethod === "browser" ||
    system.connectionMethod === "sidecar"
      ? "browser"
      : "oauth";
  return (
    (await loadConnectionSecret({
      organisationId,
      connectedSystemId: system.id,
      secretKind: kind,
    })) || {}
  );
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

  const system = await verifiedSystem(
    input.organisationId,
    route.provider,
    input.proposal.actionType,
    route.connectedSystemId
  );
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(system.provider);
  const secret = await connectionSecret(input.organisationId, system);
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
  return {
    success: true,
    detail: shadowMode
      ? "Shadow-mode simulation completed; no external CRM write was performed."
      : "Approved CRM action completed through the verified adapter.",
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
