import { desc, eq } from "drizzle-orm";
import {
  crmActivities,
  crmContacts,
  crmOpportunities,
  crmPipelineStageMappings,
  crmTasks,
  externalUserMappings,
  inboundMessages,
} from "../drizzle/schema";
import { getDb } from "./db";
import { runGenxAgent } from "./genx";
import {
  canViewTeamData,
  requireOrganisationMembership,
} from "./organisation";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const STALE_OPPORTUNITY_DAYS = 7;
const INBOUND_SLA_HOURS = 4;

type ContactRow = typeof crmContacts.$inferSelect;
type OpportunityRow = typeof crmOpportunities.$inferSelect;
type TaskRow = typeof crmTasks.$inferSelect;
type ActivityRow = typeof crmActivities.$inferSelect;
type InboundRow = typeof inboundMessages.$inferSelect;
type UserMappingRow = typeof externalUserMappings.$inferSelect;
type StageMappingRow = typeof crmPipelineStageMappings.$inferSelect;

type EvidenceInput = {
  contacts: ContactRow[];
  opportunities: OpportunityRow[];
  tasks: TaskRow[];
  activities: ActivityRow[];
  inbound: InboundRow[];
  mappings: UserMappingRow[];
  stageMappings: StageMappingRow[];
  now?: Date;
};

export type PromiseSignal = {
  sourceId: string;
  actor: "team" | "customer" | "unknown";
  commitment: string;
  dueAt: string | null;
  status: "open" | "fulfilled" | "cancelled" | "unknown";
  overdue: boolean;
};

export type SalesWatchtower = ReturnType<typeof buildSalesWatchtowerFromEvidence> & {
  promises: PromiseSignal[];
  promiseAnalysis: "not_requested" | "no_evidence" | "complete" | "unavailable";
};

function recordKey(connectedSystemId: number, externalId?: string | null) {
  return externalId ? `${connectedSystemId}:${externalId}` : "";
}

function ageDays(value: Date | null | undefined, now: Date) {
  return value ? Math.max(0, Math.floor((now.valueOf() - value.valueOf()) / DAY_MS)) : null;
}

function ageHours(value: Date | null | undefined, now: Date) {
  return value ? Math.max(0, Math.floor((now.valueOf() - value.valueOf()) / HOUR_MS)) : null;
}

function openStatus(value?: string | null) {
  return !value || !/completed|closed|done|cancelled|lost|won/i.test(value);
}

function contactLabel(contact?: ContactRow) {
  if (!contact) return "Unknown customer";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || contact.phone || `Customer ${contact.externalId}`;
}

function rawString(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function communicationDirection(activity: ActivityRow): "inbound" | "outbound" | "unknown" {
  const declared = rawString(activity.raw, ["direction", "messageDirection", "activityDirection", "disposition"]).toLowerCase();
  if (/inbound|incoming|received|customer_to_team/.test(declared)) return "inbound";
  if (/outbound|outgoing|sent|team_to_customer/.test(declared)) return "outbound";
  if (/inbound|incoming|received/.test(activity.activityType)) return "inbound";
  if (/outbound|outgoing|sent/.test(activity.activityType)) return "outbound";
  return "unknown";
}

function communicationChannel(activity: ActivityRow) {
  const declared = rawString(activity.raw, ["channel", "messageChannel", "medium"]).toLowerCase();
  const source = `${declared} ${activity.activityType}`.toLowerCase();
  if (/whats ?app/.test(source)) return "whatsapp";
  if (/sms|text message/.test(source)) return "sms";
  if (/email|mail/.test(source)) return "email";
  if (/chat|message|messaging/.test(source)) return "chat";
  if (/call|phone|dial/.test(source)) return "call";
  if (/meeting|appointment|consult/.test(source)) return "meeting";
  return "other";
}

function isCommunication(activity: ActivityRow) {
  return /email|mail|sms|whats ?app|message|chat|call|phone|meeting|appointment|consult/i.test(
    `${activity.activityType} ${rawString(activity.raw, ["channel", "messageChannel", "medium"])}`
  );
}

function closedOpportunity(opportunity: OpportunityRow, stageByKey: Map<string, string>) {
  const mapped = opportunity.stage
    ? stageByKey.get(`${opportunity.connectedSystemId}:${opportunity.stage}`)
    : undefined;
  if (mapped === "won" || mapped === "lost") return true;
  return Boolean(opportunity.stage && /closed|won|lost|complete|successful|cancelled/i.test(opportunity.stage));
}

function priorityBand(score: number) {
  if (score >= 80) return "critical" as const;
  if (score >= 55) return "high" as const;
  if (score >= 30) return "medium" as const;
  return "low" as const;
}

function latest<T>(rows: T[], date: (row: T) => Date) {
  return rows.reduce<T | undefined>((best, row) => (!best || date(row) > date(best) ? row : best), undefined);
}

export function parsePromiseSignals(content: string, validSourceIds: Set<string>, now = new Date()): PromiseSignal[] {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (match?.[1] || content).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { promises?: unknown[] }).promises)
      ? (parsed as { promises: unknown[] }).promises
      : [];
  const signals: PromiseSignal[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const sourceId = typeof value.sourceId === "string" ? value.sourceId.trim() : "";
    const commitment = typeof value.commitment === "string" ? value.commitment.trim() : "";
    if (!sourceId || !validSourceIds.has(sourceId) || !commitment) continue;
    const actor = ["team", "customer", "unknown"].includes(String(value.actor))
      ? (String(value.actor) as PromiseSignal["actor"])
      : "unknown";
    const status = ["open", "fulfilled", "cancelled", "unknown"].includes(String(value.status))
      ? (String(value.status) as PromiseSignal["status"])
      : "unknown";
    const rawDueAt = typeof value.dueAt === "string" && value.dueAt.trim() ? value.dueAt.trim() : null;
    const parsedDue = rawDueAt ? new Date(rawDueAt) : null;
    const dueAt = parsedDue && !Number.isNaN(parsedDue.valueOf()) ? parsedDue.toISOString() : null;
    signals.push({
      sourceId,
      actor,
      commitment: commitment.slice(0, 500),
      dueAt,
      status,
      overdue: Boolean(dueAt && status === "open" && new Date(dueAt) < now),
    });
  }
  return signals.slice(0, 100);
}

export function buildSalesWatchtowerFromEvidence(input: EvidenceInput) {
  const now = input.now ?? new Date();
  const stageByKey = new Map(
    input.stageMappings
      .filter(mapping => mapping.isActive)
      .map(mapping => [`${mapping.connectedSystemId}:${mapping.externalStageId}`, mapping.category])
  );
  const contactByKey = new Map(input.contacts.map(contact => [recordKey(contact.connectedSystemId, contact.externalId), contact]));
  const opportunitiesByContact = new Map<string, OpportunityRow[]>();
  const tasksByContact = new Map<string, TaskRow[]>();
  const activitiesByContact = new Map<string, ActivityRow[]>();
  const inboundByContact = new Map<string, InboundRow[]>();

  for (const opportunity of input.opportunities) {
    const key = recordKey(opportunity.connectedSystemId, opportunity.contactExternalId);
    if (key) (opportunitiesByContact.get(key) ?? opportunitiesByContact.set(key, []).get(key)!).push(opportunity);
  }
  for (const task of input.tasks) {
    const key = recordKey(task.connectedSystemId, task.contactExternalId);
    if (key) (tasksByContact.get(key) ?? tasksByContact.set(key, []).get(key)!).push(task);
  }
  for (const activity of input.activities) {
    const key = recordKey(activity.connectedSystemId, activity.contactExternalId);
    if (key) (activitiesByContact.get(key) ?? activitiesByContact.set(key, []).get(key)!).push(activity);
  }
  for (const message of input.inbound) {
    if (!message.connectedSystemId) continue;
    const key = recordKey(message.connectedSystemId, message.contactExternalId);
    if (key) (inboundByContact.get(key) ?? inboundByContact.set(key, []).get(key)!).push(message);
  }

  const salesComms = input.contacts.map(contact => {
    const key = recordKey(contact.connectedSystemId, contact.externalId);
    const activities = (activitiesByContact.get(key) ?? []).filter(isCommunication);
    const inbound = inboundByContact.get(key) ?? [];
    const inboundActivities = activities.filter(activity => communicationDirection(activity) === "inbound");
    const outboundActivities = activities.filter(activity => communicationDirection(activity) === "outbound");
    const latestInboundMessage = latest(inbound, message => message.receivedAt);
    const latestInboundActivity = latest(inboundActivities, activity => activity.occurredAt);
    const latestOutboundActivity = latest(outboundActivities, activity => activity.occurredAt);
    const latestActivity = latest(activitiesByContact.get(key) ?? [], activity => activity.occurredAt);
    const latestInboundAt = [latestInboundMessage?.receivedAt, latestInboundActivity?.occurredAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.valueOf() - a.valueOf())[0] ?? null;
    const latestOutboundAt = latestOutboundActivity?.occurredAt ?? null;
    const unresolvedInbound = inbound.filter(message => message.needsAction);
    const waitingOnUs = unresolvedInbound.length > 0 || Boolean(latestInboundAt && (!latestOutboundAt || latestInboundAt > latestOutboundAt));
    const channelCounts = new Map<string, number>();
    for (const activity of activities) channelCounts.set(communicationChannel(activity), (channelCounts.get(communicationChannel(activity)) ?? 0) + 1);
    for (const message of inbound) channelCounts.set(message.channel, (channelCounts.get(message.channel) ?? 0) + 1);
    const preferredChannel = Array.from(channelCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const responseMinutes = latestInboundAt && latestOutboundAt && latestOutboundAt > latestInboundAt
      ? Math.floor((latestOutboundAt.valueOf() - latestInboundAt.valueOf()) / 60_000)
      : null;
    return {
      connectedSystemId: contact.connectedSystemId,
      contactExternalId: contact.externalId,
      customer: contactLabel(contact),
      ownerExternalId: contact.ownerExternalId,
      latestInboundAt,
      latestOutboundAt,
      latestActivityAt: latestActivity?.occurredAt ?? null,
      unresolvedInbound: unresolvedInbound.length,
      waitingOnUs,
      noRecordedReplyAfterLatestOutbound: Boolean(latestOutboundAt && (!latestInboundAt || latestOutboundAt > latestInboundAt)),
      latestResponseMinutes: responseMinutes,
      preferredChannel,
      communicationCount: activities.length + inbound.length,
    };
  }).filter(item => item.communicationCount > 0 || item.unresolvedInbound > 0);

  const leakage: Array<Record<string, unknown>> = [];
  const hygiene: Array<Record<string, unknown>> = [];
  const health: Array<Record<string, unknown>> = [];

  for (const opportunity of input.opportunities) {
    if (closedOpportunity(opportunity, stageByKey)) continue;
    const contact = contactByKey.get(recordKey(opportunity.connectedSystemId, opportunity.contactExternalId));
    const contactKey = recordKey(opportunity.connectedSystemId, opportunity.contactExternalId);
    const tasks = (tasksByContact.get(contactKey) ?? []).filter(task => openStatus(task.status));
    const overdueTasks = tasks.filter(task => task.dueAt && task.dueAt < now);
    const comms = salesComms.find(item => item.connectedSystemId === opportunity.connectedSystemId && item.contactExternalId === opportunity.contactExternalId);
    const staleDays = ageDays(opportunity.lastActivityAt, now);
    const closePast = Boolean(opportunity.closeAt && opportunity.closeAt < now);
    const nextStepPast = Boolean(opportunity.nextStepAt && opportunity.nextStepAt < now);
    const reasons = [
      comms?.waitingOnUs ? "Customer communication is waiting for a response" : null,
      overdueTasks.length ? `${overdueTasks.length} CRM task${overdueTasks.length === 1 ? " is" : "s are"} overdue` : null,
      nextStepPast ? "Recorded next step is overdue" : null,
      !opportunity.nextStepAt ? "No next step is recorded" : null,
      staleDays === null ? "No last-activity timestamp is recorded" : staleDays >= STALE_OPPORTUNITY_DAYS ? `No recorded opportunity activity for ${staleDays} days` : null,
      closePast ? "Expected close date has passed while the opportunity remains open" : null,
    ].filter((reason): reason is string => Boolean(reason));
    const leakageScore =
      (comms?.waitingOnUs ? 35 : 0) +
      Math.min(30, overdueTasks.length * 12) +
      (nextStepPast ? 20 : 0) +
      (!opportunity.nextStepAt ? 15 : 0) +
      (staleDays === null || staleDays >= STALE_OPPORTUNITY_DAYS ? 20 : 0) +
      (closePast ? 20 : 0);
    if (reasons.length) {
      leakage.push({
        type: "opportunity_revenue_risk",
        connectedSystemId: opportunity.connectedSystemId,
        contactExternalId: opportunity.contactExternalId,
        opportunityExternalId: opportunity.externalId,
        customer: contactLabel(contact),
        opportunity: opportunity.name,
        ownerExternalId: opportunity.ownerExternalId,
        valueMinor: opportunity.valueMinor ?? 0,
        currency: opportunity.currency ?? null,
        score: leakageScore,
        priority: priorityBand(leakageScore),
        reasons,
      });
    }
    const hygieneIssues = [
      !opportunity.stage ? "Opportunity has no stage" : null,
      !opportunity.nextStepAt ? "Opportunity has no next step" : null,
      staleDays === null ? "Opportunity has no last-activity timestamp" : staleDays >= STALE_OPPORTUNITY_DAYS ? `Opportunity is stale (${staleDays} days)` : null,
      closePast ? "Close date is in the past" : null,
      nextStepPast ? "Next-step date is in the past" : null,
      !opportunity.ownerExternalId ? "Opportunity has no CRM owner" : null,
    ].filter((issue): issue is string => Boolean(issue));
    if (hygieneIssues.length) hygiene.push({
      connectedSystemId: opportunity.connectedSystemId,
      opportunityExternalId: opportunity.externalId,
      contactExternalId: opportunity.contactExternalId,
      customer: contactLabel(contact),
      opportunity: opportunity.name,
      ownerExternalId: opportunity.ownerExternalId,
      issues: hygieneIssues,
    });
    let healthScore = 100;
    if (comms?.waitingOnUs) healthScore -= 25;
    healthScore -= Math.min(30, overdueTasks.length * 12);
    if (!opportunity.nextStepAt) healthScore -= 15;
    if (nextStepPast) healthScore -= 15;
    if (staleDays === null) healthScore -= 15;
    else if (staleDays >= STALE_OPPORTUNITY_DAYS) healthScore -= Math.min(35, 10 + staleDays);
    if (closePast) healthScore -= 15;
    healthScore = Math.max(0, healthScore);
    health.push({
      connectedSystemId: opportunity.connectedSystemId,
      opportunityExternalId: opportunity.externalId,
      contactExternalId: opportunity.contactExternalId,
      customer: contactLabel(contact),
      opportunity: opportunity.name,
      ownerExternalId: opportunity.ownerExternalId,
      score: healthScore,
      status: healthScore <= 40 ? "high_risk" : healthScore <= 70 ? "needs_attention" : "healthy",
      reasons,
    });
  }

  for (const comms of salesComms) {
    if (!comms.waitingOnUs) continue;
    const hours = ageHours(comms.latestInboundAt, now) ?? 0;
    if (hours < INBOUND_SLA_HOURS) continue;
    leakage.push({
      type: "unanswered_customer",
      connectedSystemId: comms.connectedSystemId,
      contactExternalId: comms.contactExternalId,
      customer: comms.customer,
      ownerExternalId: comms.ownerExternalId,
      valueMinor: 0,
      score: Math.min(90, 35 + hours),
      priority: hours >= 24 ? "critical" : "high",
      reasons: [`Customer communication has needed action for ${hours} hour${hours === 1 ? "" : "s"}`],
    });
  }

  leakage.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.valueMinor ?? 0) - Number(a.valueMinor ?? 0));
  health.sort((a, b) => Number(a.score ?? 0) - Number(b.score ?? 0));

  const attentionMap = new Map<string, {
    connectedSystemId: number;
    contactExternalId: string | null;
    opportunityExternalId: string | null;
    customer: string;
    ownerExternalId: string | null;
    score: number;
    reasons: string[];
    valueAtRiskMinor: number;
  }>();
  for (const item of leakage) {
    const connectedSystemId = Number(item.connectedSystemId);
    const contactExternalId = typeof item.contactExternalId === "string" ? item.contactExternalId : null;
    const opportunityExternalId = typeof item.opportunityExternalId === "string" ? item.opportunityExternalId : null;
    const key = `${connectedSystemId}:${opportunityExternalId || contactExternalId || String(item.customer)}`;
    const existing = attentionMap.get(key) ?? {
      connectedSystemId,
      contactExternalId,
      opportunityExternalId,
      customer: String(item.customer || "Unknown customer"),
      ownerExternalId: typeof item.ownerExternalId === "string" ? item.ownerExternalId : null,
      score: 0,
      reasons: [],
      valueAtRiskMinor: 0,
    };
    existing.score = Math.max(existing.score, Number(item.score ?? 0));
    existing.valueAtRiskMinor = Math.max(existing.valueAtRiskMinor, Number(item.valueMinor ?? 0));
    for (const reason of Array.isArray(item.reasons) ? item.reasons.map(String) : []) if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    attentionMap.set(key, existing);
  }
  const attention = Array.from(attentionMap.values())
    .map(item => ({ ...item, priority: priorityBand(item.score), recommendation: item.reasons[0] || "Review this customer record and confirm the next step." }))
    .sort((a, b) => b.score - a.score || b.valueAtRiskMinor - a.valueAtRiskMinor)
    .slice(0, 50);

  const people = new Map<string, {
    ownerExternalId: string;
    name: string;
    userId: number | null;
    overdueTasks: number;
    unansweredCustomers: number;
    staleOpportunities: number;
    noNextStep: number;
    pipelineAtRiskMinor: number;
    attentionItems: number;
  }>();
  for (const mapping of input.mappings.filter(mapping => mapping.isActive)) {
    people.set(recordKey(mapping.connectedSystemId, mapping.externalUserId), {
      ownerExternalId: mapping.externalUserId,
      name: mapping.displayName,
      userId: mapping.userId,
      overdueTasks: 0,
      unansweredCustomers: 0,
      staleOpportunities: 0,
      noNextStep: 0,
      pipelineAtRiskMinor: 0,
      attentionItems: 0,
    });
  }
  const ownerBucket = (connectedSystemId: number, ownerExternalId?: string | null) => ownerExternalId ? people.get(recordKey(connectedSystemId, ownerExternalId)) : undefined;
  for (const task of input.tasks) if (openStatus(task.status) && task.dueAt && task.dueAt < now) {
    const owner = ownerBucket(task.connectedSystemId, task.ownerExternalId);
    if (owner) owner.overdueTasks += 1;
  }
  for (const opportunity of input.opportunities) if (!closedOpportunity(opportunity, stageByKey)) {
    const owner = ownerBucket(opportunity.connectedSystemId, opportunity.ownerExternalId);
    if (!owner) continue;
    const staleDays = ageDays(opportunity.lastActivityAt, now);
    if (staleDays === null || staleDays >= STALE_OPPORTUNITY_DAYS) {
      owner.staleOpportunities += 1;
      owner.pipelineAtRiskMinor += opportunity.valueMinor ?? 0;
    }
    if (!opportunity.nextStepAt) owner.noNextStep += 1;
  }
  for (const comms of salesComms.filter(item => item.waitingOnUs)) {
    const owner = ownerBucket(comms.connectedSystemId, comms.ownerExternalId);
    if (owner) owner.unansweredCustomers += 1;
  }
  for (const item of attention) {
    const owner = ownerBucket(item.connectedSystemId, item.ownerExternalId);
    if (owner) owner.attentionItems += 1;
  }
  const managerPeople = Array.from(people.values())
    .map(person => ({
      ...person,
      exceptionScore: person.overdueTasks * 12 + person.unansweredCustomers * 18 + person.staleOpportunities * 10 + person.noNextStep * 6,
    }))
    .sort((a, b) => b.exceptionScore - a.exceptionScore || b.pipelineAtRiskMinor - a.pipelineAtRiskMinor);

  return {
    generatedAt: now,
    salesComms: salesComms.sort((a, b) => Number(b.waitingOnUs) - Number(a.waitingOnUs) || (b.latestActivityAt?.valueOf() ?? 0) - (a.latestActivityAt?.valueOf() ?? 0)),
    revenueLeakage: leakage.slice(0, 100),
    customerHealth: health.slice(0, 100),
    pipelineHygiene: hygiene.slice(0, 100),
    attention,
    managerWatchtower: {
      summary: {
        mappedSalespeople: managerPeople.length,
        peopleNeedingAttention: managerPeople.filter(person => person.exceptionScore > 0).length,
        overdueTasks: managerPeople.reduce((sum, person) => sum + person.overdueTasks, 0),
        unansweredCustomers: managerPeople.reduce((sum, person) => sum + person.unansweredCustomers, 0),
        staleOpportunities: managerPeople.reduce((sum, person) => sum + person.staleOpportunities, 0),
        noNextStep: managerPeople.reduce((sum, person) => sum + person.noNextStep, 0),
        pipelineAtRiskMinor: managerPeople.reduce((sum, person) => sum + person.pipelineAtRiskMinor, 0),
      },
      people: managerPeople.slice(0, 100),
    },
    evidenceSummary: {
      contacts: input.contacts.length,
      opportunities: input.opportunities.length,
      tasks: input.tasks.length,
      activities: input.activities.length,
      inboundMessages: input.inbound.length,
      ownerMappings: input.mappings.length,
    },
  };
}

async function extractPromises(input: {
  userId: number;
  organisationId: number;
  activities: ActivityRow[];
  inbound: InboundRow[];
  now: Date;
}) {
  const sources = [
    ...input.activities
      .filter(activity => activity.body?.trim())
      .map(activity => ({ sourceId: `activity:${activity.id}`, occurredAt: activity.occurredAt, text: activity.body!.trim().slice(0, 1200) })),
    ...input.inbound
      .filter(message => message.body.trim())
      .map(message => ({ sourceId: `inbound:${message.id}`, occurredAt: message.receivedAt, text: message.body.trim().slice(0, 1200) })),
  ]
    .sort((a, b) => b.occurredAt.valueOf() - a.occurredAt.valueOf())
    .slice(0, 60);
  if (!sources.length) return { status: "no_evidence" as const, promises: [] as PromiseSignal[] };
  const sourceIds = new Set(sources.map(source => source.sourceId));
  try {
    const response = await runGenxAgent({
      agentKey: "promise_tracker",
      modelTier: "fast",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "sales_promise_tracker",
        reference: `promise-tracker:${input.now.toISOString().slice(0, 13)}`,
      },
      maxContextChars: 30_000,
      maxOutputTokens: 1_800,
      workingContext: `Current time: ${input.now.toISOString()}. Every source identifier below is authoritative. Do not create any source identifier not supplied.`,
      messages: [{
        role: "user",
        content: `Extract only explicit commitments or promises made by the sales team or customer from these CRM communication records. Do not infer a promise from ordinary discussion. Return ONLY JSON in this exact shape: {"promises":[{"sourceId":"activity:1","actor":"team|customer|unknown","commitment":"short factual commitment","dueAt":"ISO timestamp or null","status":"open|fulfilled|cancelled|unknown"}]}. If no explicit promise exists return {"promises":[]}.

SOURCES:
${sources.map(source => `${source.sourceId} | ${source.occurredAt.toISOString()} | ${source.text}`).join("\n")}`,
      }],
    });
    if (response.provider !== "genx")
      return { status: "unavailable" as const, promises: [] as PromiseSignal[] };
    return { status: "complete" as const, promises: parsePromiseSignals(response.content, sourceIds, input.now) };
  } catch {
    return { status: "unavailable" as const, promises: [] as PromiseSignal[] };
  }
}

export async function getSalesWatchtower(input: {
  userId: number;
  organisationId: number;
  includePromises?: boolean;
}) : Promise<SalesWatchtower> {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const [contacts, opportunities, tasks, activities, inbound, mappings, stageMappings] = await Promise.all([
    db.select().from(crmContacts).where(eq(crmContacts.organisationId, input.organisationId)).limit(5000),
    db.select().from(crmOpportunities).where(eq(crmOpportunities.organisationId, input.organisationId)).limit(5000),
    db.select().from(crmTasks).where(eq(crmTasks.organisationId, input.organisationId)).limit(5000),
    db.select().from(crmActivities).where(eq(crmActivities.organisationId, input.organisationId)).orderBy(desc(crmActivities.occurredAt)).limit(10_000),
    db.select().from(inboundMessages).where(eq(inboundMessages.organisationId, input.organisationId)).orderBy(desc(inboundMessages.receivedAt)).limit(2000),
    db.select().from(externalUserMappings).where(eq(externalUserMappings.organisationId, input.organisationId)).limit(1000),
    db.select().from(crmPipelineStageMappings).where(eq(crmPipelineStageMappings.organisationId, input.organisationId)).limit(1000),
  ]);
  const teamView = canViewTeamData(membership.role);
  const ownOwnerKeys = new Set(
    mappings
      .filter(mapping => mapping.userId === input.userId && mapping.isActive)
      .map(mapping => recordKey(mapping.connectedSystemId, mapping.externalUserId))
  );
  const belongsToUser = (connectedSystemId: number, ownerExternalId?: string | null) => teamView || (ownerExternalId ? ownOwnerKeys.has(recordKey(connectedSystemId, ownerExternalId)) : false);
  const scopedContacts = teamView ? contacts : contacts.filter(contact => belongsToUser(contact.connectedSystemId, contact.ownerExternalId));
  const contactKeys = new Set(scopedContacts.map(contact => recordKey(contact.connectedSystemId, contact.externalId)));
  const scopedOpportunities = opportunities.filter(opportunity => belongsToUser(opportunity.connectedSystemId, opportunity.ownerExternalId) || contactKeys.has(recordKey(opportunity.connectedSystemId, opportunity.contactExternalId)));
  const scopedTasks = tasks.filter(task => belongsToUser(task.connectedSystemId, task.ownerExternalId) || contactKeys.has(recordKey(task.connectedSystemId, task.contactExternalId)));
  const scopedActivities = activities.filter(activity => belongsToUser(activity.connectedSystemId, activity.ownerExternalId) || contactKeys.has(recordKey(activity.connectedSystemId, activity.contactExternalId)));
  const scopedInbound = inbound.filter(message => Boolean(message.connectedSystemId && contactKeys.has(recordKey(message.connectedSystemId, message.contactExternalId))));
  const now = new Date();
  const base = buildSalesWatchtowerFromEvidence({
    contacts: scopedContacts,
    opportunities: scopedOpportunities,
    tasks: scopedTasks,
    activities: scopedActivities,
    inbound: scopedInbound,
    mappings: teamView ? mappings : mappings.filter(mapping => mapping.userId === input.userId),
    stageMappings,
    now,
  });
  const promiseResult = input.includePromises
    ? await extractPromises({ userId: input.userId, organisationId: input.organisationId, activities: scopedActivities, inbound: scopedInbound, now })
    : { status: "not_requested" as const, promises: [] as PromiseSignal[] };
  return { ...base, promises: promiseResult.promises, promiseAnalysis: promiseResult.status };
}
