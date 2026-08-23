import { describe, expect, it } from "vitest";
import { ACTION_EXECUTION_CLAIM_TTL_MS, isActionExecutionClaimStale, isCurrentActionExecutionClaim } from "./db";

describe("approved action execution claims", () => {
  it("permits recovery only after the bounded stale-claim window", () => {
    const now = Date.now();
    expect(isActionExecutionClaimStale(new Date(now - ACTION_EXECUTION_CLAIM_TTL_MS + 1), now)).toBe(false);
    expect(isActionExecutionClaimStale(new Date(now - ACTION_EXECUTION_CLAIM_TTL_MS), now)).toBe(true);
    expect(isActionExecutionClaimStale(null, now)).toBe(false);
  });

  it("accepts an outcome only from the executor holding the current correlation claim", () => {
    expect(isCurrentActionExecutionClaim("claim-current", "claim-current")).toBe(true);
    expect(isCurrentActionExecutionClaim("claim-reclaimed", "claim-superseded")).toBe(false);
    expect(isCurrentActionExecutionClaim(null, "claim-current")).toBe(false);
  });
});
