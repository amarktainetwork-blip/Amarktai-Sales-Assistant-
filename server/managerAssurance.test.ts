import { describe, expect, it } from "vitest";
import { buildManagerAssuranceFindings } from "./managerAssurance";

describe("Manager Assurance Agent", () => {
  it("raises high-priority findings for blocked work and overdue callbacks", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const findings = buildManagerAssuranceFindings({ proposals: [{ id: 1, workflowRunId: 1, state: "blocked", targetLabel: "Amara Daniels", title: "Update current opportunity", createdAt: now, executionResult: { reason: "CRM route unavailable" } }], callbacks: [{ id: 2, state: "open", leadLabel: "Amara Daniels", title: "Call 2", dueAt: new Date("2026-08-17T12:00:00.000Z") }], runs: [], calls: [] }, now);
    expect(findings.map(item => item.findingKey)).toContain("blocked-proposal:1");
    expect(findings.map(item => item.findingKey)).toContain("overdue-callback:2");
  });
  it("reports a clear check only where the retained evidence has no exception", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const findings = buildManagerAssuranceFindings({ proposals: [], callbacks: [], runs: [], calls: [] }, now);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.findingKey).toBe("assurance-clear");
  });
  it("flags missing CRM evidence and completed work with unresolved proposals", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const findings = buildManagerAssuranceFindings({ proposals: [{ id: 3, workflowRunId: 9, state: "executed", targetLabel: "Avi Mokoena", title: "Add CRM note", createdAt: now, executionResult: { evidence: { availability: "unavailable" } } }, { id: 4, workflowRunId: 9, state: "review_required", targetLabel: "Avi Mokoena", title: "Create callback", createdAt: now, executionResult: null }], callbacks: [], runs: [{ id: 9, status: "completed", workflowKey: "call_2_followup", leadLabel: "Avi Mokoena", updatedAt: now }], calls: [] }, now);
    expect(findings.map(item => item.findingKey)).toContain("missing-crm-evidence:3");
    expect(findings.map(item => item.findingKey)).toContain("incomplete-completed-workflow:9");
  });
});
