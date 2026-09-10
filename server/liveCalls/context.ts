import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import {
  callSessions,
  connectedSystems,
  crmActivities,
  crmCompanies,
  crmContacts,
  crmOpportunities,
  crmTasks,
  externalUserMappings,
  inboundMessages,
} from "../../drizzle/schema";
import { createLiveCallSession, getDb, recordAudit } from "../db";
import { getTodayWork } from "../today";
import { getCrmAdapter } from "../crm/adapterRegistry";
import { loadConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { requireRuntimeBrowserOperation } from "../browserConnectors/learnedOperations";
import { randomUUID } from "node:crypto";

export type LiveCallCrmContext = {
  source: "today" | "manual_resolved";
  connectedSystemId: number;
  provider: string;
  contactExternalId: string;
  contactName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  taskExternalId?: string;
  taskTitle?: string;
  opportunityExternalId?: string;
  opportunityName?: string;
  ownerExternalId?: string;
  pipeline?: string;
  stage?: string;
  lastInteraction?: string;
  recentInbound?: string;
  recentInboundSubject?: string;
  recentInboundBody?: string;
  reasons: string[];
  objective?: string;
  diallerLaunch?: {
    connectedSystemId: number;
    contactExternalId: string;
    correlationId: string;
    completedAt: string;
    operation: "dialler.launch";
  };
};

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

async function contextForContact(input: {
  userId: number;
  organisationId: number;
  contact: typeof crmContacts.$inferSelect;
  source: LiveCallCrmContext["source"];
  reasons?: string[];
  opportunity?: typeof crmOpportunities.$inferSelect;
}) {
  const db = await dbOrThrow();
  const ownerRows = await db
    .select({ externalUserId: externalUserMappings.externalUserId })
    .from(externalUserMappings)
    .where(
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(
          externalUserMappings.connectedSystemId,
          input.contact.connectedSystemId
        ),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .limit(100);
  const ownerIds = ownerRows.map(row => row.externalUserId);
  if (
    !input.contact.ownerExternalId ||
    !ownerIds.includes(input.contact.ownerExternalId)
  )
    throw new Error(
      "The selected CRM contact is not available to this user and organisation."
    );
  const opportunity =
    input.opportunity ||
    (
      await db
        .select()
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.organisationId, input.organisationId),
            eq(
              crmOpportunities.connectedSystemId,
              input.contact.connectedSystemId
            ),
            eq(crmOpportunities.contactExternalId, input.contact.externalId),
            inArray(crmOpportunities.ownerExternalId, ownerIds)
          )
        )
        .orderBy(desc(crmOpportunities.updatedAt))
        .limit(1)
    )[0];
  const [system, company, task, activity, inbound] = await Promise.all([
    db
      .select()
      .from(connectedSystems)
      .where(
        and(
          eq(connectedSystems.id, input.contact.connectedSystemId),
          eq(connectedSystems.organisationId, input.organisationId)
        )
      )
      .limit(1)
      .then(rows => rows[0]),
    input.contact.companyExternalId
      ? db
          .select()
          .from(crmCompanies)
          .where(
            and(
              eq(crmCompanies.organisationId, input.organisationId),
              eq(
                crmCompanies.connectedSystemId,
                input.contact.connectedSystemId
              ),
              eq(crmCompanies.externalId, input.contact.companyExternalId)
            )
          )
          .limit(1)
          .then(rows => rows[0])
      : undefined,
    db
      .select()
      .from(crmTasks)
      .where(
        and(
          eq(crmTasks.organisationId, input.organisationId),
          eq(crmTasks.connectedSystemId, input.contact.connectedSystemId),
          or(
            eq(crmTasks.contactExternalId, input.contact.externalId),
            opportunity
              ? eq(crmTasks.opportunityExternalId, opportunity.externalId)
              : eq(crmTasks.contactExternalId, input.contact.externalId)
          ),
          inArray(crmTasks.ownerExternalId, ownerIds)
        )
      )
      .orderBy(asc(crmTasks.dueAt))
      .limit(1)
      .then(rows => rows[0]),
    db
      .select()
      .from(crmActivities)
      .where(
        and(
          eq(crmActivities.organisationId, input.organisationId),
          eq(crmActivities.connectedSystemId, input.contact.connectedSystemId),
          eq(crmActivities.contactExternalId, input.contact.externalId),
          inArray(crmActivities.ownerExternalId, ownerIds)
        )
      )
      .orderBy(desc(crmActivities.occurredAt))
      .limit(1)
      .then(rows => rows[0]),
    db
      .select()
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.organisationId, input.organisationId),
          eq(
            inboundMessages.connectedSystemId,
            input.contact.connectedSystemId
          ),
          eq(inboundMessages.contactExternalId, input.contact.externalId),
          eq(inboundMessages.mailboxUserId, input.userId)
        )
      )
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(1)
      .then(rows => rows[0]),
  ]);
  if (!system)
    throw new Error("The contact's connected system is not available.");
  const contactName =
    [input.contact.firstName, input.contact.lastName]
      .filter(Boolean)
      .join(" ") ||
    input.contact.email ||
    input.contact.phone ||
    input.contact.externalId;
  return {
    source: input.source,
    connectedSystemId: system.id,
    provider: system.provider,
    contactExternalId: input.contact.externalId,
    contactName,
    companyName: company?.name || undefined,
    email: input.contact.email || undefined,
    phone: input.contact.phone || undefined,
    taskExternalId: task?.externalId,
    taskTitle: task?.title,
    opportunityExternalId: opportunity?.externalId,
    opportunityName: opportunity?.name,
    ownerExternalId:
      input.contact.ownerExternalId ||
      opportunity?.ownerExternalId ||
      undefined,
    pipeline: opportunity?.pipeline || undefined,
    stage: opportunity?.stage || undefined,
    lastInteraction: activity
      ? `${activity.activityType}: ${activity.body || "Recorded CRM activity"}`.slice(
          0,
          1_000
        )
      : undefined,
    recentInbound: inbound
      ? `${inbound.subject || "Inbound message"}: ${inbound.body}`.slice(
          0,
          1_000
        )
      : undefined,
    recentInboundSubject: inbound?.subject?.slice(0, 500) || undefined,
    recentInboundBody: inbound?.body?.slice(0, 2_500) || undefined,
    reasons: input.reasons || [],
    objective:
      task?.title || opportunity?.raw?.nextStep?.toString() || undefined,
  } satisfies LiveCallCrmContext;
}

export async function findPersonalCrmContact(input: {
  userId: number;
  organisationId: number;
  contactId?: number;
  connectedSystemId?: number;
  externalId?: string;
}) {
  const db = await dbOrThrow();
  const exactIdentity = input.contactId
    ? eq(crmContacts.id, input.contactId)
    : input.externalId
      ? input.connectedSystemId
        ? and(
            eq(crmContacts.connectedSystemId, input.connectedSystemId),
            eq(crmContacts.externalId, input.externalId)
          )
        : eq(crmContacts.externalId, input.externalId)
      : undefined;
  if (!exactIdentity) throw new Error("An exact CRM contact identity is required.");
  const rows = await db
    .select({ contact: crmContacts })
    .from(crmContacts)
    .innerJoin(
      externalUserMappings,
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(
          externalUserMappings.connectedSystemId,
          crmContacts.connectedSystemId
        ),
        eq(externalUserMappings.externalUserId, crmContacts.ownerExternalId),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .where(and(eq(crmContacts.organisationId, input.organisationId), exactIdentity))
    .limit(2);
  return rows.length === 1 ? rows[0].contact : undefined;
}

export async function startLiveCallFromToday(input: {
  userId: number;
  organisationId: number;
  opportunityId: number;
  callingMode?: "genie" | "external";
}) {
  const today = await getTodayWork(input);
  const priority = today.queues.priority.find(
    item => item.id === input.opportunityId
  );
  if (!priority)
    throw new Error(
      "The selected Today record is not available to this user and organisation."
    );
  const db = await dbOrThrow();
  if (!priority.contactExternalId)
    throw new Error("The selected opportunity has no normalized CRM contact.");
  const contact = await findPersonalCrmContact({
    userId: input.userId,
    organisationId: input.organisationId,
    connectedSystemId: priority.connectedSystemId,
    externalId: priority.contactExternalId,
  });
  if (!contact) throw new Error("The normalized CRM contact was not found.");
  const context: LiveCallCrmContext = await contextForContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contact,
    opportunity: priority,
    source: "today",
    reasons: priority.reasons,
  });
  if ((input.callingMode || "external") === "genie") {
    const system = (
      await db
        .select()
        .from(connectedSystems)
        .where(
          and(
            eq(connectedSystems.id, context.connectedSystemId),
            eq(connectedSystems.organisationId, input.organisationId)
          )
        )
        .limit(1)
    )[0];
    if (
      !system ||
      system.provider !== "genie" ||
      (system.connectionMethod !== "browser" &&
        system.connectionMethod !== "sidecar")
    )
      throw new Error(
        "GENIE_DIALLER_UNAVAILABLE: This customer is not attached to an authorised Genie browser connection. Use the clearly labelled external-phone option instead."
      );
    if (!["ready", "limited_permissions"].includes(system.status))
      throw new Error(
        "GENIE_DIALLER_SETUP_REQUIRED: Genie calling still needs to be tested. Finish dialler setup."
      );
    try {
      await requireRuntimeBrowserOperation({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        operationKey: "dialler.launch",
      });
    } catch {
      throw new Error(
        "GENIE_DIALLER_SETUP_REQUIRED: Genie calling still needs to be tested. Finish dialler setup."
      );
    }
    const secret =
      (await loadConnectionSecret({
        organisationId: input.organisationId,
        connectedSystemId: system.id,
        secretKind: "browser",
      })) || {};
    const adapter = getCrmAdapter(system.provider);
    if (!adapter.executeCustomAction)
      throw new Error(
        "GENIE_DIALLER_SETUP_REQUIRED: Genie calling still needs to be tested. Finish dialler setup."
      );
    const correlationId = randomUUID();
    const evidence = await adapter.executeCustomAction({
      connection: toAdapterConnection(system),
      secret,
      actionName: "dialler.launch",
      payload: {
        connectedSystemId: system.id,
        contactExternalId: context.contactExternalId,
        opportunityExternalId: context.opportunityExternalId,
        contactName: context.contactName,
        phone: context.phone,
      },
      correlationId,
    });
    context.diallerLaunch = {
      connectedSystemId: system.id,
      contactExternalId: context.contactExternalId,
      correlationId,
      completedAt: evidence.completedAt,
      operation: "dialler.launch",
    };
  }
  const callSessionId = await createLiveCallSession({
    userId: input.userId,
    organisationId: input.organisationId,
    leadLabel: context.contactName,
    crmContext: context,
  });
  if (context.diallerLaunch)
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "genie_dialler_launched",
      entityType: "call_session",
      entityId: String(callSessionId),
      summary:
        "The LIVE_PROVEN Genie dialler was launched for the exact normalized call contact.",
      metadata: {
        connectedSystemId: context.diallerLaunch.connectedSystemId,
        contactExternalId: context.diallerLaunch.contactExternalId,
        correlationId: context.diallerLaunch.correlationId,
        executionResult: "success",
        evidence: {
          operation: "dialler.launch",
          completedAt: context.diallerLaunch.completedAt,
          targetContextStored: true,
          adapterEvidenceStored: true,
        },
      },
    });
  return { callSessionId, leadLabel: context.contactName, context };
}

export async function searchLiveCallContacts(input: {
  userId: number;
  organisationId: number;
  query: string;
}) {
  const db = await dbOrThrow();
  const query = input.query.trim();
  const email = query.includes("@") ? query.toLowerCase() : "";
  const escaped = query.replace(/[\\%_]/g, value => `\\${value}`);
  const rows = await db
    .select({ contact: crmContacts })
    .from(crmContacts)
    .innerJoin(
      externalUserMappings,
      and(
        eq(externalUserMappings.organisationId, input.organisationId),
        eq(
          externalUserMappings.connectedSystemId,
          crmContacts.connectedSystemId
        ),
        eq(externalUserMappings.externalUserId, crmContacts.ownerExternalId),
        eq(externalUserMappings.userId, input.userId),
        eq(externalUserMappings.isActive, true)
      )
    )
    .where(
      and(
        eq(crmContacts.organisationId, input.organisationId),
        email
          ? eq(crmContacts.normalizedEmail, email)
          : or(
              eq(crmContacts.externalId, query),
              like(crmContacts.firstName, `%${escaped}%`),
              like(crmContacts.lastName, `%${escaped}%`),
              like(crmContacts.phone, `%${escaped}%`)
            )
      )
    )
    .limit(10);
  return rows.map(({ contact }) => ({
    id: contact.id,
    name:
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.externalId,
    email: contact.email,
    phone: contact.phone,
    connectedSystemId: contact.connectedSystemId,
  }));
}

export async function startLiveCallForContact(input: {
  userId: number;
  organisationId: number;
  contactId: number;
}) {
  const contact = await findPersonalCrmContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: input.contactId,
  });
  if (!contact)
    throw new Error(
      "The selected CRM contact is not available to this user and organisation."
    );
  const context = await contextForContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contact,
    source: "manual_resolved",
  });
  const callSessionId = await createLiveCallSession({
    userId: input.userId,
    organisationId: input.organisationId,
    leadLabel: context.contactName,
    crmContext: context,
  });
  return { callSessionId, leadLabel: context.contactName, context };
}

export async function getWorkingContextForContact(input: {
  userId: number;
  organisationId: number;
  contactId: number;
}) {
  const contact = await findPersonalCrmContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contactId: input.contactId,
  });
  if (!contact)
    throw new Error(
      "The selected CRM contact is not available to this user and organisation."
    );
  return contextForContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contact,
    source: "manual_resolved",
  });
}

export async function getLiveCallContext(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
}) {
  const db = await dbOrThrow();
  const session = (
    await db
      .select()
      .from(callSessions)
      .where(
        and(
          eq(callSessions.id, input.callSessionId),
          eq(callSessions.userId, input.userId),
          eq(callSessions.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!session) throw new Error("Live call session was not found.");
  return {
    id: session.id,
    leadLabel: session.leadLabel,
    status: session.status,
    context: (session.crmContext || undefined) as
      | LiveCallCrmContext
      | undefined,
  };
}

export async function resolveLiveCallCloseoutIdentity(input: {
  userId: number;
  organisationId: number;
  session: typeof callSessions.$inferSelect;
  advanced?: {
    contactExternalId?: string;
    taskExternalId?: string;
    opportunityExternalId?: string;
  };
}) {
  const existing = input.session.crmContext as LiveCallCrmContext | null;
  if (existing?.connectedSystemId && existing.contactExternalId)
    return existing;
  const contactExternalId = input.advanced?.contactExternalId?.trim();
  if (!contactExternalId) return undefined;
  const db = await dbOrThrow();
  const contact = await findPersonalCrmContact({
    userId: input.userId,
    organisationId: input.organisationId,
    externalId: contactExternalId,
  });
  if (!contact)
    throw new Error(
      "TARGET_MISMATCH: the supplied contact is not available to this user and organisation."
    );
  const context = await contextForContact({
    userId: input.userId,
    organisationId: input.organisationId,
    contact,
    source: "manual_resolved",
  });
  const ownerIds = (
    await db
      .select({ externalUserId: externalUserMappings.externalUserId })
      .from(externalUserMappings)
      .where(
        and(
          eq(externalUserMappings.organisationId, input.organisationId),
          eq(externalUserMappings.connectedSystemId, context.connectedSystemId),
          eq(externalUserMappings.userId, input.userId),
          eq(externalUserMappings.isActive, true)
        )
      )
      .limit(100)
  ).map(row => row.externalUserId);
  if (!ownerIds.length)
    throw new Error("TARGET_MISMATCH: no active CRM owner mapping exists for this user.");
  if (input.advanced?.taskExternalId) {
    const task = (
      await db
        .select()
        .from(crmTasks)
        .where(
          and(
            eq(crmTasks.organisationId, input.organisationId),
            eq(crmTasks.connectedSystemId, context.connectedSystemId),
            eq(crmTasks.externalId, input.advanced.taskExternalId),
            inArray(crmTasks.ownerExternalId, ownerIds)
          )
        )
        .limit(1)
    )[0];
    if (!task)
      throw new Error("TARGET_MISMATCH: task is outside the call context.");
    context.taskExternalId = task.externalId;
    context.taskTitle = task.title;
  }
  if (input.advanced?.opportunityExternalId) {
    const opportunity = (
      await db
        .select()
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.organisationId, input.organisationId),
            eq(crmOpportunities.connectedSystemId, context.connectedSystemId),
            eq(
              crmOpportunities.externalId,
              input.advanced.opportunityExternalId
            ),
            inArray(crmOpportunities.ownerExternalId, ownerIds)
          )
        )
        .limit(1)
    )[0];
    if (!opportunity)
      throw new Error(
        "TARGET_MISMATCH: opportunity is outside the call context."
      );
    context.opportunityExternalId = opportunity.externalId;
    context.opportunityName = opportunity.name;
  }
  await db
    .update(callSessions)
    .set({ crmContext: context })
    .where(eq(callSessions.id, input.session.id));
  return context;
}
