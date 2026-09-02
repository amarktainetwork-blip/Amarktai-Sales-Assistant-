import { describe, expect, it } from "vitest";
import {
  REVIEW_EXECUTION_CLAIM_TTL_MS,
  reviewLifecycle,
} from "./reviewStatus";

describe("review lifecycle", () => {
  const now = new Date("2026-09-02T15:30:00.000Z").valueOf();

  it("maps durable proposal states to user-visible lifecycle states", () => {
    expect(reviewLifecycle({ state: "review_required" }, now)).toBe("pending");
    expect(reviewLifecycle({ state: "approved" }, now)).toBe("approved");
    expect(reviewLifecycle({ state: "executed" }, now)).toBe("completed");
    expect(reviewLifecycle({ state: "skipped" }, now)).toBe("skipped");
    expect(reviewLifecycle({ state: "blocked" }, now)).toBe("blocked");
  });

  it("shows only a fresh execution claim as executing", () => {
    expect(
      reviewLifecycle(
        {
          state: "approved",
          executionClaimId: "claim-1",
          executionClaimedAt: new Date(now - 30_000),
        },
        now
      )
    ).toBe("executing");
    expect(
      reviewLifecycle(
        {
          state: "approved",
          executionClaimId: "claim-1",
          executionClaimedAt: new Date(
            now - REVIEW_EXECUTION_CLAIM_TTL_MS - 1
          ),
        },
        now
      )
    ).toBe("approved");
  });

  it("distinguishes a failed execution from a pre-execution block", () => {
    expect(
      reviewLifecycle(
        { state: "blocked", executionResult: { success: false } },
        now
      )
    ).toBe("failed");
    expect(
      reviewLifecycle(
        { state: "blocked", executionResult: { reason: "route_not_ready" } },
        now
      )
    ).toBe("blocked");
  });
});
