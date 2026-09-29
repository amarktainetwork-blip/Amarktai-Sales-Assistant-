import { afterEach, describe, expect, it } from "vitest";
import {
  resetBackgroundBrowserReadLaneForTests,
  runBackgroundBrowserReadLane,
} from "./backgroundReadLane";

afterEach(() => resetBackgroundBrowserReadLaneForTests());

describe("background browser read coordinator", () => {
  it("allows different unattended read cycles to progress without whole-cycle head-of-line blocking", async () => {
    const events: string[] = [];
    let releaseCrm!: () => void;
    let markCrmStarted!: () => void;
    const crmGate = new Promise<void>(resolve => {
      releaseCrm = resolve;
    });
    const crmStarted = new Promise<void>(resolve => {
      markCrmStarted = resolve;
    });

    const crm = runBackgroundBrowserReadLane("crm", async () => {
      events.push("crm:start");
      markCrmStarted();
      await crmGate;
      events.push("crm:end");
      return "crm";
    });
    await crmStarted;

    const mailbox = runBackgroundBrowserReadLane("mailbox", async () => {
      events.push("mailbox:start");
      events.push("mailbox:end");
      return "mailbox";
    });

    await expect(mailbox).resolves.toBe("mailbox");
    expect(events).toEqual(["crm:start", "mailbox:start", "mailbox:end"]);

    releaseCrm();
    await expect(crm).resolves.toBe("crm");
    expect(events).toEqual([
      "crm:start",
      "mailbox:start",
      "mailbox:end",
      "crm:end",
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

  it("clears a failed label so the next cycle can run", async () => {
    await expect(
      runBackgroundBrowserReadLane("broken", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await expect(
      runBackgroundBrowserReadLane("broken", async () => "ok")
    ).resolves.toBe("ok");
  });
});
