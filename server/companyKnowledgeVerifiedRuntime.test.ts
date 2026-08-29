import { describe, expect, it } from "vitest";
import { parseNormalizedCompanyKnowledgeAudit } from "./companyKnowledgeVerifiedRuntime";

describe("verified company-learning audit normalization", () => {
  it("normalizes structured offering text fields without inventing facts", () => {
    const parsed = parseNormalizedCompanyKnowledgeAudit(
      JSON.stringify({
        addOfferings: [
          {
            id: "example-course",
            name: "Example Course",
            type: "individual_course",
            description: "Example Course",
            plans: [{ text: "Premium" }],
            prices: [
              {
                value: { text: "£999" },
                semanticType: "full_current_price",
                label: { label: "Course price" },
                sourcePageIds: "PAGE_0002",
              },
            ],
            duration: [{ value: "12", unit: "months" }],
            includedCourses: [],
            includedExams: [],
            certifications: [{ name: "Example Certification" }],
            awardingBodies: [],
            financeOptions: [],
            support: [{ text: "Tutor support" }],
            targetCustomer: "",
            entryRequirements: [],
            outcomes: [{ description: "Job-ready skills" }],
            caveats: [],
            sourcePageIds: "PAGE_0002",
          },
        ],
        addConflicts: [
          {
            subject: "Programme price",
            values: [{ value: "£2,999" }, { value: "£2,699" }],
            sourcePageIds: ["PAGE_0002", "PAGE_0003"],
            explanation: { text: "Two first-party prices are published." },
          },
        ],
        importantGaps: [{ text: "Confirm which programme price is current." }],
      })
    );

    expect(parsed.addOfferings).toHaveLength(1);
    expect(parsed.addOfferings[0].duration).toEqual(["12 months"]);
    expect(parsed.addOfferings[0].plans).toEqual(["Premium"]);
    expect(parsed.addOfferings[0].certifications).toEqual([
      "Example Certification",
    ]);
    expect(parsed.addOfferings[0].support).toEqual(["Tutor support"]);
    expect(parsed.addOfferings[0].outcomes).toEqual(["Job-ready skills"]);
    expect(parsed.addOfferings[0].sourcePageIds).toEqual(["PAGE_0002"]);
    expect(parsed.addOfferings[0].prices[0].value).toBe("£999");
    expect(parsed.addOfferings[0].prices[0].label).toBe("Course price");
    expect(parsed.addOfferings[0].prices[0].sourcePageIds).toEqual([
      "PAGE_0002",
    ]);
    expect(parsed.addConflicts[0].values).toEqual(["£2,999", "£2,699"]);
    expect(parsed.importantGaps).toEqual([
      "Confirm which programme price is current.",
    ]);
  });

  it("unwraps an audit wrapper while preserving a valid single audit key", () => {
    const wrapped = parseNormalizedCompanyKnowledgeAudit(
      JSON.stringify({
        audit: {
          removeOfferingIds: [{ value: "bad-offering" }],
        },
      })
    );
    expect(wrapped.removeOfferingIds).toEqual(["bad-offering"]);

    const singleKey = parseNormalizedCompanyKnowledgeAudit(
      JSON.stringify({ importantGaps: [{ label: "Review conflict" }] })
    );
    expect(singleKey.importantGaps).toEqual(["Review conflict"]);
  });
});
