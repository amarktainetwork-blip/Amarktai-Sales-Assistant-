import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  acquireAiBrowserControl,
  acquireHumanBrowserControl,
  assertBrowserOperationCanRun,
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
  it("fences a stale owner after another process recovers the lease", async () => {
    vi.useFakeTimers();
    const oldOwner = { ...scope, ...acquireAiBrowserControl(scope) };
    vi.setSystemTime(Date.now() + BROWSER_CONTROL_SHARED_LEASE_MIN_MS + 1);
    vi.resetModules();
    const recovered = await import("./browserControlArbitration");
    const newOwner = { ...scope, ...recovered.acquireAiBrowserControl(scope) };
    releaseBrowserControl(oldOwner);
    expect(() => assertBrowserOperationCanRun(oldOwner)).toThrow();
    expect(() => acquireAiBrowserControl(oldOwner)).toThrow();
    expect(() => recovered.assertBrowserOperationCanRun(newOwner)).not.toThrow();
    expect(recovered.browserControlState(scope)).toBe("AGENT_CONTROL");
    recovered.releaseBrowserControl(newOwner);
  });
  it("lets only the operation owning an agent lease execute", () => {
    const owner = { ...scope, ...acquireAiBrowserControl(scope) };
    expect(() => assertBrowserOperationCanRun(owner)).not.toThrow();
    expect(() => assertBrowserOperationCanRun(scope)).toThrow(
      "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    );
    releaseBrowserControl(owner);
  });

  it("does not make unrelated agents in one process re-entrant", () => {
    acquireAiBrowserControl(scope);
    expect(() => acquireAiBrowserControl(scope)).toThrow(
      "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    );
  });

  it("cannot release another controller's lease by knowing its scope", () => {
    const owner = { ...scope, ...acquireAiBrowserControl(scope) };
    releaseBrowserControl(scope);
    expect(browserControlState(scope)).toBe("AGENT_CONTROL");
    releaseBrowserControl(owner);
    expect(browserControlState(scope)).toBe("IDLE");
  });

  it("blocks a real second process and reports the shared state", () => {
    const owner = { ...scope, ...acquireAiBrowserControl(scope) };
    const moduleUrl = new URL("./browserControlArbitration.ts", import.meta.url)
      .href;
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      const arbiter = await import(${JSON.stringify(moduleUrl)});
      const scope = ${JSON.stringify(scope)};
      console.log(arbiter.browserControlState(scope));
      try { arbiter.acquireAiBrowserControl(scope); process.exitCode = 2; }
      catch (error) { console.log(error.message); }
    `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CRM_BROWSER_CONTROL_LEASE_DIR: join(
            tmpdir(),
            `amarktai-browser-control-${process.pid}`
          ),
        },
      }
    );
    expect(result).toContain("AGENT_CONTROL");
    expect(result).toContain("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
    releaseBrowserControl(owner);
  });

  it("releases the exact lease on a handled operation failure", async () => {
    const owner = { ...scope, ...acquireAiBrowserControl(scope) };
    try {
      await expect(
        Promise.reject(new Error("test operation failed"))
      ).rejects.toThrow();
    } finally {
      releaseBrowserControl(owner);
    }
    expect(browserControlState(scope)).toBe("IDLE");
    expect(() => assertBrowserOperationCanRun(owner)).toThrow(
      "CRM_BROWSER_CONTROL_LEASE_LOST"
    );
  });

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
      const owner = {
        ...scope,
        ...isolated.acquireAiBrowserControl(scope, 8_000),
      };
      expect(owner.control).toBe("AGENT_CONTROL");
      isolated.releaseBrowserControl(owner);
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
    const owner = { ...scope, ...acquireAiBrowserControl(scope, 8_000) };
    releaseBrowserControl(owner);
    expect(browserControlState(scope)).toBe("IDLE");
  });
});
