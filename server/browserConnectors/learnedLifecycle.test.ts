import { describe, expect, it } from "vitest";
import {
  browserOperationStatusAfterResult,
  CAPTURED_BROWSER_OPERATION_STATUS,
  REVIEWED_BROWSER_OPERATION_STATUS,
  effectiveLatestBrowserOperation,
} from "./learnedOperations";

describe("guided learned-operation lifecycle", () => {
  it("revalidates an old contention-only block without granting production readiness", () => {
    const operation = { status: "BLOCKED" as const, prerequisites: {}, lastError: "execution_failure: CRM_VIEWER_AGENT_CONTROL_ACTIVE: deterministic browser operation failed." };
    expect(effectiveLatestBrowserOperation(operation)?.status).toBe("TEST_READY");
    expect(effectiveLatestBrowserOperation({ ...operation, lastError: "selector_drift: deterministic browser operation failed." })?.status).toBe("BLOCKED");
  });
  it.each(["TEST_READY", "LIVE_PROVEN", "DEGRADED"] as const)("preserves %s during infrastructure contention", currentStatus => {
    expect(browserOperationStatusAfterResult({ currentStatus, success: false, publish: false, watchdog: true, transient: true })).toBe(currentStatus);
  });
  it("records demonstrations as LEARNED and manager definitions as TEST_READY", () => {
    expect(CAPTURED_BROWSER_OPERATION_STATUS).toBe("LEARNED");
    expect(REVIEWED_BROWSER_OPERATION_STATUS).toBe("TEST_READY");
  });

  it("publishes a successful controlled TEST_READY replay as LIVE_PROVEN", () => {
    expect(
      browserOperationStatusAfterResult({
        currentStatus: "TEST_READY",
        success: true,
        publish: true,
        watchdog: false,
      })
    ).toBe("LIVE_PROVEN");
  });

  it("keeps a learned demonstration non-executable until review", () => {
    expect(
      browserOperationStatusAfterResult({
        currentStatus: "LEARNED",
        success: true,
        publish: false,
        watchdog: false,
      })
    ).toBe("LEARNED");
  });

  it("degrades only the affected LIVE_PROVEN operation after a runtime failure", () => {
    const statuses = {
      add_note: "LIVE_PROVEN" as const,
      create_next_task: "LIVE_PROVEN" as const,
    };
    const affected = browserOperationStatusAfterResult({
      currentStatus: statuses.add_note,
      success: false,
      publish: false,
      watchdog: true,
    });
    expect({ ...statuses, add_note: affected }).toEqual({
      add_note: "DEGRADED",
      create_next_task: "LIVE_PROVEN",
    });
  });
});
