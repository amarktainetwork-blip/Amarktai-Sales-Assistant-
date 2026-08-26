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
  it("blocks AI browser automation while a human lease is active", () => {
    acquireHumanBrowserControl(scope, 8_000);
    expect(() => acquireAiBrowserControl(scope, 8_000)).toThrow("CRM_VIEWER_HUMAN_CONTROL_ACTIVE");
  });

  it("blocks human control while an AI lease is active", () => {
    acquireAiBrowserControl(scope, 8_000);
    expect(() => acquireHumanBrowserControl(scope, 8_000)).toThrow("CRM_VIEWER_AI_CONTROL_ACTIVE");
  });

  it("expires a lease deterministically and broadcasts read-only state", () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const unsubscribe = subscribeBrowserControl(scope, state => states.push(state));
    acquireHumanBrowserControl(scope, 50);
    vi.advanceTimersByTime(51);
    expect(browserControlState(scope)).toBe("READ_ONLY_OBSERVE");
    expect(states).toContain("HUMAN_CONTROL");
    expect(states.at(-1)).toBe("READ_ONLY_OBSERVE");
    unsubscribe();
  });

  it("releases an AI lease after completion", () => {
    acquireAiBrowserControl(scope, 8_000);
    releaseBrowserControl(scope);
    expect(browserControlState(scope)).toBe("READ_ONLY_OBSERVE");
  });
});
