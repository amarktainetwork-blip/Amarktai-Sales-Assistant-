import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PERSONAL_MAILBOX_SYNC_TIMEOUT_MS,
  armPersonalMailboxSyncWatchdog,
  personalMailboxSyncTimeoutMs,
} from "./mailboxWorker";

afterEach(() => {
  vi.useRealTimers();
});

describe("personal mailbox worker watchdog", () => {
  it("uses a bounded default and rejects unsafe short overrides", () => {
    expect(personalMailboxSyncTimeoutMs(undefined)).toBe(
      DEFAULT_PERSONAL_MAILBOX_SYNC_TIMEOUT_MS
    );
    expect(personalMailboxSyncTimeoutMs("59999")).toBe(
      DEFAULT_PERSONAL_MAILBOX_SYNC_TIMEOUT_MS
    );
    expect(personalMailboxSyncTimeoutMs("120000")).toBe(120_000);
  });

  it("fires once when a mailbox cycle exceeds the deadline", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    armPersonalMailboxSyncWatchdog({ timeoutMs: 60_000, onTimeout });
    vi.advanceTimersByTime(59_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("can be cleared after a healthy mailbox cycle", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const clear = armPersonalMailboxSyncWatchdog({
      timeoutMs: 60_000,
      onTimeout,
    });
    clear();
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
