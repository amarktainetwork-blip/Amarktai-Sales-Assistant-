import { and, eq, inArray } from "drizzle-orm";
import {
  crmActivities,
  crmCompanies,
  crmContacts,
  crmOpportunities,
  crmSyncCursors,
  crmTasks,
  salesActivityEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  getConnectedSystemForUser,
  listConnectedSystemsForUser,
  loadConnectionSecret,
  loadUserConnectionSecret,
  saveConnectionSecret,
  toAdapterConnection,
} from "../connectedSystems";
import { browserOperationReadinessForSystem } from "../browserConnectors/learnedOperations";
import { getCrmAdapter } from "./adapterRegistry";
import type {
  AdapterConnection,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";
import { normalizeCrmEmail, normalizeCrmPhone } from "./identity";
import { runModelFreeOperation } from "../aiExecutionBoundary";
import { upsertSalesWorkFromCrm } from "../salesWork";
import { crmResourceSyncEligible } from "./syncEligibility";
export { crmResourceSyncEligible } from "./syncEligibility";

async function cursorFor(systemId: number, resourceType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return (
    await db
      .select()
      .from(crmSyncCursors)
      .where(
        and(
          eq(crmSyncCursors.connectedSystemId, systemId),
          eq(crmSyncCursors.resourceType, resourceType)
        )
      )
      .limit(1)
  )[0];
}

async function saveCursor(
  systemId: number,
  resourceType: string,
  cursor?: string,
  error?: string,
  previousSuccessfulAt?: Date | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const lastSuccessfulAt = error ? (previousSuccessfulAt ?? null) : new Date();
  await db
    .insert(crmSyncCursors)
    .values({
      connectedSystemId: systemId,
      resourceType,
      cursor: cursor ?? null,
      sourceCheckpoint: new Date().toISOString(),
      lastSuccessfulAt,
      lastError: error ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        cursor: cursor ?? null,
        sourceCheckpoint: new Date().toISOString(),
        lastSuccessfulAt,
        lastError: error ?? null,
      },
    });
}

function secretKind(connection: AdapterConnection) {
  return connection.connectionMethod === "browser" ||
    connection.connectionMethod === "sidecar"
    ? "browser"
    : "oauth";
}

async function usableSecret(input: {
  userId: number;
  organisationId: number;
  connection: AdapterConnection;
}) {
  const kind = secretKind(input.connection);
  const secret =
    kind === "browser"
      ? await loadUserConnectionSecret({
          userId: input.userId,
          organisationId: input.organisationId,
          connectedSystemId: input.connection.id,
          secretKind: "browser",
        })
      : await loadConnectionSecret({
          organisationId: input.organisationId,
          connectedSystemId: input.connection.id,
          secretKind: "oauth",
        });
  if (!secret && kind === "browser")
    throw new Error(
      "Your CRM needs you to sign in again before synchronisation can continue."
    );
  if (!secret)
    throw new Error(
      "No encrypted credentials are available for this connected system."
    );
  const current = secret;
  if (
    kind === "browser" ||
    !current.expiresAt ||
    new Date(current.expiresAt).valueOf() > Date.now() + 60_000
  )
    return current;
  const adapter = getCrmAdapter(input.connection.provider);
  const refreshed = await adapter.refreshAuthentication({
    connection: input.connection,
    secret: current,
    correlationId: crypto.randomUUID(),
  });
  await saveConnectionSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: input.connection.id,
    secretKind: kind,
    secret: refreshed,
  });
  return refreshed;
}

async function upsertCompanies(
  organisationId: number,
  systemId: number,
  records: NormalizedCompany[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records)
    await db
      .insert(crmCompanies)
      .values({ organisationId, connectedSystemId: systemId, ...record })
      .onDuplicateKeyUpdate({
        set: {
          name: record.name,
          website: record.website ?? null,
          ownerExternalId: record.ownerExternalId ?? null,
          sourceUpdatedAt: record.sourceUpdatedAt ?? null,
          sourceRevision: record.sourceRevision ?? null,
          raw: record.raw,
        },
      });
}

async function upsertContacts(
  organisationId: number,
  systemId: number,
  records: NormalizedContact[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) {
    const normalizedEmail = normalizeCrmEmail(record.email);
    const normalizedPhone = normalizeCrmPhone(record.phone);
    await db
      .insert(crmContacts)
      .values({
        organisationId,
        connectedSystemId: systemId,
        ...record,
        normalizedEmail,
        normalizedPhone,
      })
      .onDuplicateKeyUpdate({
        set: {
          companyExternalId: record.companyExternalId ?? null,
          ownerExternalId: record.ownerExternalId ?? null,
          firstName: record.firstName ?? null,
          lastName: record.lastName ?? null,
          email: record.email ?? null,
          phone: record.phone ?? null,
          normalizedEmail,
          normalizedPhone,
          lifecycleStage: record.lifecycleStage ?? null,
          sourceUpdatedAt: record.sourceUpdatedAt ?? null,
          sourceRevision: record.sourceRevision ?? null,
          raw: record.raw,
        },
      });
  }
}

async function existingContactIds(
  organisationId: number,
  systemId: number,
  externalIds: string[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const found = new Set<string>();
  for (let offset = 0; offset < externalIds.length; offset += 500) {
    const chunk = externalIds.slice(offset, offset + 500);
    if (!chunk.length) continue;
    const rows = await db
      .select({ externalId: crmContacts.externalId })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.organisationId, organisationId),
          eq(crmContacts.connectedSystemId, systemId),
          inArray(crmContacts.externalId, chunk)
        )
      );
    rows.forEach(row => found.add(row.externalId));
  }
  return found;
}

async function upsertOpportunities(
  organisationId: number,
  systemId: number,
  records: NormalizedOpportunity[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records)
    await db
      .insert(crmOpportunities)
      .values({ organisationId, connectedSystemId: systemId, ...record })
      .onDuplicateKeyUpdate({
        set: {
          companyExternalId: record.companyExternalId ?? null,
          contactExternalId: record.contactExternalId ?? null,
          ownerExternalId: record.ownerExternalId ?? null,
          name: record.name,
          pipeline: record.pipeline ?? null,
          stage: record.stage ?? null,
          valueMinor: record.valueMinor ?? null,
          currency: record.currency ?? null,
          closeAt: record.closeAt ?? null,
          lastActivityAt: record.lastActivityAt ?? null,
          nextStepAt: record.nextStepAt ?? null,
          sourceUpdatedAt: record.sourceUpdatedAt ?? null,
          sourceRevision: record.sourceRevision ?? null,
          raw: record.raw,
        },
      });
}

async function upsertTasks(
  organisationId: number,
  systemId: number,
  records: NormalizedTask[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records)
    await db
      .insert(crmTasks)
      .values({ organisationId, connectedSystemId: systemId, ...record })
      .onDuplicateKeyUpdate({
        set: {
          contactExternalId: record.contactExternalId ?? null,
          opportunityExternalId: record.opportunityExternalId ?? null,
          ownerExternalId: record.ownerExternalId ?? null,
          title: record.title,
          status: record.status,
          dueAt: record.dueAt ?? null,
          completedAt: record.completedAt ?? null,
          sourceUpdatedAt: record.sourceUpdatedAt ?? null,
          sourceRevision: record.sourceRevision ?? null,
          raw: record.raw,
        },
      });
}

async function upsertActivities(
  organisationId: number,
  systemId: number,
  records: NormalizedActivity[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) {
    await db
      .insert(crmActivities)
      .values({ organisationId, connectedSystemId: systemId, ...record })
      .onDuplicateKeyUpdate({
        set: {
          contactExternalId: record.contactExternalId ?? null,
          opportunityExternalId: record.opportunityExternalId ?? null,
          ownerExternalId: record.ownerExternalId ?? null,
          activityType: record.activityType,
          occurredAt: record.occurredAt,
          body: record.body ?? null,
          sourceRevision: record.sourceRevision ?? null,
          raw: record.raw,
        },
      });
    await db
      .insert(salesActivityEvents)
      .values({
        organisationId,
        connectedSystemId: systemId,
        externalOwnerId: record.ownerExternalId ?? null,
        contactExternalId: record.contactExternalId ?? null,
        opportunityExternalId: record.opportunityExternalId ?? null,
        eventType: record.activityType,
        source: "crm_sync",
        occurredAt: record.occurredAt,
        externalId: record.externalId,
        metadata: { synced: true },
      })
      .onDuplicateKeyUpdate({
        set: { occurredAt: record.occurredAt, metadata: { synced: true } },
      });
  }
}

async function syncConnectedSystemDeterministically(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    input.connectedSystemId
  );
  if (system.status !== "ready" && system.status !== "limited_permissions")
    throw new Error(
      "This connected system must pass backend verification before synchronization."
    );
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(connection.provider);
  const secret = await usableSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connection,
  });
  const browserOperationStatuses =
    connection.connectionMethod === "browser" ||
    connection.connectionMethod === "sidecar"
      ? new Map(
          (
            await browserOperationReadinessForSystem({
              organisationId: input.organisationId,
              connectedSystemId: system.id,
            })
          ).operations.map(operation => [operation.key, operation.status])
        )
      : null;
  const summary: Record<string, number> = {};
  const failures: Record<string, string> = {};
  const resources = [
    [
      "companies",
      "companies.read",
      "company.sync",
      adapter.syncCompanies,
      upsertCompanies,
    ],
    [
      "contacts",
      "contacts.read",
      "contact.sync",
      adapter.syncContacts,
      upsertContacts,
    ],
    [
      "opportunities",
      "opportunities.read",
      "opportunity.sync",
      adapter.syncOpportunities,
      upsertOpportunities,
    ],
    ["tasks", "tasks.read", "task.sync", adapter.syncTasks, upsertTasks],
    [
      "activities",
      "activities.read",
      "activity.sync",
      adapter.syncActivities,
      upsertActivities,
    ],
  ] as const;
  for (const [
    resourceType,
    capability,
    syncOperationKey,
    sync,
    persist,
  ] of resources) {
    if (
      !crmResourceSyncEligible(
        connection,
        capability,
        browserOperationStatuses?.get(syncOperationKey)
      )
    ) {
      summary[resourceType] = 0;
      continue;
    }
    const existing = await cursorFor(system.id, resourceType);
    try {
      const result = await sync({
        connection,
        secret,
        cursor: existing?.cursor ?? undefined,
      });
      const contactBaseline =
        resourceType === "contacts"
          ? {
              baselineComplete: Boolean(existing?.lastSuccessfulAt),
              existingExternalIds: await existingContactIds(
                input.organisationId,
                system.id,
                result.records.map(record => record.externalId)
              ),
            }
          : undefined;
      await persist(input.organisationId, system.id, result.records as never[]);
      await upsertSalesWorkFromCrm({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        resource: {
          type: resourceType,
          records: result.records,
        } as Parameters<typeof upsertSalesWorkFromCrm>[0]["resource"],
        contactBaseline,
      });
      await saveCursor(system.id, resourceType, result.cursor);
      summary[resourceType] = result.records.length;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message.slice(0, 800)
          : "Unknown sync error";
      await saveCursor(
        system.id,
        resourceType,
        existing?.cursor ?? undefined,
        detail,
        existing?.lastSuccessfulAt
      );
      failures[resourceType] = detail;
    }
  }
  if (Object.keys(failures).length)
    throw new Error(
      `CRM_SYNC_PARTIAL_FAILURE: ${Object.entries(failures)
        .map(([resource, detail]) => `${resource}: ${detail}`)
        .join("; ")}`
    );
  return summary;
}

export async function syncConnectedSystem(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const result = await runModelFreeOperation(
    {
      purpose: "crm_sync",
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      reference: `crm-sync:${input.connectedSystemId}:${Date.now()}`,
    },
    () => syncConnectedSystemDeterministically(input)
  );
  return {
    ...result.value,
    lastSuccessfulAt: new Date().toISOString(),
    modelUsed: result.evidence.modelUsed,
    providerCallCount: result.evidence.providerCallCount,
  };
}

/** Canonical Refresh-now path: the user's own commissioned connection(s). */
export async function syncConnectedSystemsForUser(input: {
  userId: number;
  organisationId: number;
}) {
  const systems = (
    await listConnectedSystemsForUser(input.userId, input.organisationId)
  ).filter(system => ["ready", "limited_permissions"].includes(system.status));
  const results: Array<Record<string, unknown>> = [];
  const failures: Array<{ connectedSystemId: number; error: string }> = [];
  for (const system of systems) {
    try {
      results.push(
        await syncConnectedSystem({
          ...input,
          connectedSystemId: system.id,
        })
      );
    } catch (error) {
      failures.push({
        connectedSystemId: system.id,
        error:
          error instanceof Error
            ? error.message.slice(0, 800)
            : String(error).slice(0, 800),
      });
    }
  }
  const lastSuccessfulAt = results.length ? new Date().toISOString() : null;
  return {
    checked: systems.length,
    synchronized: results.length,
    failed: failures.length,
    failures,
    lastSuccessfulAt,
    modelUsed: false as const,
    providerCallCount: 0 as const,
  };
}
