import { and, eq } from "drizzle-orm";
import {
  crmContacts,
  crmOpportunities,
  crmPipelineStageMappings,
  externalUserMappings,
} from "../drizzle/schema";
import { getDb } from "./db";
import { requireOrganisationMembership } from "./organisation";

function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function monthKey(date: Date, timezone: string) {
  return dayKey(date, timezone).slice(0, 7);
}
function startOfWeekKey(now: Date, timezone: string) {
  const today = dayKey(now, timezone);
  const noon = new Date(`${today}T12:00:00Z`);
  const weekday = noon.getUTCDay();
  noon.setUTCDate(noon.getUTCDate() - ((weekday + 6) % 7));
  return noon.toISOString().slice(0, 10);
}
function contactName(contact: typeof crmContacts.$inferSelect | undefined) {
  return (
    [contact?.firstName, contact?.lastName].filter(Boolean).join(" ").trim() ||
    "Customer"
  );
}

export function authoritativeOpportunityStatus(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = String((raw as Record<string, unknown>).status || "")
    .trim()
    .toLowerCase();
  return value && value !== "unknown" ? value : null;
}

export function opportunityCountsAsWon(input: {
  raw: unknown;
  closeAt: Date | null;
  mappedWonStage: boolean;
}) {
  const sourceStatus = authoritativeOpportunityStatus(input.raw);
  if (sourceStatus === "won") return Boolean(input.closeAt);
  if (sourceStatus) return false;
  return input.mappedWonStage;
}

export async function getSalesTracker(input: {
  userId: number;
  organisationId: number;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const [mappings, stageMappings, opportunities, contacts] = await Promise.all([
    db
      .select()
      .from(externalUserMappings)
      .where(
        and(
          eq(externalUserMappings.organisationId, input.organisationId),
          eq(externalUserMappings.userId, input.userId),
          eq(externalUserMappings.isActive, true)
        )
      ),
    db
      .select()
      .from(crmPipelineStageMappings)
      .where(
        and(
          eq(crmPipelineStageMappings.organisationId, input.organisationId),
          eq(crmPipelineStageMappings.isActive, true)
        )
      ),
    db
      .select()
      .from(crmOpportunities)
      .where(eq(crmOpportunities.organisationId, input.organisationId))
      .limit(10_000),
    db
      .select()
      .from(crmContacts)
      .where(eq(crmContacts.organisationId, input.organisationId))
      .limit(30_000),
  ]);
  const ownerIds = new Set(mappings.map(mapping => mapping.externalUserId));
  const wonStages = new Set(
    stageMappings
      .filter(mapping => mapping.category === "won")
      .flatMap(mapping => [
        `${mapping.connectedSystemId}:${mapping.externalStageId}`,
        `${mapping.connectedSystemId}:${mapping.stageLabel}`,
      ])
  );
  const contactsByKey = new Map(
    contacts.map(contact => [
      `${contact.connectedSystemId}:${contact.externalId}`,
      contact,
    ])
  );
  const timezone = membership.timezone || "UTC";
  const now = new Date();
  const today = dayKey(now, timezone);
  const weekStart = startOfWeekKey(now, timezone);
  const month = monthKey(now, timezone);
  const sales = opportunities
    .filter(
      opportunity =>
        opportunity.ownerExternalId && ownerIds.has(opportunity.ownerExternalId)
    )
    .filter(opportunity =>
      opportunityCountsAsWon({
        raw: opportunity.raw,
        closeAt: opportunity.closeAt,
        mappedWonStage: Boolean(
          opportunity.stage &&
            wonStages.has(
              `${opportunity.connectedSystemId}:${opportunity.stage}`
            )
        ),
      })
    )
    .map(opportunity => {
      const soldAt = opportunity.closeAt ?? opportunity.sourceUpdatedAt;
      const contact = opportunity.contactExternalId
        ? contactsByKey.get(
            `${opportunity.connectedSystemId}:${opportunity.contactExternalId}`
          )
        : undefined;
      return {
        externalId: opportunity.externalId,
        customer: contactName(contact),
        contactExternalId: opportunity.contactExternalId,
        product: opportunity.name,
        opportunity: opportunity.name,
        valueMinor: opportunity.valueMinor,
        currency: opportunity.currency || membership.currency,
        soldAt,
        sourceUpdatedAt: opportunity.sourceUpdatedAt,
      };
    })
    .filter(sale => sale.soldAt)
    .sort((a, b) => b.soldAt!.valueOf() - a.soldAt!.valueOf());
  const summarize = (items: typeof sales) => ({
    count: items.length,
    valueMinor: items.reduce((sum, item) => sum + (item.valueMinor || 0), 0),
  });
  const todaySales = sales.filter(
    sale => dayKey(sale.soldAt!, timezone) === today
  );
  const weekSales = sales.filter(
    sale => dayKey(sale.soldAt!, timezone) >= weekStart
  );
  const monthSales = sales.filter(
    sale => monthKey(sale.soldAt!, timezone) === month
  );
  return {
    generatedAt: now,
    timezone,
    currency: membership.currency,
    stageMappingRequired: wonStages.size === 0,
    summary: {
      today: summarize(todaySales),
      week: summarize(weekSales),
      month: summarize(monthSales),
      allTime: summarize(sales),
    },
    sales: sales.slice(0, 250),
  };
}
