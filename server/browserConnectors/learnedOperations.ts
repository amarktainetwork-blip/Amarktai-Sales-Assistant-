import { and, desc, eq, gt } from "drizzle-orm";
import {
  browserLearnedOperations,
  browserTrainingSessions,
  connectedSystems,
} from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import {
  canManageOrganisation,
  requireOrganisationMembership,
} from "../organisation";
import { recordOperationalEvent } from "../observability/events";
import {
  BROWSER_OPERATION_CATALOGUE,
  deriveBrowserCapabilityReadiness,
  operationChecksum,
  sanitizeTrainingCapture,
  assertBrowserOperationRuntimeStatus,
  assertBrowserOperationScope,
  validateLearnedOperationDefinition,
  validateOperationKey,
  type BrowserOperationStatus,
  type BrowserPostcondition,
  type LearnedBrowserOperationDefinition,
} from "./operationContracts";

async function scopedSystem(organisationId: number, connectedSystemId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, connectedSystemId),
          eq(connectedSystems.organisationId, organisationId)
        )
      )
      .limit(1)
  )[0];
  if (
    !system ||
    (system.connectionMethod !== "browser" &&
      system.connectionMethod !== "sidecar")
  )
    throw new Error(
      "Browser connected system was not found in this organisation."
    );
  return system;
}

export async function latestBrowserOperation(input: {
  organisationId: number;
  connectedSystemId: number;
  operationKey: string;
  allowedStatuses?: BrowserOperationStatus[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select()
    .from(browserLearnedOperations)
    .where(
      and(
        eq(browserLearnedOperations.organisationId, input.organisationId),
        eq(browserLearnedOperations.connectedSystemId, input.connectedSystemId),
        eq(
          browserLearnedOperations.operationKey,
          validateOperationKey(input.operationKey)
        )
      )
    )
    .orderBy(desc(browserLearnedOperations.version))
    .limit(10);
  return rows.find(
    row => !input.allowedStatuses || input.allowedStatuses.includes(row.status)
  );
}

export async function requireRuntimeBrowserOperation(input: {
  organisationId: number;
  connectedSystemId: number;
  operationKey: string;
  allowTestReady?: boolean;
}) {
  const allowed: BrowserOperationStatus[] = input.allowTestReady
    ? ["LIVE_PROVEN", "TEST_READY"]
    : ["LIVE_PROVEN"];
  const operation = await latestBrowserOperation({
    ...input,
    allowedStatuses: allowed,
  });
  if (!operation) {
    const latest = await latestBrowserOperation(input);
    try {
      assertBrowserOperationRuntimeStatus(
        latest?.status,
        Boolean(input.allowTestReady)
      );
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}: '${input.operationKey}'${latest ? ` is ${latest.status}` : " has no organisation-scoped learned definition"}; production execution requires LIVE_PROVEN.`
      );
    }
    throw new Error(`OPERATION_NOT_LIVE_PROVEN: '${input.operationKey}'.`);
  }
  assertBrowserOperationScope(operation, input);
  return {
    ...operation,
    definition: validateLearnedOperationDefinition(operation.definition),
    postconditionAssertions:
      operation.postconditionAssertions as BrowserPostcondition[],
  };
}

export async function listBrowserOperationMatrix(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  await scopedSystem(input.organisationId, input.connectedSystemId);
  return browserOperationReadinessForSystem(input);
}

export async function browserOperationReadinessForSystem(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select()
    .from(browserLearnedOperations)
    .where(
      and(
        eq(browserLearnedOperations.organisationId, input.organisationId),
        eq(browserLearnedOperations.connectedSystemId, input.connectedSystemId)
      )
    )
    .orderBy(desc(browserLearnedOperations.version));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (!latest.has(row.operationKey)) latest.set(row.operationKey, row);
  const operations = BROWSER_OPERATION_CATALOGUE.map(item => ({
    ...item,
    ...(latest.get(item.key) || {
      status: "NOT_LEARNED" as const,
      version: 0,
      lastTestAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      evidence: {},
    }),
  }));
  const statuses = Object.fromEntries(
    operations.map(item => [item.key, item.status])
  ) as Record<string, BrowserOperationStatus>;
  const capabilities = Array.from(
    new Set(
      BROWSER_OPERATION_CATALOGUE.map(item => item.capability).filter(
        (item): item is string => Boolean(item)
      )
    )
  ).map(capability => deriveBrowserCapabilityReadiness(statuses, capability));
  return { operations, capabilities };
}

export async function saveLearnedBrowserOperation(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  operationKey: string;
  definition: unknown;
  prerequisites?: Record<string, unknown>;
  targetAssertions?: Record<string, unknown>;
  postconditionAssertions?: BrowserPostcondition[];
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!canManageOrganisation(membership.role))
    throw new Error(
      "Only organisation owners and managers can teach browser CRM operations."
    );
  await scopedSystem(input.organisationId, input.connectedSystemId);
  const operationKey = validateOperationKey(input.operationKey);
  const definition = validateLearnedOperationDefinition(input.definition);
  const postconditions = input.postconditionAssertions ?? [];
  if (definition.mode === "write" && !postconditions.length)
    throw new Error(
      "A browser write operation must define at least one postcondition assertion."
    );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const previous = await latestBrowserOperation({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    operationKey,
  });
  const version = (previous?.version ?? 0) + 1;
  const prerequisites = input.prerequisites ?? {};
  const targetAssertions = input.targetAssertions ?? {};
  const checksum = operationChecksum({
    operationKey,
    definition,
    prerequisites,
    targetAssertions,
    postconditionAssertions: postconditions,
  });
  const result = await db
    .insert(browserLearnedOperations)
    .values({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      operationKey,
      version,
      status: "TEST_READY",
      definition,
      prerequisites,
      targetAssertions,
      postconditionAssertions: postconditions,
      checksum,
      evidence: { repositoryImplemented: true },
      createdByUserId: input.userId,
    });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "browser_operation_learned",
    entityType: "browser_learned_operation",
    entityId: String(result[0].insertId),
    summary: `${operationKey} version ${version} saved as TEST_READY.`,
    metadata: {
      connectedSystemId: input.connectedSystemId,
      operationKey,
      version,
      checksum,
    },
  });
  return {
    id: Number(result[0].insertId),
    operationKey,
    version,
    status: "TEST_READY" as const,
    checksum,
  };
}

export async function recordBrowserOperationResult(input: {
  organisationId: number;
  connectedSystemId: number;
  operationKey: string;
  version: number;
  success: boolean;
  evidence: Record<string, unknown>;
  error?: string;
  publishByUserId?: number;
  watchdog?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const operation = (
    await db
      .select()
      .from(browserLearnedOperations)
      .where(
        and(
          eq(browserLearnedOperations.organisationId, input.organisationId),
          eq(
            browserLearnedOperations.connectedSystemId,
            input.connectedSystemId
          ),
          eq(browserLearnedOperations.operationKey, input.operationKey),
          eq(browserLearnedOperations.version, input.version)
        )
      )
      .limit(1)
  )[0];
  if (!operation)
    throw new Error(
      "The learned browser operation was not found in this organisation and connected system."
    );
  const now = new Date();
  const status: BrowserOperationStatus =
    input.success && input.publishByUserId
      ? "LIVE_PROVEN"
      : input.success
        ? operation.status
        : input.watchdog && operation.status === "LIVE_PROVEN"
          ? "DEGRADED"
          : "BLOCKED";
  await db
    .update(browserLearnedOperations)
    .set({
      status,
      lastTestAt: now,
      lastSuccessAt: input.success ? now : operation.lastSuccessAt,
      lastFailureAt: input.success ? operation.lastFailureAt : now,
      lastError: input.success
        ? null
        : (input.error || "Browser operation verification failed.").slice(
            0,
            8_000
          ),
      evidence: input.evidence,
      publishedByUserId:
        input.success && input.publishByUserId
          ? input.publishByUserId
          : operation.publishedByUserId,
    })
    .where(eq(browserLearnedOperations.id, operation.id));
  if (!input.success)
    await recordOperationalEvent({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      severity: "warning",
      category: "browser_crm_operation",
      eventKey: `browser_operation_${status.toLowerCase()}`,
      summary: `${input.operationKey} was ${status.toLowerCase()} after deterministic verification failed. Other operations remain unchanged. Re-run Teach Amarktai for this operation.`,
      detail: {
        operationKey: input.operationKey,
        version: input.version,
        status,
        error: input.error?.slice(0, 800),
      },
    });
  return { status };
}

export async function createBrowserTrainingSession(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  operationKey: string;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!canManageOrganisation(membership.role))
    throw new Error(
      "Only organisation owners and managers can start Teach Amarktai training."
    );
  await scopedSystem(input.organisationId, input.connectedSystemId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const result = await db
    .insert(browserTrainingSessions)
    .values({
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      userId: input.userId,
      operationKey: validateOperationKey(input.operationKey),
      capture: [],
      expiresAt,
    });
  return { id: Number(result[0].insertId), expiresAt };
}

export async function submitBrowserTrainingCapture(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  trainingSessionId: number;
  events: unknown[];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const session = (
    await db
      .select()
      .from(browserTrainingSessions)
      .where(
        and(
          eq(browserTrainingSessions.id, input.trainingSessionId),
          eq(browserTrainingSessions.organisationId, input.organisationId),
          eq(
            browserTrainingSessions.connectedSystemId,
            input.connectedSystemId
          ),
          eq(browserTrainingSessions.userId, input.userId),
          eq(browserTrainingSessions.status, "capturing"),
          gt(browserTrainingSessions.expiresAt, new Date())
        )
      )
      .limit(1)
  )[0];
  if (!session)
    throw new Error(
      "The training session is expired or does not belong to this organisation, user, and connected system."
    );
  const capture = sanitizeTrainingCapture(input.events);
  const previous = await latestBrowserOperation({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    operationKey: session.operationKey,
  });
  const version = (previous?.version ?? 0) + 1;
  const catalogue = BROWSER_OPERATION_CATALOGUE.find(
    item => item.key === session.operationKey
  );
  const definition = {
    mode: catalogue?.mode || "read",
    trainingCapture: capture,
    candidateOnly: true,
  };
  const checksum = operationChecksum({
    operationKey: session.operationKey,
    definition,
  });
  await db.transaction(async tx => {
    await tx
      .update(browserTrainingSessions)
      .set({ capture, status: "submitted", completedAt: new Date() })
      .where(eq(browserTrainingSessions.id, session.id));
    await tx
      .insert(browserLearnedOperations)
      .values({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId,
        operationKey: session.operationKey,
        version,
        status: "LEARNED",
        definition,
        prerequisites: {},
        targetAssertions: {},
        postconditionAssertions: [],
        checksum,
        evidence: {
          trainingSessionId: session.id,
          capturedStepCount: capture.length,
          privacyFiltered: true,
        },
        createdByUserId: input.userId,
      });
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "browser_training_submitted",
    entityType: "browser_learned_operation",
    entityId: `${input.connectedSystemId}:${session.operationKey}:${version}`,
    summary: `${session.operationKey} demonstration captured as LEARNED; it is not executable until deterministic steps and assertions are reviewed.`,
    metadata: {
      connectedSystemId: input.connectedSystemId,
      operationKey: session.operationKey,
      version,
      capturedStepCount: capture.length,
    },
  });
  return {
    operationKey: session.operationKey,
    version,
    capture,
    status: "LEARNED" as const,
  };
}

export function browserShadowMode(configuration: Record<string, unknown>) {
  return configuration.shadowMode === true;
}

export async function setBrowserShadowMode(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  enabled: boolean;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!canManageOrganisation(membership.role))
    throw new Error(
      "Only organisation owners and managers can change Genie shadow mode."
    );
  const system = await scopedSystem(
    input.organisationId,
    input.connectedSystemId
  );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db
    .update(connectedSystems)
    .set({
      configuration: {
        ...(system.configuration || {}),
        shadowMode: input.enabled,
      },
    })
    .where(
      and(
        eq(connectedSystems.id, input.connectedSystemId),
        eq(connectedSystems.organisationId, input.organisationId)
      )
    );
  return { enabled: input.enabled };
}

export type RuntimeLearnedOperation = Awaited<
  ReturnType<typeof requireRuntimeBrowserOperation>
> & { definition: LearnedBrowserOperationDefinition };
