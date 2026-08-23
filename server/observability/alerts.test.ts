import { describe, expect, it } from "vitest";
import { boundedDeliveryAttempt, shouldRouteOperationalAlert } from "./alerts";

describe("operational alert routing", () => {
  it("routes only active rules meeting severity and category criteria", () => {
    const rule = { isActive: true, severityThreshold: "error" as const, category: "connector" };
    expect(shouldRouteOperationalAlert(rule, { severity: "warning", category: "connector" })).toBe(false);
    expect(shouldRouteOperationalAlert(rule, { severity: "critical", category: "worker" })).toBe(false);
    expect(shouldRouteOperationalAlert(rule, { severity: "error", category: "connector" })).toBe(true);
  });

  it("bounds retries before a delivery becomes dead-letter", () => {
    expect(boundedDeliveryAttempt(0)).toBe("retrying");
    expect(boundedDeliveryAttempt(2)).toBe("dead_letter");
  });
});
