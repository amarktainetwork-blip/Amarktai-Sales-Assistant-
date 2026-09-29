import { describe, it, expect } from "vitest";
import {
  authoritativeCrmFreshness,
  calculateCurrentReadiness,
  healthSummaryAfterReadiness,
  shouldPreserveConnectionStatus,
} from "./currentReadiness";
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
  describe("authoritative workspace freshness", () => {
    const older = new Date("2026-09-25T08:00:00.000Z");
    const current = new Date("2026-09-29T08:00:00.000Z");

    it("uses a completed full or incremental reconciliation, not an old pagination cursor", () => {
      // Resource cursors are deliberately not an input to workspace freshness.
      // The old date represents a full-scan checkpoint that did not need to move.
      expect(
        authoritativeCrmFreshness([
          { status: "ready", lastSucceededAt: current },
        ])
      ).toEqual({ status: "synchronized", lastSuccessfulAt: current });
      expect(older).not.toEqual(current);
    });

    it("does not let unchanged source data erase the latest successful proof", () => {
      expect(
        authoritativeCrmFreshness([
          { status: "running", lastSucceededAt: current },
        ])
      ).toEqual({ status: "synchronized", lastSuccessfulAt: current });
    });

    it("keeps concurrent reconciliation on the previous proof until completion", () => {
      expect(
        authoritativeCrmFreshness([
          { status: "running", lastSucceededAt: current },
          { status: "ready", lastSucceededAt: current },
        ])
      ).toEqual({ status: "synchronized", lastSuccessfulAt: current });
    });

    it("uses the oldest connection proof for whole-workspace truth", () => {
      expect(
        authoritativeCrmFreshness([
          { status: "ready", lastSucceededAt: current },
          { status: "ready", lastSucceededAt: older },
        ])
      ).toEqual({ status: "synchronized", lastSuccessfulAt: older });
    });

    it("does not let one narrow success hide an unsynchronized connection", () => {
      expect(
        authoritativeCrmFreshness([
          { status: "ready", lastSucceededAt: current },
          { status: "ready", lastSucceededAt: null },
        ])
      ).toEqual({ status: "not_synchronized", lastSuccessfulAt: null });
    });

    it("surfaces a current reconciliation error without fabricating freshness", () => {
      expect(
        authoritativeCrmFreshness([
          { status: "error", lastSucceededAt: current },
        ])
      ).toEqual({ status: "attention", lastSuccessfulAt: current });
      expect(authoritativeCrmFreshness([])).toEqual({
        status: "not_synchronized",
        lastSuccessfulAt: null,
      });
    });
  });

  it("clears stale transient browser-control health text after current reads recover", () => {
    expect(
      healthSummaryAfterReadiness({
        currentReady: true,
        previousSummary: "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
      })
    ).toBe("Browser CRM reads are current; proven capabilities are available.");
    expect(
      healthSummaryAfterReadiness({
        currentReady: false,
        previousSummary: "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
      })
    ).toBe("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
  });

  it("recovers authentication_expired only after a successful authenticated browser proof", () => {
    expect(
      shouldPreserveConnectionStatus("authentication_expired", false)
    ).toBe(true);
    expect(shouldPreserveConnectionStatus("authentication_expired", true)).toBe(
      false
    );
    expect(shouldPreserveConnectionStatus("paused", true)).toBe(true);
    expect(shouldPreserveConnectionStatus("disconnected", true)).toBe(true);
  });
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

  it("requires cursors only for resources the personal browser sync materialises", () => {
    const current = calculateCurrentReadiness({
      operations: new Map([
        ["company.sync", "LIVE_PROVEN"],
        ["contact.search", "LIVE_PROVEN"],
        ["contact.read", "LIVE_PROVEN"],
        ["contact.sync", "LIVE_PROVEN"],
        ["task.sync", "LIVE_PROVEN"],
        ["opportunity.sync", "LIVE_PROVEN"],
        ["activity.sync", "LIVE_PROVEN"],
      ]),
      allowedReads: [
        "companies.read",
        "contacts.read",
        "tasks.read",
        "opportunities.read",
        "activities.read",
      ],
      allowedWrites: [],
      discovered: [
        "company.sync",
        "contact.search",
        "contact.read",
        "contact.sync",
        "task.sync",
        "opportunity.sync",
        "activity.sync",
      ],
      cursors: [
        {
          resourceType: "companies",
          lastSuccessfulAt: new Date(),
          lastError: null,
        },
        {
          resourceType: "contacts",
          lastSuccessfulAt: new Date(),
          lastError: null,
        },
        {
          resourceType: "tasks",
          lastSuccessfulAt: new Date(),
          lastError: null,
        },
      ],
    });
    expect(current.blockingResources).toEqual([]);
    expect(current.ready).toBe(true);
    expect(current.verifiedCapabilities).toEqual([
      "companies.read",
      "contacts.read",
      "tasks.read",
      "opportunities.read",
      "activities.read",
    ]);
  });
});
