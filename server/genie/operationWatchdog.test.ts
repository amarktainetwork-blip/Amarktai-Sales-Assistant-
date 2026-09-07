import { describe, expect, it } from "vitest";
import { watchdogRepairPlan } from "./operationWatchdog";

describe("daily CRM drift economics", () => {
  it("uses zero GenX calls when every deterministic watchdog passes", () => {
    expect(
      watchdogRepairPlan([
        { operationKey: "contact.search", status: "live" },
        { operationKey: "contact.read", status: "live" },
      ])
    ).toEqual({
      affectedOperationKeys: [],
      unchangedGenxCalls: 0,
      maximumRepairBatches: 0,
    });
  });

  it("groups only affected operations into one targeted repair batch", () => {
    expect(
      watchdogRepairPlan([
        { operationKey: "contact.search", status: "live" },
        { operationKey: "task.read", status: "degraded" },
        { operationKey: "task.read", status: "degraded" },
        { operationKey: "opportunity.read", status: "degraded" },
      ])
    ).toEqual({
      affectedOperationKeys: ["task.read", "opportunity.read"],
      unchangedGenxCalls: undefined,
      maximumRepairBatches: 1,
    });
  });
});
