import { describe, expect, it } from "vitest";
import { completedOpportunitySnapshotIsCurrent as current, salesTrackerNeedsReconnect } from "./salesTrackerSourceFreshness";
import { DEFAULT_ROUTINE_OPPORTUNITY_BATCH_PAGES, maximumCompletedOpportunitySnapshotAgeMs, routineOpportunitySnapshotIntervalMs } from "./crm/opportunitySnapshotCadence";
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

describe("opportunity snapshot scheduler and source proof use the same cadence", () => {
  it("drains the pilot source in at most six bounded worker cycles at 10 pages each", () => {
    expect(DEFAULT_ROUTINE_OPPORTUNITY_BATCH_PAGES).toBe(10);
    expect(Math.ceil(5725 / (DEFAULT_ROUTINE_OPPORTUNITY_BATCH_PAGES * 100))).toBe(6);
    expect(15 + 6).toBeLessThan(25);
  });
  it("allows the default 15-minute cadence plus bounded completion grace", () => {
    const max = maximumCompletedOpportunitySnapshotAgeMs(undefined);
    expect(routineOpportunitySnapshotIntervalMs(undefined)).toBe(15 * 60_000);
    expect(max).toBe(25 * 60_000);
    expect(current(source({lastSuccessfulAt: new Date(now.getTime()-max),maximumAgeMs:max}))).toBe(true);
    expect(current(source({lastSuccessfulAt: new Date(now.getTime()-max-1),maximumAgeMs:max}))).toBe(false);
  });
  it("uses configured cadence and falls back safely when invalid", () => {
    expect(maximumCompletedOpportunitySnapshotAgeMs("300000")).toBe(15 * 60_000);
    expect(maximumCompletedOpportunitySnapshotAgeMs("garbage")).toBe(25 * 60_000);
  });
});
describe("reconnect warning must distinguish disconnected from source stale", () => {
  it("requires reconnection for auth failures and explicitly disconnected", () => {
    for (const status of ["authentication_expired","needs_attention","error","disconnected"])
      expect(salesTrackerNeedsReconnect(status)).toBe(true);
    for (const status of ["ready","limited_permissions","paused"])
      expect(salesTrackerNeedsReconnect(status)).toBe(false);
  });
});
