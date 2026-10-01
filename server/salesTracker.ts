import { and, eq, inArray, or } from "drizzle-orm";
import {
  crmContacts,
  crmOpportunities,
  crmPipelineStageMappings,
  externalUserMappings,
  connectedSystems,
  crmSyncCursors,
} from "../drizzle/schema";
import { getDb } from "./db";
import { crmSyncIntervalMs } from "./crm/syncWorker";
import { completedOpportunitySnapshotIsCurrent } from "./salesTrackerSourceFreshness";
import { requireOrganisationMembership } from "./organisation";
import { uniqueOwnerMappingsBySystem } from "./customerData";

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
  const [mappings, stageMappings, mappedSystems, opportunityCursors] =
    await Promise.all([
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
      .select({
        id: connectedSystems.id,
        provider: connectedSystems.provider,
        status: connectedSystems.status,
        lastHealthCheckAt: connectedSystems.lastHealthCheckAt,
      })
      .from(connectedSystems)
      .innerJoin(
        externalUserMappings,
        eq(externalUserMappings.connectedSystemId, connectedSystems.id)
      )
      .where(
        and(
          eq(connectedSystems.organisationId, input.organisationId),
          eq(externalUserMappings.organisationId, input.organisationId),
          eq(externalUserMappings.userId, input.userId),
          eq(externalUserMappings.isActive, true)
        )
      ),
    db
      .select({
        connectedSystemId: crmSyncCursors.connectedSystemId,
        lastSuccessfulAt: crmSyncCursors.lastSuccessfulAt,
        lastError: crmSyncCursors.lastError,
      })
      .from(crmSyncCursors)
      .innerJoin(
        connectedSystems,
        eq(connectedSystems.id, crmSyncCursors.connectedSystemId)
      )
      .where(
        and(
          eq(connectedSystems.organisationId, input.organisationId),
          eq(crmSyncCursors.resourceType, "opportunities")
        )
      ),
  ]);
  const trustedMappings = uniqueOwnerMappingsBySystem(mappings);
  const trustedSystemIds = new Set(
    trustedMappings.map(mapping => mapping.connectedSystemId)
  );
  const sourceSystems = Array.from(
    new Map(
      mappedSystems
        .filter(system => trustedSystemIds.has(system.id))
        .map(system => [system.id, system])
    ).values()
  );
  const opportunityCursorBySystem = new Map(
    opportunityCursors.map(cursor => [cursor.connectedSystemId, cursor])
  );
  const now = new Date();
  const maximumSnapshotAgeMs = Math.max(3 * 60_000, crmSyncIntervalMs() + 2 * 60_000);
  const sourceCurrent =
    trustedMappings.length > 0 &&
    sourceSystems.length === trustedMappings.length &&
    sourceSystems.every(system => {
      const cursor = opportunityCursorBySystem.get(system.id);
      return completedOpportunitySnapshotIsCurrent({
        sourceStatus: system.status,
        lastSuccessfulAt: cursor?.lastSuccessfulAt,
        lastError: cursor?.lastError,
        now,
        maximumAgeMs: maximumSnapshotAgeMs,
      });
    });
  const reconnectRequired = sourceSystems.some(system =>
    ["authentication_expired", "needs_attention", "error"].includes(
      system.status
    )
  );
  const wonStages = new Set(
    stageMappings
      .filter(mapping => mapping.category === "won")
      .flatMap(mapping => [
        `${mapping.connectedSystemId}:${mapping.externalStageId}`,
        `${mapping.connectedSystemId}:${mapping.stageLabel}`,
      ])
  );
  const ownerPairs = trustedMappings.map(mapping =>
    and(
      eq(crmOpportunities.connectedSystemId, mapping.connectedSystemId),
      eq(crmOpportunities.ownerExternalId, mapping.externalUserId)
    )
  );
  const opportunities = ownerPairs.length
    ? await db
        .select()
        .from(crmOpportunities)
        .where(
          and(
            eq(crmOpportunities.organisationId, input.organisationId),
            or(...ownerPairs)
          )
        )
    : [];
  const wonOpportunities = opportunities.filter(opportunity =>
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
  );
  const wonContactExternalIds = Array.from(
    new Set(
      wonOpportunities
        .map(opportunity => opportunity.contactExternalId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const contacts = wonContactExternalIds.length
    ? await db
        .select()
        .from(crmContacts)
        .where(
          and(
            eq(crmContacts.organisationId, input.organisationId),
            inArray(crmContacts.externalId, wonContactExternalIds)
          )
        )
    : [];
  const contactsByKey = new Map(
    contacts.map(contact => [
      `${contact.connectedSystemId}:${contact.externalId}`,
      contact,
    ])
  );
  const timezone = membership.timezone || "UTC";
  const today = dayKey(now, timezone);
  const weekStart = startOfWeekKey(now, timezone);
  const month = monthKey(now, timezone);
  const sales = wonOpportunities.map(opportunity => {
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
    sourceCurrent,
    reconnectRequired,
    sourceSystems: sourceSystems.map(system => ({
      connectedSystemId: system.id,
      provider: system.provider,
      status: system.status,
      lastHealthCheckAt: system.lastHealthCheckAt,
      opportunityLastSuccessfulAt:
        opportunityCursorBySystem.get(system.id)?.lastSuccessfulAt || null,
      opportunityLastError:
        opportunityCursorBySystem.get(system.id)?.lastError || null,
    })),
    summary: {
      today: summarize(todaySales),
      week: summarize(weekSales),
      month: summarize(monthSales),
      allTime: summarize(sales),
    },
    sales: sales.slice(0, 250),
  };
}
