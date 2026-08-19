import { and, eq } from "drizzle-orm";
import { connectedSystems, type ActionProposal } from "../../drizzle/schema";
import { getDb } from "../db";
import { getCrmAdapter } from "./adapterRegistry";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { sendSalesMessage } from "../communications";
import type { ConnectionSecretPayload } from "./types";

function targetExternalId(proposal: ActionProposal, payload: Record<string, unknown>) {
  for (const key of ["externalId", "contactExternalId", "opportunityExternalId", "taskExternalId"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  if (proposal.targetLabel?.trim()) return proposal.targetLabel.trim();
  throw new Error("The approved action does not identify a CRM record. Refresh the CRM context and prepare the action again.");
}

async function verifiedSystem(organisationId: number, provider: string, requestedId?: unknown) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const requested = typeof requestedId === "number" ? requestedId : undefined;
  const matches = await db.select().from(connectedSystems).where(and(eq(connectedSystems.organisationId, organisationId), eq(connectedSystems.provider, provider as typeof connectedSystems.provider.enumValues[number]), eq(connectedSystems.status, "ready")));
  const system = requested ? matches.find(item => item.id === requested) : matches[0];
  if (!system) throw new Error("No backend-verified connected system can perform this approved action.");
  return system;
}

async function connectionSecret(organisationId: number, system: typeof connectedSystems.$inferSelect): Promise<ConnectionSecretPayload> {
  const kind = system.connectionMethod === "browser" || system.connectionMethod === "sidecar" ? "browser" : "oauth";
  return (await loadConnectionSecret({ organisationId, connectedSystemId: system.id, secretKind: kind })) || {};
}

function fields(payload: Record<string, unknown>) {
  return (payload.fields && typeof payload.fields === "object" && !Array.isArray(payload.fields) ? payload.fields : payload.patch && typeof payload.patch === "object" && !Array.isArray(payload.patch) ? payload.patch : {}) as Record<string, unknown>;
}

export async function executeApprovedCrmAction(input: { organisationId: number; proposal: ActionProposal; correlationId: string }) {
  const payload = input.proposal.payload as Record<string, unknown>;
  if (payload.reviewRequired !== true) throw new Error("This proposal does not carry the required review-first guardrail.");
  const route = payload.crmRoute as { routable?: boolean; provider?: string; connectedSystemId?: number } | undefined;
  if (!route?.routable || !route.provider) throw new Error("This proposal has no verified CRM route.");
  const system = await verifiedSystem(input.organisationId, route.provider, route.connectedSystemId);
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(system.provider);
  const secret = await connectionSecret(input.organisationId, system);
  const targetId = () => targetExternalId(input.proposal, payload);
  let evidence;

  switch (input.proposal.actionType) {
    case "verify_contact_context": {
      const contact = await adapter.getContact({ connection, secret, externalId: targetId() });
      return { success: true, detail: contact ? "CRM context verified." : "CRM lookup completed but no matching record was returned.", provider: system.provider, connectionId: system.id, correlationId: input.correlationId, completedAt: new Date().toISOString(), providerResult: { contact }, retryable: false };
    }
    case "append_contact_note":
      evidence = await adapter.createNote({ connection, secret, externalId: targetId(), body: String(payload.content ?? payload.note ?? payload.message ?? input.proposal.title), correlationId: input.correlationId });
      break;
    case "schedule_callback":
      evidence = await adapter.createTask({ connection, secret, title: String(payload.taskTitle ?? payload.title ?? input.proposal.title), dueAt: typeof payload.dueAt === "string" ? payload.dueAt : undefined, contactExternalId: typeof payload.contactExternalId === "string" ? payload.contactExternalId : undefined, opportunityExternalId: typeof payload.opportunityExternalId === "string" ? payload.opportunityExternalId : undefined, correlationId: input.correlationId });
      break;
    case "complete_active_task":
      evidence = await adapter.completeTask({ connection, secret, externalId: targetId(), correlationId: input.correlationId });
      break;
    case "update_contact_status":
    case "update_contact":
      evidence = await adapter.updateContact({ connection, secret, externalId: targetId(), patch: fields(payload), correlationId: input.correlationId });
      break;
    case "update_current_opportunity":
    case "update_opportunity":
      evidence = await adapter.updateOpportunity({ connection, secret, externalId: targetId(), patch: fields(payload), correlationId: input.correlationId });
      break;
    case "create_contact":
      if (!adapter.createContact) throw new Error(`${system.provider} does not support creating contacts through its verified adapter.`);
      evidence = await adapter.createContact({ connection, secret, fields: fields(payload), correlationId: input.correlationId });
      break;
    case "create_company":
      if (!adapter.createCompany) throw new Error(`${system.provider} does not support creating companies through its verified adapter.`);
      evidence = await adapter.createCompany({ connection, secret, fields: fields(payload), correlationId: input.correlationId });
      break;
    case "create_opportunity":
      if (!adapter.createOpportunity) throw new Error(`${system.provider} does not support creating opportunities through its verified adapter.`);
      evidence = await adapter.createOpportunity({ connection, secret, fields: fields(payload), correlationId: input.correlationId });
      break;
    case "send_email_template":
    case "send_email":
      evidence = await sendSalesMessage({ adapter, connection, secret, correlationId: input.correlationId, message: { channel: "email", to: String(payload.to ?? payload.email ?? ""), subject: String(payload.subject ?? payload.savedSubject ?? payload.templateName ?? input.proposal.title), body: String(payload.body ?? payload.templateText ?? payload.message ?? ""), templateName: typeof payload.templateName === "string" ? payload.templateName : undefined, contactExternalId: typeof payload.contactExternalId === "string" ? payload.contactExternalId : undefined, opportunityExternalId: typeof payload.opportunityExternalId === "string" ? payload.opportunityExternalId : undefined } });
      break;
    case "send_sms_template":
    case "send_sms":
      evidence = await sendSalesMessage({ adapter, connection, secret, correlationId: input.correlationId, message: { channel: "sms", to: String(payload.to ?? payload.phone ?? ""), body: String(payload.body ?? payload.templateText ?? payload.message ?? ""), templateName: typeof payload.templateName === "string" ? payload.templateName : undefined, contactExternalId: typeof payload.contactExternalId === "string" ? payload.contactExternalId : undefined, opportunityExternalId: typeof payload.opportunityExternalId === "string" ? payload.opportunityExternalId : undefined } });
      break;
    case "send_whatsapp_template":
    case "send_whatsapp":
      evidence = await sendSalesMessage({ adapter, connection, secret, correlationId: input.correlationId, message: { channel: "whatsapp", to: String(payload.to ?? payload.phone ?? ""), body: String(payload.body ?? payload.templateText ?? payload.message ?? ""), templateName: typeof payload.templateName === "string" ? payload.templateName : undefined, contactExternalId: typeof payload.contactExternalId === "string" ? payload.contactExternalId : undefined, opportunityExternalId: typeof payload.opportunityExternalId === "string" ? payload.opportunityExternalId : undefined } });
      break;
    case "apply_sequence":
      if (adapter.applySequence) evidence = await adapter.applySequence({ connection, secret, externalId: targetId(), sequence: String(payload.sequence ?? payload.templateName ?? ""), correlationId: input.correlationId });
      else if (adapter.executeCustomAction) evidence = await adapter.executeCustomAction({ connection, secret, actionName: "applySequence", payload: { externalId: targetId(), ...payload }, correlationId: input.correlationId });
      else throw new Error(`${system.provider} does not expose a verified sequence operation.`);
      break;
    case "create_activity":
      evidence = await adapter.createActivity({ connection, secret, activity: fields(payload), correlationId: input.correlationId });
      break;
    case "custom_crm_action":
      if (!adapter.executeCustomAction) throw new Error(`${system.provider} does not allow reviewed custom actions.`);
      evidence = await adapter.executeCustomAction({ connection, secret, actionName: String(payload.actionName ?? ""), payload, correlationId: input.correlationId });
      break;
    default:
      throw new Error(`The ${route.provider} adapter has no approved execution mapping for '${input.proposal.actionType}'.`);
  }
  return { success: true, detail: "Approved CRM action completed through the verified adapter.", provider: system.provider, connectionId: system.id, correlationId: input.correlationId, completedAt: evidence.completedAt, providerResult: evidence.providerResult, screenshotPath: evidence.screenshotPath, retryable: evidence.retryable ?? false };
}
