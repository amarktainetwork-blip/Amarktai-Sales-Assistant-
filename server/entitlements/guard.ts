export type OrganisationEntitlement = {
  status: "active" | "trial" | "suspended" | "cancelled";
  featureFlags: Record<string, boolean>;
  limits: Record<string, number>;
};

export function assertEntitledFeature(entitlement: OrganisationEntitlement | null | undefined, feature: string, isPlatformOwner = false) {
  if (isPlatformOwner) return;
  if (!entitlement || !["active", "trial"].includes(entitlement.status)) throw new Error("ENTITLEMENT_INACTIVE");
  if (entitlement.featureFlags[feature] !== true) throw new Error("FEATURE_NOT_ENTITLED");
}

export function assertEntitlementLimit(entitlement: OrganisationEntitlement | null | undefined, limitKey: string, currentUsage: number, isPlatformOwner = false) {
  if (!Number.isFinite(currentUsage) || currentUsage < 0) throw new Error("INVALID_USAGE");
  if (isPlatformOwner) return;
  if (!entitlement || !["active", "trial"].includes(entitlement.status)) throw new Error("ENTITLEMENT_INACTIVE");
  const limit = entitlement.limits[limitKey];
  if (!Number.isFinite(limit) || limit < 0 || currentUsage >= limit) throw new Error("ENTITLEMENT_LIMIT_REACHED");
}
