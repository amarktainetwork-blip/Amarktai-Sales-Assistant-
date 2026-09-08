import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireAiBrowserControl,
  acquireHumanBrowserControl,
  browserControlState,
  BROWSER_CONTROL_SHARED_LEASE_MIN_MS,
  releaseBrowserControl,
  resetBrowserControlArbitrationForTests,
  subscribeBrowserControl,
} from "./browserControlArbitration";

const scope = { organisationId: 11, connectedSystemId: 22, userId: 33 };

afterEach(() => {
  resetBrowserControlArbitrationForTests();
  vi.useRealTimers();
});

describe("shared browser control arbitration", () => {
  it("blocks a fresh process-local arbiter through the shared filesystem lease", async () => {
    acquireHumanBrowserControl(scope, 8_000);
    vi.resetModules();
    const isolated = await import("./browserControlArbitration");
    isolated.releaseBrowserControl(scope);
    expect(browserControlState(scope)).toBe("HUMAN_CONTROL");
    expect(() => isolated.acquireAiBrowserControl(scope, 8_000)).toThrow(
      "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
    );
  });

  it("recovers an old record-less claim left by a crashed process", async () => {
    const root = await mkdtemp(join(tmpdir(), "amarktai-lease-recovery-"));
    const previous = process.env.CRM_BROWSER_CONTROL_LEASE_DIR;
    process.env.CRM_BROWSER_CONTROL_LEASE_DIR = root;
    vi.resetModules();
    try {
      const isolated = await import("./browserControlArbitration");
      const orphan = join(root, "11", "22", "33");
      await mkdir(orphan, { recursive: true });
      const stale = new Date(
        Date.now() - isolated.BROWSER_CONTROL_SHARED_LEASE_MIN_MS - 1
      );
      await utimes(orphan, stale, stale);
      expect(isolated.acquireAiBrowserControl(scope, 8_000).control).toBe(
        "AGENT_CONTROL"
      );
      isolated.releaseBrowserControl(scope);
    } finally {
      if (previous === undefined)
        delete process.env.CRM_BROWSER_CONTROL_LEASE_DIR;
      else process.env.CRM_BROWSER_CONTROL_LEASE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks agent browser automation while a human lease is active", () => {
    acquireHumanBrowserControl(scope, 8_000);
    expect(() => acquireAiBrowserControl(scope, 8_000)).toThrow(
      "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
    );
  });

  it("blocks human control while an agent lease is active", () => {
    acquireAiBrowserControl(scope, 8_000);
    expect(() => acquireHumanBrowserControl(scope, 8_000)).toThrow(
      "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    );
  });

  it("rejects synthetic or unowned browser identities", () => {
    expect(() =>
      acquireAiBrowserControl({ ...scope, userId: 0 }, 8_000)
    ).toThrow("CRM_BROWSER_CONTROL_SCOPE_INVALID");
  });

  it("keeps an acquired lease alive while the owner heartbeat is running", () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const unsubscribe = subscribeBrowserControl(scope, state =>
      states.push(state)
    );
    acquireHumanBrowserControl(scope, 50);
    vi.advanceTimersByTime(BROWSER_CONTROL_SHARED_LEASE_MIN_MS + 1);
    expect(browserControlState(scope)).toBe("HUMAN_CONTROL");
    expect(states).toContain("HUMAN_CONTROL");
    unsubscribe();
  });

  it("releases an agent lease after completion", () => {
    acquireAiBrowserControl(scope, 8_000);
    releaseBrowserControl(scope);
    expect(browserControlState(scope)).toBe("IDLE");
  });
});
