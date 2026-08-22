import { describe, expect, it } from "vitest";
import { scoreLeadPriority } from "./scoring";

describe("factual lead prioritisation", () => {
  it("produces transparent urgent reasons from CRM and callback evidence", () => {
    const result = scoreLeadPriority({ overdueTasks: 2, dueCallbacks: 1, openOpportunities: 1, staleOpportunityDays: 5, missedCallSignals: 1, hasNextStep: false });
    expect(result.band).toBe("urgent");
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.reasons).toContain("2 overdue task(s)");
    expect(result.reasons).toContain("no recorded next step");
  });
  it("keeps a lead with no factual work signals normal", () => {
    expect(scoreLeadPriority({ overdueTasks: 0, dueCallbacks: 0, openOpportunities: 0, staleOpportunityDays: 0, missedCallSignals: 0, hasNextStep: true })).toEqual({ score: 0, band: "normal", reasons: [] });
  });
});
