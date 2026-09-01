import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import {
  applyOrganisationAutonomyCeiling,
  normalizeAutonomySettings,
  type AutonomySettings,
} from "../shared/autonomyPolicy";
import { getDb, recordAudit } from "./db";
import { requireOrganisationMembership } from "./organisation";

function autonomyMap(settings: Record<string, unknown>) {
  return settings.memberAutonomy &&
    typeof settings.memberAutonomy === "object" &&
    !Array.isArray(settings.memberAutonomy)
    ? (settings.memberAutonomy as Record<string, unknown>)
    : {};
}

export function autonomyForUser(
  settings: Record<string, unknown>,
  userId: number
) {
  const user = normalizeAutonomySettings(autonomyMap(settings)[String(userId)]);
  const organisationCeiling = settings.autonomyCeiling
    ? normalizeAutonomySettings(settings.autonomyCeiling)
    : undefined;
  return {
    user,
    organisationCeiling,
    effective: applyOrganisationAutonomyCeiling(user, organisationCeiling),
  };
}

async function currentSettings(organisationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1)
  )[0];
  if (!row) throw new Error("The organisation could not be found.");
  return { db, settings: row.settings ?? {} };
}

export async function getUserAutonomy(input: {
  userId: number;
  organisationId: number;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const { settings } = await currentSettings(input.organisationId);
  return autonomyForUser(settings, input.userId);
}

export async function updateUserAutonomy(input: {
  userId: number;
  organisationId: number;
  settings: AutonomySettings;
}) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const { db, settings } = await currentSettings(input.organisationId);
  const normalized = normalizeAutonomySettings(input.settings);
  const map = autonomyMap(settings);
  const nextSettings = {
    ...settings,
    memberAutonomy: {
      ...map,
      [String(input.userId)]: normalized,
    },
  };
  await db
    .update(organisations)
    .set({ settings: nextSettings })
    .where(eq(organisations.id, input.organisationId));
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "autonomy_preferences_updated",
    entityType: "user",
    entityId: String(input.userId),
    summary: "The salesperson updated their autonomy and approval preferences.",
    metadata: { mode: normalized.mode, permissions: normalized.permissions },
  });
  return autonomyForUser(nextSettings, input.userId);
}
