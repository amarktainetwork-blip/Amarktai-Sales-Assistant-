import { and, eq } from "drizzle-orm";
import { organisationMembers, organisations, users } from "../drizzle/schema";
import { getDb } from "./db";
import { canManageOrganisation, hasOrganisationAccess, type OrganisationRole } from "./organisationAccess";

export { canManageOrganisation, canViewTeamData } from "./organisationAccess";
export type { OrganisationRole } from "./organisationAccess";

export async function canManageOrganisationForUser(userId: number, role: OrganisationRole) {
  if (canManageOrganisation(role)) return true;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const actor = (await db.select({ isPlatformOwner: users.isPlatformOwner }).from(users).where(eq(users.id, userId)).limit(1))[0];
  return actor?.isPlatformOwner === true;
}

export type OrganisationMembership = {
  organisationId: number;
  userId: number;
  role: OrganisationRole;
  organisationName: string;
  timezone: string;
  locale: string;
  currency: string;
  settings: Record<string, unknown>;
};

const membershipSelection = {
  organisationId: organisationMembers.organisationId,
  userId: organisationMembers.userId,
  role: organisationMembers.role,
  organisationName: organisations.name,
  timezone: organisations.timezone,
  locale: organisations.locale,
  currency: organisations.currency,
  settings: organisations.settings,
};

function defaultSlug(userId: number) {
  return `workspace-${userId}`;
}

export async function listOrganisationMemberships(userId: number): Promise<OrganisationMembership[]> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db
    .select(membershipSelection)
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
    .where(and(eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true)))
    .orderBy(organisations.name, organisations.id);
}

/**
 * Bootstrap-only resolver. It may create a private organisation for a user who
 * has no membership; it never chooses among multiple active memberships.
 */
export function selectActiveMembership(memberships: OrganisationMembership[], activeOrganisationId: number | null | undefined): OrganisationMembership | null {
  if (activeOrganisationId && Number.isInteger(activeOrganisationId) && activeOrganisationId > 0) {
    const selected = memberships.find(membership => membership.organisationId === activeOrganisationId);
    if (!selected) throw new Error("ACTIVE_ORGANISATION_ACCESS_DENIED");
    return selected;
  }
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0];
  throw new Error("ACTIVE_ORGANISATION_REQUIRED");
}

export async function ensureDefaultOrganisation(userId: number): Promise<OrganisationMembership> {
  const existingMemberships = await listOrganisationMemberships(userId);
  if (existingMemberships.length === 1) return existingMemberships[0];
  if (existingMemberships.length > 1) throw new Error("ACTIVE_ORGANISATION_REQUIRED");

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
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
  return { organisationId, userId, role: "owner", organisationName: "My sales workspace", timezone: "UTC", locale: "en", currency: "USD", settings: {} };
}

export async function updateOnboardingState(input: {
  userId: number;
  membership: OrganisationMembership;
  workspaceMode?: "individual" | "team";
  step?: number;
  complete?: boolean;
}) {
  if (!canManageOrganisation(input.membership.role)) throw new Error("Your organisation role does not permit setup changes.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (await db.select({ settings: organisations.settings }).from(organisations).where(eq(organisations.id, input.membership.organisationId)).limit(1))[0];
  const current = row?.settings ?? {};
  const onboarding = current.onboarding && typeof current.onboarding === "object" && !Array.isArray(current.onboarding)
    ? current.onboarding as Record<string, unknown>
    : {};
  const settings = {
    ...current,
    workspaceMode: input.workspaceMode ?? current.workspaceMode,
    onboarding: {
      ...onboarding,
      step: input.step ?? onboarding.step ?? 1,
      complete: input.complete ?? onboarding.complete ?? false,
      updatedAt: new Date().toISOString(),
      ...(input.complete ? { completedAt: new Date().toISOString() } : {}),
    },
  };
  await db.update(organisations).set({ settings }).where(eq(organisations.id, input.membership.organisationId));
  return { workspaceMode: settings.workspaceMode, onboarding: settings.onboarding };
}

export async function requireOrganisationMembership(userId: number, organisationId: number, allowedRoles?: OrganisationRole[]): Promise<OrganisationMembership> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db
    .select(membershipSelection)
    .from(organisationMembers)
    .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
    .where(and(eq(organisationMembers.organisationId, organisationId), eq(organisationMembers.userId, userId), eq(organisationMembers.isActive, true)))
    .limit(1);
  const membership = result[0];
  if (!hasOrganisationAccess(membership ? { organisationId: membership.organisationId, userId: membership.userId, role: membership.role, isActive: true } : null, organisationId, userId)) {
    throw new Error("You do not have access to this organisation.");
  }
  if (allowedRoles?.length && !allowedRoles.includes(membership.role)) throw new Error("Your organisation role does not permit this action.");
  return membership;
}

/** Resolve the signed organisation claim. Missing claims are only valid for a new, membership-free user. */
export async function resolveActiveOrganisation(userId: number, activeOrganisationId: number | null | undefined): Promise<OrganisationMembership> {
  const memberships = await listOrganisationMemberships(userId);
  const selected = selectActiveMembership(memberships, activeOrganisationId);
  return selected ?? ensureDefaultOrganisation(userId);
}
