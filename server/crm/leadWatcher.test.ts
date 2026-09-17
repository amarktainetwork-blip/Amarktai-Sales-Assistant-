import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NEW_LEAD_POLL_INTERVAL_MS,
  leadWatchFailureIsDeferral,
  newLeadPollIntervalMs,
  startNewLeadWatcher,
} from "./leadWatcher";
import { deriveCrmWorkCandidates } from "../salesWork";

const contact = {
  externalId: "lead-1",
  ownerExternalId: "owner-amelia",
  firstName: "New",
  lastName: "Lead",
  raw: {},
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("new lead watcher", () => {
  it("never polls more frequently than every 60 seconds", () => {
    expect(newLeadPollIntervalMs("1000")).toBe(DEFAULT_NEW_LEAD_POLL_INTERVAL_MS);
    expect(newLeadPollIntervalMs("60000")).toBe(60_000);
    expect(newLeadPollIntervalMs("90000")).toBe(90_000);
  });
  it("does not convert baseline contacts into new leads", () => {
    const candidates = deriveCrmWorkCandidates(
      8,
      { type: "contacts", records: [contact] },
      new Date("2026-09-17T09:00:00Z"),
      { baselineComplete: false, existingExternalIds: new Set() }
    );
    expect(candidates).toEqual([]);
  });

  it("creates a stable NEW_LEAD candidate only for an unseen post-baseline id", () => {
    const first = deriveCrmWorkCandidates(
      8,
      { type: "contacts", records: [contact] },
      new Date("2026-09-17T09:00:00Z"),
      { baselineComplete: true, existingExternalIds: new Set() }
    );
    const duplicatePoll = deriveCrmWorkCandidates(
      8,
      { type: "contacts", records: [contact] },
      new Date("2026-09-17T09:01:00Z"),
      { baselineComplete: true, existingExternalIds: new Set(["lead-1"]) }
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "NEW_LEAD",
      sourceKey: "crm:8:contact:lead-1:new-lead",
    });
    expect(duplicatePoll).toEqual([]);
  });
  it("defers browser contention instead of treating it as CRM degradation", () => {
    expect(
      leadWatchFailureIsDeferral(new Error("CRM_VIEWER_AGENT_CONTROL_ACTIVE"))
    ).toBe(true);
    expect(leadWatchFailureIsDeferral(new Error("browser lease busy"))).toBe(true);
    expect(leadWatchFailureIsDeferral(new Error("invalid mapping"))).toBe(false);
  });

  it("skips an overlapping poll while the previous one is still running", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let release!: () => void;
    const runCycle = vi.fn(
      () => new Promise<void>(resolve => (release = resolve))
    );
    const watcher = startNewLeadWatcher(60_000, runCycle);
    expect(runCycle).toHaveBeenCalledTimes(1);
    await expect(watcher.run()).resolves.toBe(false);
    expect(runCycle).toHaveBeenCalledTimes(1);
    release();
    await vi.runAllTicks();
    await Promise.resolve();
    clearInterval(watcher.timer);
  });
});
