import { describe, expect, it } from "vitest";
import {
  DEFAULT_CRM_SYNC_INTERVAL_MS,
  crmSyncIntervalMs,
  crmSyncJobIsDue,
} from "./syncWorker";

describe("connection-scoped CRM synchronization schedule", () => {
  it("defaults to 120 seconds and rejects unsafe/invalid overrides", () => {
    expect(DEFAULT_CRM_SYNC_INTERVAL_MS).toBe(120_000);
    expect(crmSyncIntervalMs(undefined)).toBe(120_000);
    expect(crmSyncIntervalMs("180000")).toBe(180_000);
    expect(crmSyncIntervalMs("1000")).toBe(120_000);
    expect(crmSyncIntervalMs("not-a-number")).toBe(120_000);
  });

  it("is due after one interval and not due during repeated rapid refreshes", () => {
    const now = new Date("2026-08-31T12:02:00.000Z");
    expect(crmSyncJobIsDue(null, now)).toBe(true);
    expect(crmSyncJobIsDue(new Date("2026-08-31T12:00:00.000Z"), now)).toBe(
      true
    );
    expect(crmSyncJobIsDue(new Date("2026-08-31T12:01:59.000Z"), now)).toBe(
      false
    );
  });
});
