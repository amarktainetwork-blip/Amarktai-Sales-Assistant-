import { reconcileCurrentBrowserReadiness } from "./currentReadiness";
import { isTransientBrowserExecutionFailure } from "../browserConnectors/runtimeFailure";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  crmActivities,
  crmCompanies,
  crmContacts,
  crmOpportunities,
  crmSyncCursors,
  crmTasks,
  salesActivityEvents,
  salesWorkItems,
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
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedActivity,
  NormalizedCompany,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";
import { normalizeCrmEmail, normalizeCrmPhone } from "./identity";
import { runModelFreeOperation } from "../aiExecutionBoundary";
import {
  completeNewLeadWorkAfterVerifiedContact,
  upsertSalesWorkFromCrm,
} from "../salesWork";
import {
  INCOMPLETE_TASK_STATUSES,
  isCompletedTask,
} from "../../shared/taskState";
import { crmResourceSyncEligible } from "./syncEligibility";
import { assertPersonalBrowserOwnerScope } from "./personalOwnerScope";
export { crmResourceSyncEligible } from "./syncEligibility";

export function isTransientCrmSyncFailure(error: unknown) {
  if (
    error instanceof Error &&
    error.message.startsWith("CRM_SYNC_PARTIAL_FAILURE:")
  )
    return (error as Error & { transient?: boolean }).transient === true;
  return isTransientBrowserExecutionFailure(error);
}

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

export async function upsertContacts(
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

export async function existingContactIds(
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

export function missingTaskIdsFromSnapshot(
  cachedOpenIds: string[],
  currentOpenIds: Iterable<string>
) {
  const current = new Set(currentOpenIds);
  return Array.from(
    new Set(cachedOpenIds.filter(id => id && !current.has(id)))
  );
}

async function reconcileOpenTaskSnapshot(input: {
  organisationId: number;
  connectedSystemId: number;
  ownerExternalId: string;
  currentOpenIds: Set<string>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const cached = await db
    .select({
      externalId: crmTasks.externalId,
      contactExternalId: crmTasks.contactExternalId,
      title: crmTasks.title,
    })
    .from(crmTasks)
    .where(
      and(
        eq(crmTasks.organisationId, input.organisationId),
        eq(crmTasks.connectedSystemId, input.connectedSystemId),
        eq(crmTasks.ownerExternalId, input.ownerExternalId),
        inArray(crmTasks.status, [...INCOMPLETE_TASK_STATUSES])
      )
    );
  const missing = missingTaskIdsFromSnapshot(
    cached.map(row => row.externalId),
    input.currentOpenIds
  );
  if (!missing.length) return 0;
  const reconciledAt = new Date();
  await db
    .update(crmTasks)
    .set({ status: "closed", completedAt: null })
    .where(
      and(
        eq(crmTasks.organisationId, input.organisationId),
        eq(crmTasks.connectedSystemId, input.connectedSystemId),
        eq(crmTasks.ownerExternalId, input.ownerExternalId),
        inArray(crmTasks.externalId, missing)
      )
    );
  await db
    .update(salesWorkItems)
    .set({
      status: "completed",
      completedAt: reconciledAt,
      freshness: "current",
      syncedAt: reconciledAt,
    })
    .where(
      and(
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.connectedSystemId, input.connectedSystemId),
        inArray(salesWorkItems.taskExternalId, missing),
        inArray(salesWorkItems.status, [
          "open",
          "in_progress",
          "snoozed",
          "blocked",
        ])
      )
    );
  return missing.length;
}

export function crmTaskProvesLeadProgress(task: Pick<NormalizedTask, "title">) {
  const title = task.title.trim().toLowerCase().replace(/\s+/g, " ");
  if (!title) return false;
  return !/(^|\s)(first|1st|initial)\s*(call|contact)(\s|$)/i.test(title);
}

export function crmTaskHistoryProvesLeadWorked(
  task: Pick<NormalizedTask, "title" | "status">
) {
  return isCompletedTask(task.status) || crmTaskProvesLeadProgress(task);
}

export function crmActivityHistoryProvesLeadWorked(
  activity: Pick<
    NormalizedActivity,
    "activityType" | "ownerExternalId" | "raw"
  >,
  ownerExternalId: string
) {
  const type = activity.activityType.trim().toLowerCase();
  const raw =
    activity.raw &&
    typeof activity.raw === "object" &&
    !Array.isArray(activity.raw)
      ? activity.raw
      : {};
  const direction = String(raw.direction || "")
    .trim()
    .toLowerCase();
  if (type === "call") return true;
  if (type === "note")
    return String(raw.authorExternalId || "").trim() === ownerExternalId.trim();
  return (
    ["email", "sms", "whatsapp", "communication"].includes(type) &&
    direction === "inbound"
  );
}

export async function reconcileNewLeadAlertsFromTaskHistory(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const activeLeads = await db
    .select({ contactExternalId: salesWorkItems.contactExternalId })
    .from(salesWorkItems)
    .where(
      and(
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.connectedSystemId, input.connectedSystemId),
        eq(salesWorkItems.salespersonUserId, input.userId),
        eq(salesWorkItems.type, "NEW_LEAD"),
        inArray(salesWorkItems.status, [
          "open",
          "in_progress",
          "snoozed",
          "blocked",
        ])
      )
    );
  const contactExternalIds = Array.from(
    new Set(
      activeLeads
        .map(row => row.contactExternalId?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  if (!contactExternalIds.length) return 0;
  const taskTruth = await db
    .select({
      contactExternalId: crmTasks.contactExternalId,
      title: crmTasks.title,
      status: crmTasks.status,
    })
    .from(crmTasks)
    .where(
      and(
        eq(crmTasks.organisationId, input.organisationId),
        eq(crmTasks.connectedSystemId, input.connectedSystemId),
        inArray(crmTasks.contactExternalId, contactExternalIds)
      )
    );
  const workedContacts = Array.from(
    new Set(
      taskTruth
        .filter(
          task => task.contactExternalId && crmTaskHistoryProvesLeadWorked(task)
        )
        .map(task => task.contactExternalId!.trim())
        .filter(Boolean)
    )
  );
  if (!workedContacts.length) return 0;
  const now = new Date();
  const result = await db
    .update(salesWorkItems)
    .set({
      status: "completed",
      completedAt: now,
      freshness: "current",
      syncedAt: now,
    })
    .where(
      and(
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.connectedSystemId, input.connectedSystemId),
        eq(salesWorkItems.salespersonUserId, input.userId),
        eq(salesWorkItems.type, "NEW_LEAD"),
        inArray(salesWorkItems.contactExternalId, workedContacts),
        inArray(salesWorkItems.status, [
          "open",
          "in_progress",
          "snoozed",
          "blocked",
        ])
      )
    );
  return Number(result[0].affectedRows || 0);
}

const MAX_ACTIVE_CUSTOMER_HISTORY_CHECKS_PER_SYNC = 10;

async function refreshActiveCustomerSourceTruth(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  adapter: CrmAdapter;
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
}) {
  if (!input.adapter.readContactHistory || !input.secret.crmUserExternalId)
    return { checked: 0, resolvedNewLeads: 0, deferred: 0 };
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const rows = await db
    .select({
      contact: crmContacts,
      workType: salesWorkItems.type,
      workCreatedAt: salesWorkItems.createdAt,
      priority: salesWorkItems.priority,
    })
    .from(salesWorkItems)
    .innerJoin(
      crmContacts,
      and(
        eq(crmContacts.organisationId, salesWorkItems.organisationId),
        eq(crmContacts.connectedSystemId, salesWorkItems.connectedSystemId),
        eq(crmContacts.externalId, salesWorkItems.contactExternalId)
      )
    )
    .where(
      and(
        eq(salesWorkItems.organisationId, input.organisationId),
        eq(salesWorkItems.connectedSystemId, input.connectedSystemId),
        eq(salesWorkItems.salespersonUserId, input.userId),
        inArray(salesWorkItems.status, [
          "open",
          "in_progress",
          "snoozed",
          "blocked",
        ])
      )
    )
    .orderBy(desc(salesWorkItems.priority), asc(salesWorkItems.id))
    .limit(100);

  const candidates = new Map<
    string,
    { contact: typeof crmContacts.$inferSelect; newLeadCreatedAt?: Date }
  >();
  for (const row of rows) {
    if (!row.contact.externalId) continue;
    const existing = candidates.get(row.contact.externalId);
    if (!existing) {
      candidates.set(row.contact.externalId, {
        contact: row.contact,
        ...(row.workType === "NEW_LEAD"
          ? { newLeadCreatedAt: row.workCreatedAt }
          : {}),
      });
    } else if (row.workType === "NEW_LEAD" && !existing.newLeadCreatedAt) {
      existing.newLeadCreatedAt = row.workCreatedAt;
    }
    if (candidates.size >= MAX_ACTIVE_CUSTOMER_HISTORY_CHECKS_PER_SYNC) break;
  }

  let checked = 0;
  let resolvedNewLeads = 0;
  let deferred = 0;
  for (const { contact, newLeadCreatedAt } of Array.from(candidates.values())) {
    if (contact.ownerExternalId !== input.secret.crmUserExternalId) {
      deferred += 1;
      continue;
    }
    try {
      const history = await input.adapter.readContactHistory({
        connection: input.connection,
        secret: input.secret,
        externalId: contact.externalId,
      });
      for (const activity of history.activities)
        if (
          activity.contactExternalId !== contact.externalId ||
          activity.ownerExternalId !== input.secret.crmUserExternalId
        )
          throw new Error("CRM_OWNER_SCOPE_VIOLATION");
      await upsertActivities(
        input.organisationId,
        input.connectedSystemId,
        history.activities
      );
      checked += 1;

      if (newLeadCreatedAt) {
        // The watcher can observe a new lead a few minutes after the salesperson
        // has already made first contact. Use a bounded lookback, not arbitrary
        // historic activity, when deciding whether the lead is still untouched.
        const evidenceFloor = newLeadCreatedAt.getTime() - 24 * 60 * 60_000;
        const worked = history.activities.some(
          activity =>
            activity.occurredAt.getTime() >= evidenceFloor &&
            crmActivityHistoryProvesLeadWorked(
              activity,
              input.secret.crmUserExternalId!
            )
        );
        if (worked)
          resolvedNewLeads += await completeNewLeadWorkAfterVerifiedContact({
            userId: input.userId,
            organisationId: input.organisationId,
            contactExternalId: contact.externalId,
            reason: "verified_customer_history",
          });
      }
    } catch {
      deferred += 1;
    }
  }
  return { checked, resolvedNewLeads, deferred };
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

export async function drainCrmPages<T>(input: {
  initialCursor?: string;
  maxPages?: number;
  fetchPage: (cursor?: string) => Promise<{ records: T[]; cursor?: string }>;
  onPage: (records: T[]) => Promise<void>;
}) {
  let cursor = input.initialCursor;
  let total = 0;
  let pageCount = 0;
  const maxPages = Math.max(1, input.maxPages ?? 100);
  do {
    const result = await input.fetchPage(cursor);
    await input.onPage(result.records);
    total += result.records.length;
    pageCount += 1;
    if (result.cursor && result.cursor === cursor)
      throw new Error(
        "CRM_SYNC_CURSOR_STALLED: provider returned the same cursor twice."
      );
    cursor = result.cursor;
    if (cursor && pageCount >= maxPages)
      throw new Error(
        `CRM_SYNC_PAGE_LIMIT_REACHED: provider still has more records after ${maxPages} pages.`
      );
  } while (cursor);
  return { total, pageCount };
}

async function syncConnectedSystemDeterministically(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  await reconcileCurrentBrowserReadiness(input);
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
  const browserPersonalScopeRequired =
    connection.connectionMethod === "browser" ||
    connection.connectionMethod === "sidecar";
  const hasExactBrowserUserScope = Boolean(
    secret.crmUserExternalId && secret.crmUserDisplayName && secret.crmUserEmail
  );
  const browserOperationStatuses = browserPersonalScopeRequired
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
    const personalResource = [
      "contacts",
      "opportunities",
      "tasks",
      "activities",
    ].includes(resourceType);
    const browserSourceScopedResource = [
      "contacts",
      "tasks",
      ...(connection.provider === "genie" ? ["opportunities"] : []),
    ].includes(resourceType);
    if (browserPersonalScopeRequired && personalResource) {
      if (!hasExactBrowserUserScope || !browserSourceScopedResource) {
        summary[resourceType] = 0;
        continue;
      }
    }
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
      type SyncRecord =
        | NormalizedCompany
        | NormalizedContact
        | NormalizedOpportunity
        | NormalizedTask
        | NormalizedActivity;
      const currentTaskExternalIds =
        resourceType === "tasks" ? new Set<string>() : undefined;
      const drained = await drainCrmPages<SyncRecord>({
        initialCursor: existing?.cursor ?? undefined,
        fetchPage: cursor =>
          sync({ connection, secret, cursor }) as Promise<{
            records: SyncRecord[];
            cursor?: string;
          }>,
        onPage: async records => {
          if (browserPersonalScopeRequired && personalResource)
            assertPersonalBrowserOwnerScope({
              resourceType,
              expectedOwnerExternalId: secret.crmUserExternalId || "",
              records,
            });
          if (currentTaskExternalIds)
            for (const record of records)
              currentTaskExternalIds.add(record.externalId);
          const contactBaseline =
            resourceType === "contacts"
              ? {
                  baselineComplete: Boolean(existing?.lastSuccessfulAt),
                  existingExternalIds: await existingContactIds(
                    input.organisationId,
                    system.id,
                    records.map(record => record.externalId)
                  ),
                }
              : undefined;
          await persist(input.organisationId, system.id, records as never[]);
          await upsertSalesWorkFromCrm({
            organisationId: input.organisationId,
            connectedSystemId: system.id,
            resource: { type: resourceType, records } as Parameters<
              typeof upsertSalesWorkFromCrm
            >[0]["resource"],
            contactBaseline,
          });
        },
      });
      if (
        resourceType === "tasks" &&
        currentTaskExternalIds &&
        secret.crmUserExternalId
      ) {
        await reconcileOpenTaskSnapshot({
          organisationId: input.organisationId,
          connectedSystemId: system.id,
          ownerExternalId: secret.crmUserExternalId,
          currentOpenIds: currentTaskExternalIds,
        });
        await reconcileNewLeadAlertsFromTaskHistory({
          userId: input.userId,
          organisationId: input.organisationId,
          connectedSystemId: system.id,
        });
      }
      await saveCursor(system.id, resourceType, undefined);
      summary[resourceType] = drained.total;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message.slice(0, 800)
          : "Unknown sync error";
      if (!isTransientBrowserExecutionFailure(error))
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
  await reconcileCurrentBrowserReadiness(input);
  if (Object.keys(failures).length) {
    const error = new Error(
      `CRM_SYNC_PARTIAL_FAILURE: ${Object.entries(failures)
        .map(([resource, detail]) => `${resource}: ${detail}`)
        .join("; ")}`
    );
    Object.assign(error, {
      transient: Object.values(failures).every(
        isTransientBrowserExecutionFailure
      ),
    });
    throw error;
  }
  return summary;
}

async function syncConnectedSystemRoutineDeterministically(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  await reconcileCurrentBrowserReadiness(input);
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
  const browserConnection = ["browser", "sidecar"].includes(
    connection.connectionMethod
  );
  if (!browserConnection || !adapter.syncRecentContacts)
    return syncConnectedSystemDeterministically(input);

  const secret = await usableSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connection,
  });
  if (!secret.crmUserExternalId)
    throw new Error("CRM_SALESPERSON_IDENTITY_REQUIRED");
  const operationStatuses = new Map(
    (
      await browserOperationReadinessForSystem({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
      })
    ).operations.map(operation => [operation.key, operation.status])
  );
  const summary: Record<string, number | string> = { mode: "routine" };
  const failures: Record<string, string> = {};
  const failureTransient: Record<string, boolean> = {};

  if (
    crmResourceSyncEligible(
      connection,
      "contacts.read",
      operationStatuses.get("contact.sync")
    )
  ) {
    try {
      const existing = await cursorFor(system.id, "contacts");
      const page = await adapter.syncRecentContacts({ connection, secret });
      assertPersonalBrowserOwnerScope({
        resourceType: "contacts",
        expectedOwnerExternalId: secret.crmUserExternalId,
        records: page.records,
      });
      const existingExternalIds = await existingContactIds(
        input.organisationId,
        system.id,
        page.records.map(record => record.externalId)
      );
      await upsertContacts(input.organisationId, system.id, page.records);
      await upsertSalesWorkFromCrm({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        resource: { type: "contacts", records: page.records },
        contactBaseline: {
          baselineComplete: Boolean(existing?.lastSuccessfulAt),
          existingExternalIds,
        },
      });
      summary.contacts = page.records.length;
    } catch (error) {
      failures.contacts =
        error instanceof Error
          ? error.message.slice(0, 800)
          : "Unknown sync error";
      failureTransient.contacts = isTransientBrowserExecutionFailure(error);
    }
  } else summary.contacts = 0;

  if (
    crmResourceSyncEligible(
      connection,
      "opportunities.read",
      operationStatuses.get("opportunity.sync")
    )
  ) {
    const existing = await cursorFor(system.id, "opportunities");
    try {
      const drained = await drainCrmPages<NormalizedOpportunity>({
        initialCursor: undefined,
        fetchPage: cursor =>
          adapter.syncOpportunities({ connection, secret, cursor }),
        onPage: async records => {
          assertPersonalBrowserOwnerScope({
            resourceType: "opportunities",
            expectedOwnerExternalId: secret.crmUserExternalId || "",
            records,
          });
          await upsertOpportunities(input.organisationId, system.id, records);
          await upsertSalesWorkFromCrm({
            organisationId: input.organisationId,
            connectedSystemId: system.id,
            resource: { type: "opportunities", records },
          });
        },
      });
      await saveCursor(system.id, "opportunities", undefined);
      summary.opportunities = drained.total;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message.slice(0, 800)
          : "Unknown sync error";
      if (!isTransientBrowserExecutionFailure(error))
        await saveCursor(
          system.id,
          "opportunities",
          undefined,
          detail,
          existing?.lastSuccessfulAt
        );
      failures.opportunities = detail;
      failureTransient.opportunities =
        isTransientBrowserExecutionFailure(error);
    }
  } else summary.opportunities = 0;

  if (
    crmResourceSyncEligible(
      connection,
      "tasks.read",
      operationStatuses.get("task.sync")
    )
  ) {
    const existing = await cursorFor(system.id, "tasks");
    try {
      const currentTaskExternalIds = new Set<string>();
      const drained = await drainCrmPages<NormalizedTask>({
        // The Genie task reader is a complete current-pending snapshot. Never
        // resume from an old historical cursor or missing tasks cannot be retired.
        initialCursor: undefined,
        fetchPage: cursor => adapter.syncTasks({ connection, secret, cursor }),
        onPage: async records => {
          assertPersonalBrowserOwnerScope({
            resourceType: "tasks",
            expectedOwnerExternalId: secret.crmUserExternalId || "",
            records,
          });
          for (const record of records)
            currentTaskExternalIds.add(record.externalId);
          await upsertTasks(input.organisationId, system.id, records);
          await upsertSalesWorkFromCrm({
            organisationId: input.organisationId,
            connectedSystemId: system.id,
            resource: { type: "tasks", records },
          });
        },
      });
      await reconcileOpenTaskSnapshot({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        ownerExternalId: secret.crmUserExternalId,
        currentOpenIds: currentTaskExternalIds,
      });
      await reconcileNewLeadAlertsFromTaskHistory({
        userId: input.userId,
        organisationId: input.organisationId,
        connectedSystemId: system.id,
      });
      await saveCursor(system.id, "tasks", undefined);
      summary.tasks = drained.total;
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message.slice(0, 800)
          : "Unknown sync error";
      if (!isTransientBrowserExecutionFailure(error))
        await saveCursor(
          system.id,
          "tasks",
          undefined,
          detail,
          existing?.lastSuccessfulAt
        );
      failures.tasks = detail;
      failureTransient.tasks = isTransientBrowserExecutionFailure(error);
    }
  } else summary.tasks = 0;

  if (
    crmResourceSyncEligible(
      connection,
      "contacts.read",
      operationStatuses.get("contact.read")
    )
  ) {
    try {
      const history = await refreshActiveCustomerSourceTruth({
        userId: input.userId,
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        adapter,
        connection,
        secret,
      });
      summary.customerHistoryChecked = history.checked;
      summary.newLeadHistoryResolved = history.resolvedNewLeads;
      summary.customerHistoryDeferred = history.deferred;
    } catch {
      summary.customerHistoryDeferred = 1;
    }
  }

  await reconcileCurrentBrowserReadiness(input);
  if (Object.keys(failures).length) {
    const error = new Error(
      `CRM_SYNC_PARTIAL_FAILURE: ${Object.entries(failures)
        .map(([resource, detail]) => `${resource}: ${detail}`)
        .join("; ")}`
    );
    Object.assign(error, {
      transient: Object.keys(failures).every(
        key => failureTransient[key] === true
      ),
    });
    throw error;
  }
  return summary;
}

/**
 * Unattended read-only reconciliation for browser CRMs. It keeps recent
 * contacts, owner-scoped opportunities, the complete current pending-task
 * snapshot and exact history for active customers aligned with source truth.
 * It never performs a CRM write.
 */
export async function syncConnectedSystemRoutine(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const result = await runModelFreeOperation(
    {
      purpose: "crm_sync",
      organisationId: input.organisationId,
      connectedSystemId: input.connectedSystemId,
      reference: `crm-routine-sync:${input.connectedSystemId}:${Date.now()}`,
    },
    () => syncConnectedSystemRoutineDeterministically(input)
  );
  return {
    ...result.value,
    lastSuccessfulAt: new Date().toISOString(),
    modelUsed: result.evidence.modelUsed,
    providerCallCount: result.evidence.providerCallCount,
  };
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
      const sync = ["browser", "sidecar"].includes(system.connectionMethod)
        ? syncConnectedSystemRoutine
        : syncConnectedSystem;
      results.push(
        await sync({
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
