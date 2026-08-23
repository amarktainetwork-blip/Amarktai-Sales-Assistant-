import { describe, expect, it } from "vitest";
import { assertManagementElevation, managementElevationTtlMinutes } from "./managementElevation";

describe("sensitive management elevation", () => {
  it("denies a salesperson even if a token status is valid", () => {
    expect(() => assertManagementElevation({ role: "salesperson", isPlatformOwner: false, status: "valid" })).toThrow("MANAGER_REQUIRED");
  });

  it("denies a manager without elevation and allows one after re-verification", () => {
    expect(() => assertManagementElevation({ role: "manager", isPlatformOwner: false, status: "missing" })).toThrow("MANAGEMENT_ELEVATION_REQUIRED");
    expect(() => assertManagementElevation({ role: "manager", isPlatformOwner: false, status: "valid" })).not.toThrow();
  });

  it("denies expired elevation", () => {
    expect(() => assertManagementElevation({ role: "owner", isPlatformOwner: false, status: "expired" })).toThrow("MANAGEMENT_ELEVATION_EXPIRED");
  });

  it("requires platform owners to elevate too", () => {
    expect(() => assertManagementElevation({ role: "salesperson", isPlatformOwner: true, status: "missing" })).toThrow("MANAGEMENT_ELEVATION_REQUIRED");
    expect(() => assertManagementElevation({ role: "salesperson", isPlatformOwner: true, status: "valid" })).not.toThrow();
  });

  it("uses a bounded 45 minute default", () => {
    expect(managementElevationTtlMinutes(undefined)).toBe(45);
    expect(managementElevationTtlMinutes("999")).toBe(240);
  });
});
