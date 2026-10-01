import { describe, expect, it } from "vitest";
import { completedOpportunitySnapshotIsCurrent as current } from "./salesTrackerSourceFreshness";
const now = new Date("2026-10-01T18:06:00Z");
const maximumAgeMs = 3 * 60_000;
const source = (overrides: Partial<Parameters<typeof current>[0]> = {}) => ({
  sourceStatus: "ready",
  lastSuccessfulAt: new Date("2026-10-01T18:05:00Z"),
  now,
  maximumAgeMs,
  ...overrides,
});
describe("Sales Tracker source-completion truth", () => {
  it("accepts a recent completed source snapshot", () =>
    expect(current(source())).toBe(true));
  it("rejects a historical completion even while Genie remains connected", () =>
    expect(current(source({ lastSuccessfulAt: new Date("2026-10-01T17:35:53Z") }))).toBe(false));
  it("rejects absent evidence, reported errors and authentication expiry", () => {
    expect(current(source({ lastSuccessfulAt: null }))).toBe(false);
    expect(current(source({ lastError: "read failed" }))).toBe(false);
    expect(current(source({ sourceStatus: "authentication_expired" }))).toBe(false);
  });
  it("includes the age boundary but rejects future timestamps", () => {
    expect(current(source({ lastSuccessfulAt: new Date(now.getTime() - maximumAgeMs) }))).toBe(true);
    expect(current(source({ lastSuccessfulAt: new Date(now.getTime() - maximumAgeMs - 1) }))).toBe(false);
    expect(current(source({ lastSuccessfulAt: new Date(now.getTime() + 1000) }))).toBe(false);
  });
  it("never accepts an invalid freshness policy", () =>
    expect(current(source({ maximumAgeMs: 0 }))).toBe(false));
});
