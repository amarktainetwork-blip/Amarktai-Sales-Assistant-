import { describe, expect, it } from "vitest";
import {
  completedOpportunityOwnerSnapshot,
  opportunityOwnerCursorKey,
} from "./sync";

describe("shared Genie opportunity cursor isolation", () => {
  const previous = new Date("2026-10-01T13:00:00Z");
  const current = new Date("2026-10-01T13:10:00Z");
  const row = (
    userId: number,
    at: Date | null,
    cursor: string | null = null
  ) => ({
    resourceType: opportunityOwnerCursorKey(userId),
    cursor,
    lastSuccessfulAt: at,
    lastError: null,
  });
  it("uses distinct cursor namespaces for every mapped owner", () => {
    expect(opportunityOwnerCursorKey(2)).not.toBe(opportunityOwnerCursorKey(3));
    expect(() => opportunityOwnerCursorKey(0)).toThrow();
  });
  it("does not certify aggregate freshness with missing or incomplete owner data", () => {
    expect(
      completedOpportunityOwnerSnapshot([2, 3], [row(2, current)])
    ).toBeNull();
    expect(
      completedOpportunityOwnerSnapshot(
        [2, 3],
        [row(2, current), row(3, previous, "next")]
      )
    ).toBeNull();
  });
  it("publishes only the oldest fully proven mapped-owner checkpoint", () => {
    expect(
      completedOpportunityOwnerSnapshot(
        [2, 3],
        [row(2, current), row(3, previous)]
      )?.toISOString()
    ).toBe(previous.toISOString());
  });
});
