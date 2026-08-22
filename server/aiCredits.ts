import { and, eq } from "drizzle-orm";
import { organisations, salesActivityEvents } from "../drizzle/schema";
import { PRICING_PLANS, type PlanKey } from "../shared/pricing";
import { getDb, recordAudit } from "./db";
import { canManageOrganisation, requireOrganisationMembership } from "./organisation";

export type CreditLedgerMetadata = {
  creditsDelta: number;
  transactionType: "allowance" | "purchase" | "usage" | "adjustment" | "refund";
  feature?: string;
  model?: string;
  providerUsage?: Record<string, unknown>;
  reference?: string;
  note?: string;
  period?: string;
};

function plan(value: unknown) {
  const key = typeof value === "string" ? value : "trial";
  return PRICING_PLANS.find(item => item.key === key) || PRICING_PLANS[0];
}
function periodKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(part => part.type === "year")?.value || date.getUTCFullYear()}-${parts.find(part => part.type === "month")?.value || String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function meta(event: typeof salesActivityEvents.$inferSelect): CreditLedgerMetadata | null {
  const value = event.metadata as Record<string, unknown>;
  const delta = Number(value.creditsDelta);
  if (!Number.isFinite(delta)) return null;
  return { ...value, creditsDelta: Math.trunc(delta), transactionType: String(value.transactionType || "adjustment") as CreditLedgerMetadata["transactionType"] };
}

async function ensureMonthlyAllowance(input: { organisationId: number; userId: number; timezone: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  const settings = (organisation.settings || {}) as Record<string, unknown>;
  const currentPeriod = periodKey(new Date(), input.timezone || organisation.timezone || "UTC");
  const selectedPlan = plan(settings.planKey);
  const allowanceMarker = settings.aiCreditAllowance as { period?: string; planKey?: string } | undefined;
  if (allowanceMarker?.period === currentPeriod && allowanceMarker.planKey === selectedPlan.key) return;
  const existing = await db.select().from(salesActivityEvents).where(and(eq(salesActivityEvents.organisationId, input.organisationId), eq(salesActivityEvents.source, "ai_credit"), eq(salesActivityEvents.eventType, "ai_credit_allowance"))).limit(5000);
  const alreadyGranted = existing.some(event => { const metadata = meta(event); return metadata?.period === currentPeriod && metadata.note === `plan:${selectedPlan.key}`; });
  if (!alreadyGranted && selectedPlan.includedAiCredits > 0) {
    await db.insert(salesActivityEvents).values({ organisationId: input.organisationId, salespersonUserId: input.userId, eventType: "ai_credit_allowance", source: "ai_credit", occurredAt: new Date(), metadata: { creditsDelta: selectedPlan.includedAiCredits, transactionType: "allowance", period: currentPeriod, note: `plan:${selectedPlan.key}` } satisfies CreditLedgerMetadata });
  }
  await db.update(organisations).set({ settings: { ...settings, planKey: selectedPlan.key, aiCreditAllowance: { period: currentPeriod, planKey: selectedPlan.key } } }).where(eq(organisations.id, input.organisationId));
}

async function ledger(organisationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db.select().from(salesActivityEvents).where(and(eq(salesActivityEvents.organisationId, organisationId), eq(salesActivityEvents.source, "ai_credit"))).limit(20_000);
}

export async function getAiCreditWallet(input: { userId: number; organisationId: number }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  await ensureMonthlyAllowance({ organisationId: input.organisationId, userId: input.userId, timezone: membership.timezone });
  const events = await ledger(input.organisationId);
  const entries = events.map(event => ({ event, metadata: meta(event) })).filter((item): item is { event: typeof events[number]; metadata: CreditLedgerMetadata } => Boolean(item.metadata));
  const balance = entries.reduce((sum, item) => sum + item.metadata.creditsDelta, 0);
  const used = entries.filter(item => item.metadata.creditsDelta < 0).reduce((sum, item) => sum + Math.abs(item.metadata.creditsDelta), 0);
  const purchased = entries.filter(item => item.metadata.transactionType === "purchase" && item.metadata.creditsDelta > 0).reduce((sum, item) => sum + item.metadata.creditsDelta, 0);
  const organisationDb = await getDb();
  const organisation = organisationDb ? (await organisationDb.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0] : undefined;
  const selectedPlan = plan((organisation?.settings as Record<string, unknown> | undefined)?.planKey);
  return { balance, used, purchased, plan: selectedPlan, entries: entries.sort((a, b) => Number(b.event.occurredAt) - Number(a.event.occurredAt)).slice(0, 200).map(item => ({ id: item.event.id, userId: item.event.salespersonUserId, occurredAt: item.event.occurredAt, ...item.metadata })) };
}

async function append(input: { actorUserId: number; organisationId: number; salespersonUserId?: number; metadata: CreditLedgerMetadata }) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  if (!Number.isInteger(input.metadata.creditsDelta) || input.metadata.creditsDelta === 0 || Math.abs(input.metadata.creditsDelta) > 10_000_000) throw new Error("AI credit transaction amount is invalid.");
  await db.insert(salesActivityEvents).values({ organisationId: input.organisationId, salespersonUserId: input.salespersonUserId ?? input.actorUserId, eventType: `ai_credit_${input.metadata.transactionType}`, source: "ai_credit", occurredAt: new Date(), metadata: input.metadata });
}

export async function consumeAiCredits(input: { userId: number; organisationId: number; credits: number; feature: string; model?: string; providerUsage?: Record<string, unknown>; reference?: string }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const credits = Math.max(0, Math.floor(input.credits));
  if (!credits) return getAiCreditWallet({ userId: input.userId, organisationId: input.organisationId });
  const wallet = await getAiCreditWallet({ userId: input.userId, organisationId: input.organisationId });
  if (wallet.balance < credits) throw new Error(`This organisation has ${wallet.balance} AI Credits remaining but this operation requires ${credits}. Add credits or change the AI budget.`);
  await append({ actorUserId: input.userId, organisationId: input.organisationId, metadata: { creditsDelta: -credits, transactionType: "usage", feature: input.feature.slice(0, 120), model: input.model?.slice(0, 160), providerUsage: input.providerUsage, reference: input.reference?.slice(0, 180) } });
  return getAiCreditWallet({ userId: input.userId, organisationId: input.organisationId });
}

export async function adjustAiCredits(input: { userId: number; organisationId: number; creditsDelta: number; transactionType: "purchase" | "adjustment" | "refund"; note?: string; reference?: string }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!canManageOrganisation(membership.role)) throw new Error("Only organisation owners and managers can adjust AI Credits.");
  const delta = Math.trunc(input.creditsDelta);
  if (!delta || Math.abs(delta) > 10_000_000) throw new Error("AI credit adjustment is invalid.");
  if ((input.transactionType === "purchase" || input.transactionType === "refund") && delta < 0) throw new Error(`${input.transactionType} transactions must add credits.`);
  await append({ actorUserId: input.userId, organisationId: input.organisationId, metadata: { creditsDelta: delta, transactionType: input.transactionType, note: input.note?.slice(0, 300), reference: input.reference?.slice(0, 180) } });
  await recordAudit({ userId: input.userId, eventType: "ai_credit_adjusted", entityType: "organisation", entityId: String(input.organisationId), summary: `AI Credit balance adjusted by ${delta}.`, metadata: { creditsDelta: delta, transactionType: input.transactionType, reference: input.reference } });
  return getAiCreditWallet({ userId: input.userId, organisationId: input.organisationId });
}

export async function setOrganisationPlan(input: { userId: number; organisationId: number; planKey: PlanKey }) {
  const membership = await requireOrganisationMembership(input.userId, input.organisationId);
  if (!canManageOrganisation(membership.role)) throw new Error("Only organisation owners and managers can change the plan assignment.");
  const selected = plan(input.planKey);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const organisation = (await db.select().from(organisations).where(eq(organisations.id, input.organisationId)).limit(1))[0];
  if (!organisation) throw new Error("Organisation was not found.");
  const settings = { ...(organisation.settings as Record<string, unknown>), planKey: selected.key, aiCreditAllowance: undefined };
  await db.update(organisations).set({ settings }).where(eq(organisations.id, input.organisationId));
  await recordAudit({ userId: input.userId, eventType: "plan_assignment_changed", entityType: "organisation", entityId: String(input.organisationId), summary: `Organisation plan assigned to ${selected.name}.`, metadata: { planKey: selected.key } });
  return getAiCreditWallet({ userId: input.userId, organisationId: input.organisationId });
}
