import { describe, expect, it } from "vitest";
import { browserOperationStatusAfterResult } from "./learnedOperations";

describe("guided learned-operation lifecycle", () => {
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
