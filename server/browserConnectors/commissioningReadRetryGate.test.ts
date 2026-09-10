import { describe, expect, it } from "vitest";
import { browserOperationExecutionAllowed } from "./learnedOperations";

describe("commissioning read retry execution gate", () => {
  it("allows blocked and degraded reads only on the verification path", () => {
    for (const status of ["BLOCKED", "DEGRADED"] as const) {
      expect(
        browserOperationExecutionAllowed({
          status,
          definitionMode: "read",
          allowTestReady: true,
        })
      ).toBe(true);
      expect(
        browserOperationExecutionAllowed({
          status,
          definitionMode: "read",
          allowTestReady: false,
        })
      ).toBe(false);
    }
  });

  it("never uses the retry allowance to execute blocked or degraded writes", () => {
    for (const status of ["BLOCKED", "DEGRADED"] as const)
      expect(
        browserOperationExecutionAllowed({
          status,
          definitionMode: "write",
          allowTestReady: true,
        })
      ).toBe(false);
  });

  it("preserves the normal LIVE_PROVEN and TEST_READY contract", () => {
    expect(
      browserOperationExecutionAllowed({
        status: "LIVE_PROVEN",
        definitionMode: "write",
      })
    ).toBe(true);
    expect(
      browserOperationExecutionAllowed({
        status: "TEST_READY",
        definitionMode: "write",
        allowTestReady: true,
      })
    ).toBe(true);
    expect(
      browserOperationExecutionAllowed({
        status: "TEST_READY",
        definitionMode: "read",
        allowTestReady: false,
      })
    ).toBe(false);
  });
});
