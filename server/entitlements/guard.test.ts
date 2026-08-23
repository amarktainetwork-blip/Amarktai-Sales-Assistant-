import { describe, expect, it } from "vitest";
import { assertEntitledFeature, assertEntitlementLimit } from "./guard";

describe("organisation entitlement guard", () => {
  const entitlement = { status: "active" as const, featureFlags: { advanced_automation: true }, limits: { connected_systems: 2 } };
  it("allows only active feature flags and usage below configured limits", () => {
    expect(() => assertEntitledFeature(entitlement, "advanced_automation")).not.toThrow();
    expect(() => assertEntitlementLimit(entitlement, "connected_systems", 1)).not.toThrow();
  });
  it("fails closed for disabled, inactive, or exhausted entitlements", () => {
    expect(() => assertEntitledFeature(entitlement, "tts")).toThrow("FEATURE_NOT_ENTITLED");
    expect(() => assertEntitledFeature({ ...entitlement, status: "suspended" }, "advanced_automation")).toThrow("ENTITLEMENT_INACTIVE");
    expect(() => assertEntitlementLimit(entitlement, "connected_systems", 2)).toThrow("ENTITLEMENT_LIMIT_REACHED");
  });
  it("allows an explicitly identified platform owner without changing normal users", () => {
    expect(() => assertEntitledFeature(null, "tts", true)).not.toThrow();
    expect(() => assertEntitlementLimit(null, "connected_systems", 100, true)).not.toThrow();
  });
});
