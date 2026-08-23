import { and, eq } from "drizzle-orm";
import { crmActivities, crmCompanies, crmContacts, crmOpportunities, crmSyncCursors, crmTasks, salesActivityEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { getConnectedSystemForUser, loadConnectionSecret, saveConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { getCrmAdapter } from "./adapterRegistry";
import type { AdapterConnection, NormalizedActivity, NormalizedCompany, NormalizedContact, NormalizedOpportunity, NormalizedTask } from "./types";
import { normalizeCrmEmail, normalizeCrmPhone } from "./identity";

async function cursorFor(systemId: number, resourceType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return (await db.select().from(crmSyncCursors).where(and(eq(crmSyncCursors.connectedSystemId, systemId), eq(crmSyncCursors.resourceType, resourceType))).limit(1))[0];
}

async function saveCursor(systemId: number, resourceType: string, cursor?: string, error?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.insert(crmSyncCursors).values({ connectedSystemId: systemId, resourceType, cursor: cursor ?? null, sourceCheckpoint: new Date().toISOString(), lastSuccessfulAt: error ? null : new Date(), lastError: error ?? null }).onDuplicateKeyUpdate({ set: { cursor: cursor ?? null, sourceCheckpoint: new Date().toISOString(), lastSuccessfulAt: error ? null : new Date(), lastError: error ?? null } });
}

function secretKind(connection: AdapterConnection) {
  return connection.connectionMethod === "browser" || connection.connectionMethod === "sidecar" ? "browser" : "oauth";
}

async function usableSecret(input: { userId: number; organisationId: number; connection: AdapterConnection }) {
  const kind = secretKind(input.connection);
  const secret = await loadConnectionSecret({ organisationId: input.organisationId, connectedSystemId: input.connection.id, secretKind: kind });
  if (!secret && kind !== "browser") throw new Error("No encrypted credentials are available for this connected system.");
  const current = secret ?? {};
  if (kind === "browser" || !current.expiresAt || new Date(current.expiresAt).valueOf() > Date.now() + 60_000) return current;
  const adapter = getCrmAdapter(input.connection.provider);
  const refreshed = await adapter.refreshAuthentication({ connection: input.connection, secret: current, correlationId: crypto.randomUUID() });
  await saveConnectionSecret({ userId: input.userId, organisationId: input.organisationId, connectedSystemId: input.connection.id, secretKind: kind, secret: refreshed });
  return refreshed;
}

async function upsertCompanies(organisationId: number, systemId: number, records: NormalizedCompany[]) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) await db.insert(crmCompanies).values({ organisationId, connectedSystemId: systemId, ...record }).onDuplicateKeyUpdate({ set: { name: record.name, website: record.website ?? null, ownerExternalId: record.ownerExternalId ?? null, sourceUpdatedAt: record.sourceUpdatedAt ?? null, sourceRevision: record.sourceRevision ?? null, raw: record.raw } });
}

async function upsertContacts(organisationId: number, systemId: number, records: NormalizedContact[]) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) {
    const normalizedEmail = normalizeCrmEmail(record.email);
    const normalizedPhone = normalizeCrmPhone(record.phone);
    await db.insert(crmContacts).values({ organisationId, connectedSystemId: systemId, ...record, normalizedEmail, normalizedPhone }).onDuplicateKeyUpdate({ set: { companyExternalId: record.companyExternalId ?? null, ownerExternalId: record.ownerExternalId ?? null, firstName: record.firstName ?? null, lastName: record.lastName ?? null, email: record.email ?? null, phone: record.phone ?? null, normalizedEmail, normalizedPhone, lifecycleStage: record.lifecycleStage ?? null, sourceUpdatedAt: record.sourceUpdatedAt ?? null, sourceRevision: record.sourceRevision ?? null, raw: record.raw } });
  }
}

async function upsertOpportunities(organisationId: number, systemId: number, records: NormalizedOpportunity[]) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) await db.insert(crmOpportunities).values({ organisationId, connectedSystemId: systemId, ...record }).onDuplicateKeyUpdate({ set: { companyExternalId: record.companyExternalId ?? null, contactExternalId: record.contactExternalId ?? null, ownerExternalId: record.ownerExternalId ?? null, name: record.name, pipeline: record.pipeline ?? null, stage: record.stage ?? null, valueMinor: record.valueMinor ?? null, currency: record.currency ?? null, closeAt: record.closeAt ?? null, lastActivityAt: record.lastActivityAt ?? null, nextStepAt: record.nextStepAt ?? null, sourceUpdatedAt: record.sourceUpdatedAt ?? null, sourceRevision: record.sourceRevision ?? null, raw: record.raw } });
}

async function upsertTasks(organisationId: number, systemId: number, records: NormalizedTask[]) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) await db.insert(crmTasks).values({ organisationId, connectedSystemId: systemId, ...record }).onDuplicateKeyUpdate({ set: { contactExternalId: record.contactExternalId ?? null, opportunityExternalId: record.opportunityExternalId ?? null, ownerExternalId: record.ownerExternalId ?? null, title: record.title, status: record.status, dueAt: record.dueAt ?? null, completedAt: record.completedAt ?? null, sourceUpdatedAt: record.sourceUpdatedAt ?? null, sourceRevision: record.sourceRevision ?? null, raw: record.raw } });
}

async function upsertActivities(organisationId: number, systemId: number, records: NormalizedActivity[]) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  for (const record of records) {
    await db.insert(crmActivities).values({ organisationId, connectedSystemId: systemId, ...record }).onDuplicateKeyUpdate({ set: { contactExternalId: record.contactExternalId ?? null, opportunityExternalId: record.opportunityExternalId ?? null, ownerExternalId: record.ownerExternalId ?? null, activityType: record.activityType, occurredAt: record.occurredAt, body: record.body ?? null, sourceRevision: record.sourceRevision ?? null, raw: record.raw } });
    await db.insert(salesActivityEvents).values({ organisationId, connectedSystemId: systemId, externalOwnerId: record.ownerExternalId ?? null, contactExternalId: record.contactExternalId ?? null, opportunityExternalId: record.opportunityExternalId ?? null, eventType: record.activityType, source: "crm_sync", occurredAt: record.occurredAt, externalId: record.externalId, metadata: { synced: true } }).onDuplicateKeyUpdate({ set: { occurredAt: record.occurredAt, metadata: { synced: true } } });
  }
}

export async function syncConnectedSystem(input: { userId: number; organisationId: number; connectedSystemId: number }) {
  const system = await getConnectedSystemForUser(input.userId, input.organisationId, input.connectedSystemId);
  if (system.status !== "ready" && system.status !== "limited_permissions") throw new Error("This connected system must pass backend verification before synchronization.");
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(connection.provider);
  const secret = await usableSecret({ userId: input.userId, organisationId: input.organisationId, connection });
  const summary: Record<string, number> = {};
  const resources = [
    ["companies", adapter.syncCompanies, upsertCompanies],
    ["contacts", adapter.syncContacts, upsertContacts],
    ["opportunities", adapter.syncOpportunities, upsertOpportunities],
    ["tasks", adapter.syncTasks, upsertTasks],
    ["activities", adapter.syncActivities, upsertActivities],
  ] as const;
  for (const [resourceType, sync, persist] of resources) {
    const existing = await cursorFor(system.id, resourceType);
    try {
      const result = await sync({ connection, secret, cursor: existing?.cursor ?? undefined });
      await persist(input.organisationId, system.id, result.records as never[]);
      await saveCursor(system.id, resourceType, result.cursor);
      summary[resourceType] = result.records.length;
    } catch (error) {
      await saveCursor(system.id, resourceType, existing?.cursor ?? undefined, error instanceof Error ? error.message.slice(0, 800) : "Unknown sync error");
      throw error;
    }
  }
  return summary;
}
