export const autonomyPermissions = [
  "email_replies",
  "new_emails",
  "sms",
  "whatsapp",
  "crm_notes",
  "tasks_callbacks",
  "contact_updates",
  "opportunity_updates",
  "calendar_invites",
  "sequences_followups",
] as const;

export type AutonomyPermission = (typeof autonomyPermissions)[number];
export type AutonomyMode = "review_everything" | "custom" | "full";

export type AutonomySettings = {
  mode: AutonomyMode;
  permissions: Record<AutonomyPermission, boolean>;
};

export const reviewEverythingAutonomy = (): AutonomySettings => ({
  mode: "review_everything",
  permissions: Object.fromEntries(
    autonomyPermissions.map(permission => [permission, false])
  ) as Record<AutonomyPermission, boolean>,
});

const modeRank: Record<AutonomyMode, number> = {
  review_everything: 0,
  custom: 1,
  full: 2,
};

export function normalizeAutonomySettings(value: unknown): AutonomySettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return reviewEverythingAutonomy();
  const row = value as Record<string, unknown>;
  const mode: AutonomyMode = ["review_everything", "custom", "full"].includes(
    String(row.mode)
  )
    ? (row.mode as AutonomyMode)
    : "review_everything";
  const requested =
    row.permissions &&
    typeof row.permissions === "object" &&
    !Array.isArray(row.permissions)
      ? (row.permissions as Record<string, unknown>)
      : {};
  return {
    mode,
    permissions: Object.fromEntries(
      autonomyPermissions.map(permission => [
        permission,
        requested[permission] === true,
      ])
    ) as Record<AutonomyPermission, boolean>,
  };
}

/** The organisation policy is always a ceiling, never a default grant. */
export function applyOrganisationAutonomyCeiling(
  user: AutonomySettings,
  ceiling?: AutonomySettings
): AutonomySettings {
  if (!ceiling) return user;
  const mode =
    modeRank[user.mode] <= modeRank[ceiling.mode] ? user.mode : ceiling.mode;
  return {
    mode,
    permissions: Object.fromEntries(
      autonomyPermissions.map(permission => [
        permission,
        (user.mode === "full" || user.permissions[permission]) &&
          (ceiling.mode === "full" || ceiling.permissions[permission]),
      ])
    ) as Record<AutonomyPermission, boolean>,
  };
}

export function autonomyDecision(input: {
  user: AutonomySettings;
  organisationCeiling?: AutonomySettings;
  permission: AutonomyPermission;
  optedOut?: boolean;
  recipientVerified?: boolean;
  capabilityVerified?: boolean;
  organisationAllowsAction?: boolean;
}) {
  if (input.optedOut)
    return {
      allowed: false,
      reviewRequired: false,
      reason: "recipient_opted_out" as const,
    };
  if (input.organisationAllowsAction === false)
    return {
      allowed: false,
      reviewRequired: false,
      reason: "organisation_blocked" as const,
    };
  if (input.recipientVerified === false)
    return {
      allowed: false,
      reviewRequired: true,
      reason: "recipient_unverified" as const,
    };
  if (input.capabilityVerified === false)
    return {
      allowed: false,
      reviewRequired: true,
      reason: "capability_unverified" as const,
    };

  const effective = applyOrganisationAutonomyCeiling(
    input.user,
    input.organisationCeiling
  );
  const mayProceedWithoutReview =
    effective.mode === "full" ||
    (effective.mode === "custom" && effective.permissions[input.permission]);
  return {
    allowed: true,
    reviewRequired: !mayProceedWithoutReview,
    reason: mayProceedWithoutReview
      ? ("authorised" as const)
      : ("review_required" as const),
  };
}
