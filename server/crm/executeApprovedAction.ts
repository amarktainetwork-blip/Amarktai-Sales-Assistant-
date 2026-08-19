import { and, eq } from "drizzle-orm";
import { connectedSystems, type ActionProposal } from "../../drizzle/schema";
import { getDb } from "../db";
import { executeApprovedGenieProposal } from "../genie/executeProposal";
import { getCrmAdapter } from "./adapterRegistry";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";

function targetExternalId(payload: Record<string, unknown>) {
  for (const key of ["externalId", "contactExternalId", "opportunityExternalId", "taskExternalId"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
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

export async function executeApprovedCrmAction(input: { organisationId: number; proposal: ActionProposal; correlationId: string }) {
  const payload = input.proposal.payload as Record<string, unknown>;
  if (payload.reviewRequired !== true) throw new Error("This proposal does not carry the required review-first guardrail.");
  const route = payload.crmRoute as { routable?: boolean; provider?: string; connectedSystemId?: number } | undefined;
  if (!route?.routable || !route.provider) throw new Error("This proposal has no verified CRM route.");
  if (route.provider === "genie") {
    const result = await executeApprovedGenieProposal(input.proposal);
    return { success: result.success, detail: result.detail, provider: "genie", correlationId: input.correlationId, completedAt: result.completedAt, screenshotPath: result.screenshotPath, data: result.data, retryable: !result.success };
  }
  const system = await verifiedSystem(input.organisationId, route.provider, route.connectedSystemId);
  const adapter = getCrmAdapter(system.provider);
  const secret = await loadConnectionSecret({ organisationId: input.organisationId, connectedSystemId: system.id, secretKind: "oauth" });
  if (!secret) throw new Error("The verified CRM connection no longer has usable encrypted authentication. Fix the connection and try again.");
  let evidence;
  switch (input.proposal.actionType) {
    case "append_contact_note":
      evidence = await adapter.createNote({ connection: toAdapterConnection(system), secret, externalId: targetExternalId(payload), body: String(payload.note ?? payload.message ?? input.proposal.title), correlationId: input.correlationId });
      break;
    case "schedule_callback":
      evidence = await adapter.createTask({ connection: toAdapterConnection(system), secret, title: String(payload.title ?? input.proposal.title), dueAt: typeof payload.dueAt === "string" ? payload.dueAt : undefined, contactExternalId: typeof payload.contactExternalId === "string" ? payload.contactExternalId : undefined, opportunityExternalId: typeof payload.opportunityExternalId === "string" ? payload.opportunityExternalId : undefined, correlationId: input.correlationId });
      break;
    case "complete_active_task":
      evidence = await adapter.completeTask({ connection: toAdapterConnection(system), secret, externalId: targetExternalId(payload), correlationId: input.correlationId });
      break;
    case "update_contact_status":
      evidence = await adapter.updateContact({ connection: toAdapterConnection(system), secret, externalId: targetExternalId(payload), patch: (payload.patch as Record<string, unknown>) ?? {}, correlationId: input.correlationId });
      break;
    case "update_current_opportunity":
      evidence = await adapter.updateOpportunity({ connection: toAdapterConnection(system), secret, externalId: targetExternalId(payload), patch: (payload.patch as Record<string, unknown>) ?? {}, correlationId: input.correlationId });
      break;
    default:
      throw new Error(`The ${route.provider} adapter has no approved execution mapping for '${input.proposal.actionType}'.`);
  }
  return { success: true, detail: "Approved CRM action was verified by the adapter.", provider: system.provider, connectionId: system.id, correlationId: input.correlationId, completedAt: evidence.completedAt, providerResult: evidence.providerResult, screenshotPath: evidence.screenshotPath, retryable: evidence.retryable ?? false };
}
