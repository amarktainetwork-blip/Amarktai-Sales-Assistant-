import { describe, it, expect } from "vitest";
import { calculateCurrentReadiness } from "./currentReadiness";
import { browserOperationStatusAfterResult } from "../browserConnectors/learnedOperations";
import { classifyBrowserRuntimeFailure } from "../browserConnectors/runtimeFailure";
const base = {
  allowedReads: ["tasks.read"],
  allowedWrites: [],
  discovered: ["task.sync"],
  cursors: [
    { resourceType: "tasks", lastSuccessfulAt: new Date(), lastError: null },
  ],
};
describe("current readiness convergence", () => {
  it("recovers a failed read through controlled proof and successful canonical cursor", () => {
    let status = browserOperationStatusAfterResult({
      currentStatus: "LIVE_PROVEN",
      success: false,
      publish: false,
      watchdog: true,
    });
    expect(
      calculateCurrentReadiness({
        ...base,
        operations: new Map([["task.sync", status]]),
      }).ready
    ).toBe(false);
    status = browserOperationStatusAfterResult({
      currentStatus: status,
      success: true,
      publish: true,
      watchdog: false,
    });
    const stale = {
      ...base,
      operations: new Map([["task.sync", status]]),
      cursors: [
        {
          resourceType: "tasks",
          lastSuccessfulAt: new Date(),
          lastError: "GENIE_TASK_GRID_INVALID",
        },
      ],
    };
    expect(calculateCurrentReadiness(stale).ready).toBe(false);
    const recovered = calculateCurrentReadiness({
      ...stale,
      cursors: base.cursors,
    });
    expect(recovered.ready).toBe(true);
    expect(recovered.verifiedCapabilities).toEqual(["tasks.read"]);
    expect(recovered.safeReads.proven).toEqual(["task.sync"]);
    expect(recovered.capabilityAccounting.criticalGaps).toEqual([]);
  });
  it.each([
    "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
    "CRM_VIEWER_HUMAN_CONTROL_ACTIVE",
    "CRM_BROWSER_CONTROL_LEASE_LOST",
  ])("keeps proven operations and current readiness during %s", error => {
    const transient =
      classifyBrowserRuntimeFailure(error) === "transient_transport";
    expect(
      browserOperationStatusAfterResult({
        currentStatus: "LIVE_PROVEN",
        success: false,
        publish: false,
        watchdog: true,
        transient,
      })
    ).toBe("LIVE_PROVEN");
    expect(
      calculateCurrentReadiness({
        ...base,
        operations: new Map([["task.sync", "LIVE_PROVEN"]]),
        cursors: [{ ...base.cursors[0], lastError: error }],
      }).ready
    ).toBe(true);
  });
  it("does not grant write capability from read proof", () =>
    expect(
      calculateCurrentReadiness({
        ...base,
        allowedWrites: ["tasks.write"],
        operations: new Map([["task.sync", "LIVE_PROVEN"]]),
      }).verifiedCapabilities
    ).toEqual(["tasks.read"]));
  it("requires a successful cursor as well as a successful read proof", () =>
    expect(
      calculateCurrentReadiness({
        ...base,
        cursors: [],
        operations: new Map([["task.sync", "LIVE_PROVEN"]]),
      }).ready
    ).toBe(false));
});
