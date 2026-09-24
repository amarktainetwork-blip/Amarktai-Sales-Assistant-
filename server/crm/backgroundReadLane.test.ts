import { afterEach, describe, expect, it } from "vitest";
import {
  resetBackgroundBrowserReadLaneForTests,
  runBackgroundBrowserReadLane,
} from "./backgroundReadLane";

afterEach(() => resetBackgroundBrowserReadLaneForTests());

describe("background browser read lane", () => {
  it("serializes overlapping unattended browser reads instead of making them contend", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve;
    });

    const first = runBackgroundBrowserReadLane("crm", async () => {
      events.push("crm:start");
      markFirstStarted();
      await firstGate;
      events.push("crm:end");
      return "crm";
    });
    const second = runBackgroundBrowserReadLane("mailbox", async () => {
      events.push("mailbox:start");
      events.push("mailbox:end");
      return "mailbox";
    });

    await firstStarted;
    expect(events).toEqual(["crm:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "crm",
      "mailbox",
    ]);
    expect(events).toEqual([
      "crm:start",
      "crm:end",
      "mailbox:start",
      "mailbox:end",
    ]);
  });

  it("coalesces duplicate cycles with the same label", async () => {
    let runs = 0;
    let release!: () => void;
    let markStarted!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });

    const first = runBackgroundBrowserReadLane("crm", async () => {
      runs += 1;
      markStarted();
      await gate;
      return "shared";
    });
    const duplicate = runBackgroundBrowserReadLane("crm", async () => {
      runs += 1;
      return "duplicate";
    });

    await started;
    expect(runs).toBe(1);
    release();
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      "shared",
      "shared",
    ]);
    expect(runs).toBe(1);
  });

  it("releases the lane after a failed cycle", async () => {
    await expect(
      runBackgroundBrowserReadLane("broken", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(
      runBackgroundBrowserReadLane("next", async () => "ok")
    ).resolves.toBe("ok");
  });
});
