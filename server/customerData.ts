import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  crmContacts,
  crmCompanies,
  crmTasks,
  crmActivities,
  crmOpportunities,
  externalUserMappings,
  inboundMessages,
} from "../drizzle/schema";
import { getDb } from "./db";
import { requireOrganisationMembership } from "./organisation";
import { getOrganisationWorkspaceContext } from "./organisationWorkspace";
import { deriveCustomerInterest } from "./customerInterest";
import { opportunityIsHistorical } from "./crm/actionExecutionPreconditions";
import {
  INCOMPLETE_TASK_STATUSES,
  isIncompleteTask,
  isCompletedTask,
} from "../shared/taskState";
const customerHistoryRefreshDueAt = new Map<string, number>();
const CUSTOMER_HISTORY_REFRESH_TTL_MS = 5 * 60_000;

export async function refreshExactCustomerHistoryIfDue(input: {
  userId: number;
  organisationId: number;
  contactId: number;
  force?: boolean;
}) {
  const key = `${input.organisationId}:${input.userId}:${input.contactId}`;
  const now = Date.now();
  if (!input.force && (customerHistoryRefreshDueAt.get(key) || 0) > now)
    return { refreshed: false as const };
  const result = await refreshExactCustomerHistory(input);
  customerHistoryRefreshDueAt.set(key, now + CUSTOMER_HISTORY_REFRESH_TTL_MS);
  return { refreshed: true as const, result };
}

export function personalOwnerSql(
  input: { userId: number; organisationId: number },
  system: AnyMySqlColumn,
  owner: AnyMySqlColumn
): SQL {
  return sql`exists (select 1 from ${externalUserMappings} where ${externalUserMappings.organisationId}=${input.organisationId} and ${externalUserMappings.userId}=${input.userId} and ${externalUserMappings.isActive}=true and ${externalUserMappings.connectedSystemId}=${system} and ${externalUserMappings.externalUserId}=${owner})`;
}
export function customerPageInput(input: {
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: string;
}) {
  return {
    page: Math.max(1, Math.floor(input.page || 1)),
    pageSize: Math.min(100, Math.max(1, Math.floor(input.pageSize || 50))),
    search: (input.search || "").trim().slice(0, 200),
    sort: input.sort === "name" ? ("name" as const) : ("updated" as const),
  };
}
export function customerName(contact: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  externalId: string;
}) {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contact.phone ||
    `CRM contact ${contact.externalId}`
  );
}
export function normalizedCustomerAttributes(raw: unknown) {
  const context =
    raw && typeof raw === "object"
      ? (raw as any).normalizedCustomerContext
      : undefined;
  return {
    source: typeof context?.source === "string" ? context.source : null,
    tags: Array.isArray(context?.tags)
      ? context.tags.filter((s: unknown) => typeof s === "string")
      : [],
    customFields:
      context?.customFields &&
      typeof context.customFields === "object" &&
      !Array.isArray(context.customFields)
        ? context.customFields
        : {},
    customFieldLabels:
      context?.customFieldLabels &&
      typeof context.customFieldLabels === "object" &&
      !Array.isArray(context.customFieldLabels)
        ? context.customFieldLabels
        : {},
  };
}
export async function listCustomerDirectory(input: {
  userId: number;
  organisationId: number;
  page?: number;
  pageSize?: number;
  search?: string;
  sort?: "name" | "updated";
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  const request = customerPageInput(input);
  const workspace = await getOrganisationWorkspaceContext(input.organisationId);
  const pattern = `%${request.search.replace(/[\\%_]/g, "\\$&")}%`;
  const owned = and(
    eq(crmContacts.organisationId, input.organisationId),
    personalOwnerSql(
      input,
      crmContacts.connectedSystemId,
      crmContacts.ownerExternalId
    )
  );
  const where = and(
    owned,
    request.search
      ? or(
          like(crmContacts.firstName, pattern),
          like(crmContacts.lastName, pattern),
          like(
            sql`concat_ws(' ',${crmContacts.firstName},${crmContacts.lastName})`,
            pattern
          ),
          like(crmContacts.email, pattern),
          like(crmContacts.phone, pattern),
          like(crmContacts.lifecycleStage, pattern)
        )
      : undefined
  );
  const [matched] = await db
    .select({ total: count() })
    .from(crmContacts)
    .where(where);
  const [all] = await db
    .select({ total: count() })
    .from(crmContacts)
    .where(owned);
  const items = await db
    .select({
      id: crmContacts.id,
      connectedSystemId: crmContacts.connectedSystemId,
      externalId: crmContacts.externalId,
      companyExternalId: crmContacts.companyExternalId,
      ownerExternalId: crmContacts.ownerExternalId,
      firstName: crmContacts.firstName,
      lastName: crmContacts.lastName,
      email: crmContacts.email,
      phone: crmContacts.phone,
      lifecycleStage: crmContacts.lifecycleStage,
      raw: crmContacts.raw,
      updatedAt: crmContacts.updatedAt,
      companyName: crmCompanies.name,
    })
    .from(crmContacts)
    .leftJoin(
      crmCompanies,
      and(
        eq(crmCompanies.organisationId, input.organisationId),
        eq(crmCompanies.connectedSystemId, crmContacts.connectedSystemId),
        eq(crmCompanies.externalId, crmContacts.companyExternalId)
      )
    )
    .where(where)
    .orderBy(
      ...(request.sort === "name"
        ? [
            asc(crmContacts.lastName),
            asc(crmContacts.firstName),
            asc(crmContacts.id),
          ]
        : [desc(crmContacts.updatedAt), desc(crmContacts.id)])
    )
    .limit(request.pageSize)
    .offset((request.page - 1) * request.pageSize);
  return {
    items: items.map(contact => {
      const attributes = normalizedCustomerAttributes(contact.raw);
      return {
        ...contact,
        raw: undefined,
        name: customerName(contact),
        interest: deriveCustomerInterest({
          mappings: workspace.customerFieldMappings,
          attributes,
        }),
      };
    }),
    page: request.page,
    pageSize: request.pageSize,
    total: Number(matched.total),
    totalAll: Number(all.total),
    search: request.search,
    sort: request.sort,
    hasNext: request.page * request.pageSize < Number(matched.total),
  };
}
export async function getExactCustomerDetail(input: {
  userId: number;
  organisationId: number;
  contactId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  const [contact] = await db
    .select()
    .from(crmContacts)
    .where(
      and(
        eq(crmContacts.id, input.contactId),
        eq(crmContacts.organisationId, input.organisationId),
        personalOwnerSql(
          input,
          crmContacts.connectedSystemId,
          crmContacts.ownerExternalId
        )
      )
    )
    .limit(1);
  if (!contact) return null;
  const taskScope = and(
    eq(crmTasks.organisationId, input.organisationId),
    eq(crmTasks.connectedSystemId, contact.connectedSystemId),
    eq(crmTasks.contactExternalId, contact.externalId),
    eq(crmTasks.ownerExternalId, contact.ownerExternalId!)
  );
  const activityScope = and(
    eq(crmActivities.organisationId, input.organisationId),
    eq(crmActivities.connectedSystemId, contact.connectedSystemId),
    eq(crmActivities.contactExternalId, contact.externalId),
    eq(crmActivities.ownerExternalId, contact.ownerExternalId!)
  );
  const opportunityScope = and(
    eq(crmOpportunities.organisationId, input.organisationId),
    eq(crmOpportunities.connectedSystemId, contact.connectedSystemId),
    eq(crmOpportunities.contactExternalId, contact.externalId),
    eq(crmOpportunities.ownerExternalId, contact.ownerExternalId!)
  );
  const [
    tasks,
    history,
    activities,
    opportunities,
    companies,
    communications,
    taskTotal,
    activityTotal,
    opportunityTotal,
    workspace,
  ] = await Promise.all([
    db
      .select()
      .from(crmTasks)
      .where(
        and(taskScope, inArray(crmTasks.status, [...INCOMPLETE_TASK_STATUSES]))
      )
      .orderBy(asc(crmTasks.dueAt), asc(crmTasks.id))
      .limit(100),
    db
      .select()
      .from(crmTasks)
      .where(
        and(
          taskScope,
          inArray(crmTasks.status, [
            "completed",
            "done",
            "closed",
            "cancelled",
            "canceled",
          ])
        )
      )
      .orderBy(
        desc(crmTasks.completedAt),
        desc(crmTasks.sourceUpdatedAt),
        desc(crmTasks.id)
      )
      .limit(50),
    db
      .select()
      .from(crmActivities)
      .where(activityScope)
      .orderBy(desc(crmActivities.occurredAt), desc(crmActivities.id))
      .limit(100),
    db
      .select()
      .from(crmOpportunities)
      .where(opportunityScope)
      .orderBy(desc(crmOpportunities.updatedAt), desc(crmOpportunities.id))
      .limit(100),
    contact.companyExternalId
      ? db
          .select()
          .from(crmCompanies)
          .where(
            and(
              eq(crmCompanies.organisationId, input.organisationId),
              eq(crmCompanies.connectedSystemId, contact.connectedSystemId),
              eq(crmCompanies.externalId, contact.companyExternalId)
            )
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(inboundMessages.connectedSystemId, contact.connectedSystemId),
          eq(inboundMessages.contactExternalId, contact.externalId),
          eq(inboundMessages.mailboxUserId, input.userId)
        )
      )
      .orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.id))
      .limit(50),
    db.select({ total: count() }).from(crmTasks).where(taskScope),
    db.select({ total: count() }).from(crmActivities).where(activityScope),
    db
      .select({ total: count() })
      .from(crmOpportunities)
      .where(opportunityScope),
    getOrganisationWorkspaceContext(input.organisationId),
  ]);
  const attributes = normalizedCustomerAttributes(contact.raw);
  const interest = deriveCustomerInterest({
    mappings: workspace.customerFieldMappings,
    attributes,
  });
  const mappedFields = workspace.customerFieldMappings.map(mapping => {
    const sourceValue = attributes.customFields[mapping.sourceFieldId] ?? null;
    const value =
      mapping.purpose?.trim().toLowerCase() === "interest" &&
      (sourceValue === null ||
        sourceValue === undefined ||
        (typeof sourceValue === "string" && !sourceValue.trim()))
        ? interest.primary
        : sourceValue;
    return { ...mapping, value };
  });
  return {
    ...contact,
    raw: undefined,
    name: customerName(contact),
    companyName: companies[0]?.name || null,
    company: companies[0] || null,
    openOpportunity:
      opportunities.find(
        opportunity =>
          !opportunityIsHistorical({
            stage: opportunity.stage || undefined,
            raw: opportunity.raw,
          })
      ) || null,
    lastInteraction: activities[0] || null,
    nextAction: tasks[0] || null,
    attributes,
    interest,
    mappedFields,
    workspace,
    tasks: {
      current: tasks,
      completed: history,
      total: Number(taskTotal[0].total),
      currentLimit: 100,
      historyLimit: 50,
    },
    activities: {
      items: activities,
      total: Number(activityTotal[0].total),
      limit: 100,
    },
    opportunities: {
      items: opportunities,
      total: Number(opportunityTotal[0].total),
      limit: 100,
    },
    communications: { items: communications, limit: 50 },
  };
}

/** Explicit source refresh: provider reads only, writes only the internal normalized cache. */
export async function refreshExactCustomerHistory(input: {
  userId: number;
  organisationId: number;
  contactId: number;
}) {
  const contact = await getExactCustomerDetail(input);
  if (!contact) throw Error("CUSTOMER_NOT_AVAILABLE");
  const {
    getConnectedSystemForUser,
    loadUserConnectionSecret,
    toAdapterConnection,
  } = await import("./connectedSystems");
  const { getCrmAdapter } = await import("./crm/adapterRegistry");
  const system = await getConnectedSystemForUser(
    input.userId,
    input.organisationId,
    contact.connectedSystemId
  );
  const adapter = getCrmAdapter(system.provider);
  if (!adapter.readContactHistory)
    throw Error("CUSTOMER_HISTORY_READ_NOT_AVAILABLE");
  const secret = await loadUserConnectionSecret({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: contact.connectedSystemId,
    secretKind: "browser",
  });
  if (
    !secret?.crmUserExternalId ||
    secret.crmUserExternalId !== contact.ownerExternalId
  )
    throw Error("CRM_OWNER_SCOPE_VIOLATION");
  const result = await adapter.readContactHistory({
    connection: toAdapterConnection(system),
    secret,
    externalId: contact.externalId,
  });
  const db = await getDb();
  if (!db) throw Error("Database connection is unavailable.");
  for (const record of result.activities) {
    if (
      record.ownerExternalId !== contact.ownerExternalId ||
      record.contactExternalId !== contact.externalId
    )
      throw Error("CRM_OWNER_SCOPE_VIOLATION");
    await db
      .insert(crmActivities)
      .values({
        ...record,
        organisationId: input.organisationId,
        connectedSystemId: contact.connectedSystemId,
      })
      .onDuplicateKeyUpdate({
        set: {
          activityType: record.activityType,
          body: record.body ?? null,
          occurredAt: record.occurredAt,
          raw: record.raw,
        },
      });
  }
  return {
    customer: await getExactCustomerDetail(input),
    coverage: result.coverage,
  };
}
