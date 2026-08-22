import { describe, expect, it } from "vitest";
import { buildRetentionPlan, canExecuteDestructiveRetention } from "./retention";

describe("retention decision engine", () => {
  it("calculates deterministic UTC-safe cutoffs and defaults to dry-run", () => {
    const plan = buildRetentionPlan({ transcriptRetentionDays: 30, auditRetentionDays: 365, operationalRetentionDays: 90 }, new Date("2026-08-22T12:00:00.000Z"));
    expect(plan.dryRun).toBe(true);
    expect(plan.cutoffs.transcripts.toISOString()).toBe("2026-07-23T12:00:00.000Z");
    expect(plan.cutoffs.operational.toISOString()).toBe("2026-05-24T12:00:00.000Z");
  });

  it("rejects invalid policies and requires both approval and explicit execution", () => {
    expect(() => buildRetentionPlan({ transcriptRetentionDays: 0, auditRetentionDays: 365, operationalRetentionDays: 90 })).toThrow("between 1 and 3650");
    expect(canExecuteDestructiveRetention({ approved: true, requestedExecute: false })).toBe(false);
    expect(canExecuteDestructiveRetention({ approved: false, requestedExecute: true })).toBe(false);
    expect(canExecuteDestructiveRetention({ approved: true, requestedExecute: true })).toBe(true);
  });
});
