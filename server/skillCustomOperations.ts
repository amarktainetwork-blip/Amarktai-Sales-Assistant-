import { and, eq } from "drizzle-orm";
import { connectedSystems } from "../drizzle/schema";
import { getDb } from "./db";
import type { ResolvedAssistantCustomerContext } from "./assistantCustomerContext";
import {
  loadUserConnectionSecret,
  toAdapterConnection,
} from "./connectedSystems";
import { getCrmAdapter } from "./crm/adapterRegistry";
import { requireRuntimeBrowserOperation } from "./browserConnectors/learnedOperations";
import type { SkillDefinition, SkillStep } from "../shared/skillBuilder";

function safeResultKey(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(key) ? key : "";
}

function exactReadTarget(
  step: SkillStep,
  customer: ResolvedAssistantCustomerContext
) {
  const targetKind = String(step.inputs?.targetKind || "contact");
  if (targetKind === "task")
    return (
      customer.operationalRecordState.currentActiveTaskExternalId || undefined
    );
  if (targetKind === "opportunity")
    return (
      customer.operationalRecordState.currentActiveOpportunityExternalId ||
      undefined
    );
  return customer.contactExternalId;
}

export function customReadSteps(definition: SkillDefinition) {
  return definition.steps.filter(step => step.action === "read_crm_operation");
}

export async function executeSkillCustomReads(input: {
  userId: number;
  organisationId: number;
  definition: SkillDefinition;
  customer: ResolvedAssistantCustomerContext;
  runtimeInputs: Record<string, unknown>;
}) {
  const steps = customReadSteps(input.definition);
  if (!steps.length) return input.runtimeInputs;
  const connectedSystemId = input.customer.connectedSystemId;
  if (!connectedSystemId)
    throw new Error(
      "CUSTOM_READ_CONNECTION_REQUIRED: the customer has no exact CRM connection."
    );

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (
    !system ||
    !["browser", "sidecar"].includes(system.connectionMethod) ||
    system.provider !== input.customer.provider
  )
    throw new Error(
      "CUSTOM_READ_CONNECTION_REQUIRED: the exact browser CRM connection is unavailable."
    );
  const secret = await loadUserConnectionSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId,
    secretKind: "browser",
  });
  if (!secret)
    throw new Error(
      "CUSTOM_READ_SESSION_REQUIRED: sign in to the Secure CRM Browser before using this skill."
    );
  const adapter = getCrmAdapter(input.customer.provider);
  if (!adapter.executeCustomAction)
    throw new Error(
      "CUSTOM_READ_UNAVAILABLE: this CRM adapter cannot execute learned custom reads."
    );

  const connection = toAdapterConnection(system);
  const existingCrm =
    input.runtimeInputs.crm &&
    typeof input.runtimeInputs.crm === "object" &&
    !Array.isArray(input.runtimeInputs.crm)
      ? (input.runtimeInputs.crm as Record<string, unknown>)
      : {};
  const crm: Record<string, unknown> = { ...existingCrm };

  for (const [index, step] of steps.entries()) {
    const operationKey =
      typeof step.inputs?.operationKey === "string"
        ? step.inputs.operationKey.trim()
        : "";
    if (!operationKey.startsWith("custom.read."))
      throw new Error(
        "CUSTOM_READ_OPERATION_REQUIRED: read_crm_operation must name a custom.read.* operation."
      );
    const resultKey =
      safeResultKey(step.inputs?.resultKey) ||
      operationKey.replace(/^custom\.read\./, "").replace(/[^A-Za-z0-9_-]/g, "_");
    const operation = await requireRuntimeBrowserOperation({
      organisationId: input.organisationId,
      connectedSystemId,
      operationKey,
    });
    if (operation.definition.mode !== "read")
      throw new Error(
        `CUSTOM_READ_MODE_MISMATCH: '${operationKey}' is not a read-only learned operation.`
      );
    const targetExternalId = exactReadTarget(step, input.customer);
    const evidence = await adapter.executeCustomAction({
      connection,
      secret,
      actionName: operationKey,
      payload: {
        ...(step.inputs || {}),
        externalId: targetExternalId,
        contactExternalId: input.customer.contactExternalId,
        taskExternalId:
          String(step.inputs?.targetKind || "") === "task"
            ? targetExternalId
            : undefined,
        opportunityExternalId:
          String(step.inputs?.targetKind || "") === "opportunity"
            ? targetExternalId
            : undefined,
      },
      correlationId: `skill-read:${input.organisationId}:${input.userId}:${index + 1}:${operationKey}`.slice(
        0,
        220
      ),
    });
    crm[resultKey] = evidence.providerResult;
  }

  return { ...input.runtimeInputs, crm };
}
