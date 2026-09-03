import { and, eq } from "drizzle-orm";
import {
  companyProfiles,
  connectedSystems,
  organisationMembers,
  organisations,
  users,
} from "../drizzle/schema";
import { browserOperationReadinessForSystem } from "./browserConnectors/learnedOperations";
import { coreBrowserCommissioningReady } from "./crm/commissioningReadiness";
import { getDb } from "./db";
import {
  canManageOrganisation,
  hasOrganisationAccess,
  type OrganisationRole,
} from "./organisationAccess";

export { canManageOrganisation, canViewTeamData } from "./organisationAccess";
export type { OrganisationRole } from "./organisationAccess";

export type MemberOnboardingState = {
  step: number;
  complete: boolean;
  persona?:
    | "individual"
    | "company_owner"
    | "manager"
    | "salesperson"
    | "auditor";
  primaryGoal?: string;
  preferredName?: string;
  workingStyle?: string;
  crmIdentityConfirmed?: boolean;
  crmCredentialsSaved?: boolean;
  updatedAt?: string;
  completedAt?: string;
};

export async function canManageOrganisationForUser(
  userId: number,
  role: OrganisationRole
) {
  if (canManageOrganisation(role)) return true;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const actor = (
    await db
      .select({ isPlatformOwner: users.isPlatformOwner })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
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
  memberOnboarding: MemberOnboardingState;
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

function onboardingMap(settings: Record<string, unknown>) {
  return settings.memberOnboarding &&
    typeof settings.memberOnboarding === "object" &&
    !Array.isArray(settings.memberOnboarding)
    ? (settings.memberOnboarding as Record<string, unknown>)
    : {};
}

export function memberOnboardingFor(
  settings: Record<string, unknown>,
  userId: number
): MemberOnboardingState {
  const value = onboardingMap(settings)[String(userId)];
  const row =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    step:
      typeof row.step === "number" && Number.isInteger(row.step)
        ? Math.max(1, Math.min(6, row.step))
        : 1,
    complete: row.complete === true,
    ...(typeof row.persona === "string"
      ? { persona: row.persona as MemberOnboardingState["persona"] }
      : {}),
    ...(typeof row.primaryGoal === "string"
      ? { primaryGoal: row.primaryGoal }
      : {}),
    ...(typeof row.preferredName === "string"
      ? { preferredName: row.preferredName }
      : {}),
    ...(typeof row.workingStyle === "string"
      ? { workingStyle: row.workingStyle }
      : {}),
    ...(typeof row.crmIdentityConfirmed === "boolean"
      ? { crmIdentityConfirmed: row.crmIdentityConfirmed }
      : {}),
    ...(typeof row.crmCredentialsSaved === "boolean"
      ? { crmCredentialsSaved: row.crmCredentialsSaved }
      : {}),
    ...(typeof row.updatedAt === "string" ? { updatedAt: row.updatedAt } : {}),
    ...(typeof row.completedAt === "string"
      ? { completedAt: row.completedAt }
      : {}),
  };
}

function withMemberOnboarding<
  T extends Omit<OrganisationMembership, "memberOnboarding">,
>(membership: T): OrganisationMembership {
  return {
    ...membership,
    memberOnboarding: memberOnboardingFor(
      membership.settings,
      membership.userId
    ),
  };
}

export async function listOrganisationMemberships(
  userId: number
): Promise<OrganisationMembership[]> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db
    .select(membershipSelection)
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisationMembers.organisationId, organisations.id)
    )
    .where(
      and(
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.isActive, true)
      )
    )
    .orderBy(organisations.name, organisations.id);
  return rows.map(withMemberOnboarding);
}

/**
 * Bootstrap-only resolver. It may create a private organisation for a user who
 * has no membership; it never chooses among multiple active memberships.
 */
export function selectActiveMembership(
  memberships: OrganisationMembership[],
  activeOrganisationId: number | null | undefined
): OrganisationMembership | null {
  if (
    activeOrganisationId &&
    Number.isInteger(activeOrganisationId) &&
    activeOrganisationId > 0
  ) {
    const selected = memberships.find(
      membership => membership.organisationId === activeOrganisationId
    );
    if (!selected) throw new Error("ACTIVE_ORGANISATION_ACCESS_DENIED");
    return selected;
  }
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0];
  throw new Error("ACTIVE_ORGANISATION_REQUIRED");
}

export async function ensureDefaultOrganisation(
  userId: number
): Promise<OrganisationMembership> {
  const existingMemberships = await listOrganisationMemberships(userId);
  if (existingMemberships.length === 1) return existingMemberships[0];
  if (existingMemberships.length > 1)
    throw new Error("ACTIVE_ORGANISATION_REQUIRED");

  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  let organisationId: number | undefined;
  try {
    const inserted = await db.insert(organisations).values({
      ownerUserId: userId,
      name: "My sales workspace",
      slug: defaultSlug(userId),
      settings: {},
    });
    organisationId = Number(inserted[0].insertId);
  } catch {
    const existing = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, defaultSlug(userId)))
      .limit(1);
    organisationId = existing[0]?.id;
  }
  if (!organisationId)
    throw new Error("Unable to provision the organisation workspace.");
  await db
    .insert(organisationMembers)
    .values({ organisationId, userId, role: "owner", isActive: true })
    .onDuplicateKeyUpdate({ set: { isActive: true, role: "owner" } });
  return {
    organisationId,
    userId,
    role: "owner",
    organisationName: "My sales workspace",
    timezone: "UTC",
    locale: "en",
    currency: "USD",
    settings: {},
    memberOnboarding: { step: 1, complete: false },
  };
}

/** Company-level setup. Only owners/managers may change shared company state. */
export async function updateOnboardingState(input: {
  userId: number;
  membership: OrganisationMembership;
  workspaceMode?: "individual" | "team";
  step?: number;
  complete?: boolean;
}) {
  if (!canManageOrganisation(input.membership.role))
    throw new Error(
      "Your organisation role does not permit company setup changes."
    );
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  if (input.complete === true) {
    const organisationId = input.membership.organisationId;
    const [profiles, systems] = await Promise.all([
      db
        .select({ discoveryStatus: companyProfiles.discoveryStatus })
        .from(companyProfiles)
        .where(eq(companyProfiles.organisationId, organisationId)),
      db
        .select({
          id: connectedSystems.id,
          status: connectedSystems.status,
          connectionMethod: connectedSystems.connectionMethod,
        })
        .from(connectedSystems)
        .where(eq(connectedSystems.organisationId, organisationId)),
    ]);
    if (!profiles.some(profile => profile.discoveryStatus === "confirmed"))
      throw new Error("Confirm the company knowledge before completing setup.");

    const nativeReady = systems.some(
      system =>
        !["browser", "sidecar"].includes(system.connectionMethod) &&
        ["ready", "limited_permissions"].includes(system.status)
    );
    const browserCandidates = systems.filter(
      system =>
        ["browser", "sidecar"].includes(system.connectionMethod) &&
        ["ready", "limited_permissions"].includes(system.status)
    );
    const browserMatrices = await Promise.all(
      browserCandidates.map(system =>
        browserOperationReadinessForSystem({
          organisationId,
          connectedSystemId: system.id,
        })
      )
    );
    const browserReady = browserMatrices.some(matrix => {
      const statuses = new Map(
        matrix.operations.map(operation => [operation.key, operation.status])
      );
      return coreBrowserCommissioningReady(statuses);
    });

    if (!nativeReady && !browserReady)
      throw new Error(
        "Your CRM is connected, but its required sales operations are still being commissioned. Finish automatic commissioning or Teach Amarktai before completing setup."
      );
  }
  const row = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.membership.organisationId))
      .limit(1)
  )[0];
  const current = row?.settings ?? {};
  const onboarding =
    current.onboarding &&
    typeof current.onboarding === "object" &&
    !Array.isArray(current.onboarding)
      ? (current.onboarding as Record<string, unknown>)
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
  await db
    .update(organisations)
    .set({ settings })
    .where(eq(organisations.id, input.membership.organisationId));
  return {
    workspaceMode: settings.workspaceMode,
    onboarding: settings.onboarding,
  };
}

/** Per-member first-login onboarding. Every active member may update only their own state. */
export async function updateMemberOnboardingState(input: {
  userId: number;
  membership: OrganisationMembership;
  step?: number;
  complete?: boolean;
  persona?: MemberOnboardingState["persona"];
  primaryGoal?: string;
  preferredName?: string;
  workingStyle?: string;
  crmIdentityConfirmed?: boolean;
  crmCredentialsSaved?: boolean;
}) {
  if (input.membership.userId !== input.userId)
    throw new Error("Member onboarding may only be changed by that member.");
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.membership.organisationId))
      .limit(1)
  )[0];
  const current = row?.settings ?? {};
  const map = onboardingMap(current);
  const previous = memberOnboardingFor(current, input.userId);
  const next: MemberOnboardingState = {
    ...previous,
    step: input.step ?? previous.step,
    complete: input.complete ?? previous.complete,
    ...(input.persona ? { persona: input.persona } : {}),
    ...(input.primaryGoal !== undefined
      ? { primaryGoal: input.primaryGoal.trim().slice(0, 500) }
      : {}),
    ...(input.preferredName !== undefined
      ? { preferredName: input.preferredName.trim().slice(0, 80) }
      : {}),
    ...(input.workingStyle !== undefined
      ? { workingStyle: input.workingStyle.trim().slice(0, 500) }
      : {}),
    ...(input.crmIdentityConfirmed !== undefined
      ? { crmIdentityConfirmed: input.crmIdentityConfirmed }
      : {}),
    ...(input.crmCredentialsSaved !== undefined
      ? { crmCredentialsSaved: input.crmCredentialsSaved }
      : {}),
    updatedAt: new Date().toISOString(),
    ...(input.complete ? { completedAt: new Date().toISOString() } : {}),
  };
  const settings = {
    ...current,
    memberOnboarding: { ...map, [String(input.userId)]: next },
  };
  await db
    .update(organisations)
    .set({ settings })
    .where(eq(organisations.id, input.membership.organisationId));
  return next;
}

export async function requireOrganisationMembership(
  userId: number,
  organisationId: number,
  allowedRoles?: OrganisationRole[]
): Promise<OrganisationMembership> {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const result = await db
    .select(membershipSelection)
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisationMembers.organisationId, organisations.id)
    )
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.isActive, true)
      )
    )
    .limit(1);
  const raw = result[0];
  const membership = raw ? withMemberOnboarding(raw) : undefined;
  if (
    !hasOrganisationAccess(
      membership
        ? {
            organisationId: membership.organisationId,
            userId: membership.userId,
            role: membership.role,
            isActive: true,
          }
        : null,
      organisationId,
      userId
    )
  ) {
    throw new Error("You do not have access to this organisation.");
  }
  if (allowedRoles?.length && !allowedRoles.includes(membership!.role))
    throw new Error("Your organisation role does not permit this action.");
  return membership!;
}

/** Resolve the signed organisation claim. Missing claims are only valid for a new, membership-free user. */
export async function resolveActiveOrganisation(
  userId: number,
  activeOrganisationId: number | null | undefined
): Promise<OrganisationMembership> {
  const memberships = await listOrganisationMemberships(userId);
  const selected = selectActiveMembership(memberships, activeOrganisationId);
  return selected ?? ensureDefaultOrganisation(userId);
}
