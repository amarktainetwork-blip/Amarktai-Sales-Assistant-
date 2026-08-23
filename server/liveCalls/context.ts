import { and, asc, desc, eq, like, or } from "drizzle-orm";
import {
  callSessions,
  connectedSystems,
  crmActivities,
  crmCompanies,
  crmContacts,
  crmOpportunities,
  crmTasks,
  inboundMessages,
} from "../../drizzle/schema";
import { createLiveCallSession, getDb } from "../db";
import { getTodayWork } from "../today";

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
  reasons: string[];
  objective?: string;
};

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

async function contextForContact(input: {
  organisationId: number;
  contact: typeof crmContacts.$inferSelect;
  source: LiveCallCrmContext["source"];
  reasons?: string[];
  opportunity?: typeof crmOpportunities.$inferSelect;
}) {
  const db = await dbOrThrow();
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
            eq(crmOpportunities.contactExternalId, input.contact.externalId)
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
          )
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
          eq(crmActivities.contactExternalId, input.contact.externalId)
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
          eq(inboundMessages.contactExternalId, input.contact.externalId)
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
    reasons: input.reasons || [],
    objective:
      task?.title || opportunity?.raw?.nextStep?.toString() || undefined,
  } satisfies LiveCallCrmContext;
}

export async function startLiveCallFromToday(input: {
  userId: number;
  organisationId: number;
  opportunityId: number;
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
  const contact = (
    await db
      .select()
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.organisationId, input.organisationId),
          eq(crmContacts.connectedSystemId, priority.connectedSystemId),
          eq(crmContacts.externalId, priority.contactExternalId)
        )
      )
      .limit(1)
  )[0];
  if (!contact) throw new Error("The normalized CRM contact was not found.");
  const context = await contextForContact({
    organisationId: input.organisationId,
    contact,
    opportunity: priority,
    source: "today",
    reasons: priority.reasons,
  });
  const callSessionId = await createLiveCallSession({
    userId: input.userId,
    organisationId: input.organisationId,
    leadLabel: context.contactName,
    crmContext: context,
  });
  return { callSessionId, leadLabel: context.contactName, context };
}

export async function searchLiveCallContacts(input: {
  organisationId: number;
  query: string;
}) {
  const db = await dbOrThrow();
  const query = input.query.trim();
  const email = query.includes("@") ? query.toLowerCase() : "";
  const escaped = query.replace(/[\\%_]/g, value => `\\${value}`);
  const rows = await db
    .select()
    .from(crmContacts)
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
  return rows.map(contact => ({
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
  const db = await dbOrThrow();
  const contact = (
    await db
      .select()
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.id, input.contactId),
          eq(crmContacts.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!contact)
    throw new Error(
      "The selected CRM contact is outside the active organisation."
    );
  const context = await contextForContact({
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
  const contacts = await db
    .select()
    .from(crmContacts)
    .where(
      and(
        eq(crmContacts.organisationId, input.organisationId),
        eq(crmContacts.externalId, contactExternalId)
      )
    )
    .limit(2);
  if (contacts.length !== 1)
    throw new Error(
      contacts.length > 1
        ? "AMBIGUOUS_TARGET: choose the normalized CRM contact before closeout."
        : "TARGET_MISMATCH: the supplied contact is not in the active organisation."
    );
  const context = await contextForContact({
    organisationId: input.organisationId,
    contact: contacts[0],
    source: "manual_resolved",
  });
  if (input.advanced?.taskExternalId) {
    const task = (
      await db
        .select()
        .from(crmTasks)
        .where(
          and(
            eq(crmTasks.organisationId, input.organisationId),
            eq(crmTasks.connectedSystemId, context.connectedSystemId),
            eq(crmTasks.externalId, input.advanced.taskExternalId)
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
            )
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
