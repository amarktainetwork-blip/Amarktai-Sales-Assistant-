import { describe, expect, it } from "vitest";
import { companyKnowledgeRepairTargetPrompt } from "./companyKnowledgeSynthesis";

describe("company-learning repair target prompt", () => {
  it("includes the exact analysis pack keys needed to repair alternate GenX schemas", () => {
    const prompt = companyKnowledgeRepairTargetPrompt("analysis");
    expect(prompt).toContain('"company"');
    expect(prompt).toContain('"offerings"');
    expect(prompt).toContain('"sourceIndex"');
    expect(prompt).toContain('"sourcePageIds"');
    expect(prompt).not.toContain('company_name');
    expect(prompt).not.toContain('products_and_services');
  });

  it("includes the exact audit patch keys needed for bounded audit repair", () => {
    const prompt = companyKnowledgeRepairTargetPrompt("audit");
    expect(prompt).toContain('"addOfferings"');
    expect(prompt).toContain('"replaceOfferings"');
    expect(prompt).toContain('"removeOfferingIds"');
    expect(prompt).toContain('"addConflicts"');
    expect(prompt).toContain('"importantGaps"');
  });
});
