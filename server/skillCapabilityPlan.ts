import { and, eq } from "drizzle-orm";
import { connectedSystems } from "../drizzle/schema";
import { normalizeSkillDefinition, type SkillDefinition } from "../shared/skillBuilder";
import { BROWSER_CAPABILITY_REQUIREMENTS, BROWSER_OPERATION_CATALOGUE } from "./browserConnectors/operationContracts";
import { browserOperationReadinessForSystem } from "./browserConnectors/learnedOperations";
import { getDb } from "./db";

const WRITE_DESCRIPTIONS: Record<string, string> = {
  "contacts.write": "create or update customer/contact fields",
  "companies.write": "create company records",
  "opportunities.write": "create or update the current sales opportunity",
  "tasks.write": "create, reschedule or complete CRM tasks",
  "activities.write": "create CRM activity records",
  "notes.write": "add notes to the CRM record",
  "owners.write": "change CRM record ownership",
  "stage.write": "change the current opportunity stage/status",
  "email.send": "send an approved email through the commissioned source",
  "sms.send": "send an approved SMS through the commissioned CRM",
  "whatsapp.send": "send an approved WhatsApp message through the commissioned CRM",
  "sequences.apply": "apply an approved CRM follow-up sequence",
  "dialler.launch": "launch the CRM dialler",
  "appointments.write": "create or update an appointment",
  "quotes.write": "create or send a quote",
  "workflows.execute": "run an explicitly permitted CRM workflow",
};

function operationMetadata(key: string) {
  const standard = BROWSER_OPERATION_CATALOGUE.find(item => item.key === key);
  if (standard) return standard;
  if (key.startsWith("custom.write."))
    return { key, label: key.replace(/^custom\.write\./, "").replace(/[._-]+/g, " "), mode: "write" as const, capability: undefined };
  if (key.startsWith("custom.read."))
    return { key, label: key.replace(/^custom\.read\./, "").replace(/[._-]+/g, " "), mode: "read" as const, capability: undefined };
  return undefined;
}

function requiredOperationKeys(definition: SkillDefinition) {
  const fromCapabilities = [
    ...definition.requiredReadCapabilities,
    ...definition.requiredWriteCapabilities,
  ].flatMap(capability => BROWSER_CAPABILITY_REQUIREMENTS[capability] || []);
  return Array.from(new Set([...fromCapabilities, ...definition.requiredOperations]));
}

export async function buildSkillCapabilityPlan(input: {
  organisationId: number;
  connectedSystemId: number;
  definition: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db.select().from(connectedSystems).where(and(
      eq(connectedSystems.id, input.connectedSystemId),
      eq(connectedSystems.organisationId, input.organisationId)
    )).limit(1)
  )[0];
  if (!system) throw new Error("Connected system was not found in the active organisation.");

  const definition = normalizeSkillDefinition(input.definition);
  const matrix = ["browser", "sidecar"].includes(system.connectionMethod)
    ? await browserOperationReadinessForSystem({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId,
      })
    : { operations: [], capabilities: [] };
  const operations = new Map(matrix.operations.map(item => [item.key, item]));
  const requiredOperations = requiredOperationKeys(definition).map(key => {
    const metadata = operationMetadata(key);
    const current = operations.get(key);
    const mode = metadata?.mode || (key.startsWith("custom.write.") ? "write" : "read");
    return {
      key,
      label: metadata?.label || key,
      mode,
      status: current?.status || "NOT_LEARNED",
      liveProven: current?.status === "LIVE_PROVEN",
    };
  });

  const writeWarnings = definition.requiredWriteCapabilities.map(capability => ({
    capability,
    description: WRITE_DESCRIPTIONS[capability] || ("perform the CRM write capability " + capability),
    currentlyAllowed: system.allowedWriteCapabilities.includes(capability),
    currentlyVerified: system.verifiedCapabilities.includes(capability),
  }));
  for (const operation of requiredOperations.filter(item => item.mode === "write")) {
    if (!writeWarnings.some(item => (BROWSER_CAPABILITY_REQUIREMENTS[item.capability] || []).includes(operation.key))) {
      writeWarnings.push({
        capability: operation.key,
        description: "perform the learned Genie function " + operation.label,
        currentlyAllowed: system.allowedWriteCapabilities.includes(operation.key),
        currentlyVerified: operation.liveProven,
      });
    }
  }

  const writeApprovalRequired = writeWarnings.length > 0 && !(
    definition.writeApproval.status === "approved_for_commissioning" &&
    definition.writeApproval.connectedSystemId === input.connectedSystemId
  );

  return {
    connectedSystem: {
      id: system.id,
      provider: system.provider,
      displayName: system.displayName,
      connectionMethod: system.connectionMethod,
    },
    readCapabilities: definition.requiredReadCapabilities.map(capability => ({
      capability,
      currentlyAllowed: system.allowedReadCapabilities.includes(capability),
      currentlyVerified: system.verifiedCapabilities.includes(capability),
    })),
    writeCapabilities: writeWarnings,
    operations: requiredOperations,
    missingReadOperations: requiredOperations.filter(item => item.mode === "read" && !item.liveProven),
    missingWriteOperations: requiredOperations.filter(item => item.mode === "write" && !item.liveProven),
    writeApprovalRequired,
    writeApproval: definition.writeApproval,
    canSimulateReadOnly: true,
    canExecuteWrites: !writeApprovalRequired && writeWarnings.every(item => item.currentlyAllowed) && requiredOperations.filter(item => item.mode === "write").every(item => item.liveProven),
  };
}
