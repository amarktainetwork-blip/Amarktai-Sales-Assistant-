import { describe, expect, it } from "vitest";
import {
  browserOperationStatusAfterResult,
  CAPTURED_BROWSER_OPERATION_STATUS,
  REVIEWED_BROWSER_OPERATION_STATUS,
} from "./learnedOperations";

describe("guided learned-operation lifecycle", () => {
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
});
