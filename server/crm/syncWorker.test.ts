import { describe, expect, it } from "vitest";
import {
  CRM_SYNC_POLL_INTERVAL_MS,
  DEFAULT_CRM_SYNC_INTERVAL_MS,
  crmSyncIntervalMs,
  crmSyncJobIsDue,
  crmBackgroundSyncMode,
} from "./syncWorker";

describe("connection-scoped CRM synchronization schedule", () => {
  it("defaults to 120 seconds and rejects unsafe/invalid overrides", () => {
    expect(DEFAULT_CRM_SYNC_INTERVAL_MS).toBe(120_000);
    expect(CRM_SYNC_POLL_INTERVAL_MS).toBe(30_000);
    expect(crmSyncIntervalMs(undefined)).toBe(120_000);
    expect(crmSyncIntervalMs("180000")).toBe(180_000);
    expect(crmSyncIntervalMs("1000")).toBe(120_000);
    expect(crmSyncIntervalMs("not-a-number")).toBe(120_000);
  });

  it("uses bounded routine reconciliation for browser CRMs only", () => {
    expect(crmBackgroundSyncMode("browser")).toBe("routine");
    expect(crmBackgroundSyncMode("sidecar")).toBe("routine");
    expect(crmBackgroundSyncMode("oauth")).toBe("full");
    expect(crmBackgroundSyncMode("api_key")).toBe("full");
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

it("waits an interval after a long successful drain rather than starting another immediately", () => {
  const now = new Date("2026-09-17T09:20:00Z");
  expect(
    crmSyncJobIsDue(
      new Date("2026-09-17T09:00:00Z"),
      now,
      120000,
      new Date("2026-09-17T09:19:50Z")
    )
  ).toBe(false);
  expect(
    crmSyncJobIsDue(
      new Date("2026-09-17T09:00:00Z"),
      now,
      120000,
      new Date("2026-09-17T09:18:00Z")
    )
  ).toBe(true);
});
