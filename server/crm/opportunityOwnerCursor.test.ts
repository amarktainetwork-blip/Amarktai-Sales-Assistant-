import { describe, expect, it } from "vitest";
import {
  completedOpportunityOwnerSnapshot,
  opportunityOwnerCursorKey,
  opportunityContinuationAfterReadFailure,
} from "./sync";
import { readFileSync } from "node:fs";

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
  it("preserves a validated owner continuation on authenticated session expiry without clearing readiness errors", () => {
    const checkpoint = JSON.stringify({ version: 1, seen: 4500, sourceTotal: 5725 });
    expect(opportunityContinuationAfterReadFailure(new Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED"), checkpoint)).toBe(checkpoint);
    expect(opportunityContinuationAfterReadFailure(new Error("HTTP 401"), checkpoint)).toBe(checkpoint);
    expect(opportunityContinuationAfterReadFailure(new Error("CRM_BROWSER_REAUTHENTICATION_REQUIRED"), null)).toBeUndefined();
  });
  it("does not reuse a potentially invalid cursor on ownership, schema or target failures", () => {
    const checkpoint = "previous-scoped-cursor";
    expect(opportunityContinuationAfterReadFailure(new Error("CRM_OWNER_SCOPE_VIOLATION"), checkpoint)).toBeUndefined();
    expect(opportunityContinuationAfterReadFailure(new Error("GENIE_OPPORTUNITIES_SCHEMA_REQUIRED"), checkpoint)).toBeUndefined();
    expect(opportunityContinuationAfterReadFailure(new Error("TARGET_MISMATCH"), checkpoint)).toBeUndefined();
  });
  it("wires the authenticating failure path to preserved cursor persistence", () => {
    const source = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");
    expect(source).toContain("opportunityContinuationAfterReadFailure(error, existing?.cursor)");
    expect(source).toContain("existing?.lastSuccessfulAt");
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
