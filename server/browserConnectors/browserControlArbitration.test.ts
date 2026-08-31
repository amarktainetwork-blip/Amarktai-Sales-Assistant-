import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireAiBrowserControl,
  acquireHumanBrowserControl,
  browserControlState,
  releaseBrowserControl,
  resetBrowserControlArbitrationForTests,
  subscribeBrowserControl,
} from "./browserControlArbitration";

const scope = { organisationId: 11, connectedSystemId: 22, userId: 0 };

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

  it("expires a lease deterministically and broadcasts idle state", () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const unsubscribe = subscribeBrowserControl(scope, state =>
      states.push(state)
    );
    acquireHumanBrowserControl(scope, 50);
    vi.advanceTimersByTime(51);
    expect(browserControlState(scope)).toBe("IDLE");
    expect(states).toContain("HUMAN_CONTROL");
    expect(states.at(-1)).toBe("IDLE");
    unsubscribe();
  });

  it("releases an agent lease after completion", () => {
    acquireAiBrowserControl(scope, 8_000);
    releaseBrowserControl(scope);
    expect(browserControlState(scope)).toBe("IDLE");
  });
});
