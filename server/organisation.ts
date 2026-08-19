import { and, eq } from "drizzle-orm";
import { organisationMembers, organisations } from "../drizzle/schema";
import { getDb } from "./db";
import { hasOrganisationAccess, type OrganisationRole } from "./organisationAccess";
export { canManageOrganisation, canViewTeamData } from "./organisationAccess";
export type { OrganisationRole } from "./organisationAccess";
export type OrganisationMembership = { organisationId: number; userId: number; role: OrganisationRole; organisationName: string; timezone: string; locale: string; currency: string };

function defaultSlug(userId: number) {
  return `workspace-${userId}`;
}

/**
 * Preserves existing one-user pilot data by lazily provisioning a private
 * organisation when an existing user first reaches new tenant-aware features.
 */
export async function ensureDefaultOrganisation(userId: number): Promise<OrganisationMembership> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const membership = await db
    .select({ organisationId: organisationMembers.organisationId, userId: organisationMembers.userId, role: organisationMembers.role, organisationName: organisations.name, timezone: organisations.timezone, locale: organisations.locale, currency: organisations.currency })
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
    .where(and(eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true)))
    .limit(1);
  if (membership[0]) return membership[0];

  let organisationId: number | undefined;
  try {
    const inserted = await db.insert(organisations).values({ ownerUserId: userId, name: "My sales workspace", slug: defaultSlug(userId), settings: {} });
    organisationId = Number(inserted[0].insertId);
  } catch {
    const existing = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, defaultSlug(userId))).limit(1);
    organisationId = existing[0]?.id;
  }
  if (!organisationId) throw new Error("Unable to provision the organisation workspace.");
  await db.insert(organisationMembers).values({ organisationId, userId, role: "owner", isActive: true }).onDuplicateKeyUpdate({ set: { isActive: true, role: "owner" } });
  return { organisationId, userId, role: "owner", organisationName: "My sales workspace", timezone: "UTC", locale: "en", currency: "USD" };
}

export async function requireOrganisationMembership(userId: number, organisationId: number, allowedRoles?: OrganisationRole[]): Promise<OrganisationMembership> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db
    .select({ organisationId: organisationMembers.organisationId, userId: organisationMembers.userId, role: organisationMembers.role, organisationName: organisations.name, timezone: organisations.timezone, locale: organisations.locale, currency: organisations.currency })
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
    .where(and(eq(organisationMembers.organisationId, organisationId), eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true)))
    .limit(1);
  const membership = result[0];
  if (!hasOrganisationAccess(membership ? { organisationId: membership.organisationId, userId: membership.userId, role: membership.role, isActive: true } : null, organisationId, userId)) throw new Error("You do not have access to this organisation.");
  if (allowedRoles?.length && !allowedRoles.includes(membership.role)) throw new Error("Your organisation role does not permit this action.");
  return membership;
}

