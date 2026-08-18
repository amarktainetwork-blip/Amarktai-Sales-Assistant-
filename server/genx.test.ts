import { describe, expect, it } from "vitest";
import { getAgentPolicy } from "./agentPolicies";
import { buildAgentSystemPrompt } from "./genx";

describe("company-aware agent prompts", () => {
  it("places approved brand voice in the Human Communications policy prompt without treating it as product authority", () => {
    const prompt = buildAgentSystemPrompt({ agentName: "Human Communications Agent", agentPurpose: "Prepares review-only emails.", policy: getAgentPolicy("communications"), companyContext: "Company: Course2Career\nApproved brand voice: warm, direct, and calm" });
    expect(prompt).toContain("Approved brand voice: warm, direct, and calm");
    expect(prompt).toContain("not authority for customer-, programme-, price-, funding-, or policy-specific claims");
  });
});
