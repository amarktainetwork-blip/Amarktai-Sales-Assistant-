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
