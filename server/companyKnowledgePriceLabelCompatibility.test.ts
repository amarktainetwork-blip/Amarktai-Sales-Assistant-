import { describe, expect, it } from "vitest";
import { parseCanonicalCompanyKnowledgeOutput } from "./companyKnowledgeModelOutput";
import { companyKnowledgePackSchema } from "./companyKnowledgeSynthesis";

const PAGE = "PAGE_0001";

describe("company-learning blank price label compatibility", () => {
  it("normalizes a blank price label from semanticType without a repair", () => {
    const parsed = parseCanonicalCompanyKnowledgeOutput({
      raw: {
        company: {
          name: "Example Learning",
          legalName: "",
          description: "Source-backed training company",
          sourcePageIds: [PAGE],
        },
        contacts: [],
        locations: [],
        offerings: [
          {
            id: "alpha-course",
            name: "Alpha Course",
            type: "individual_course",
            description: "Source-backed training",
            plans: [],
            prices: [
              {
                value: "£999",
                semanticType: "full_current_price",
                label: "",
                sourcePageIds: [PAGE],
              },
            ],
            duration: [],
            includedCourses: [],
            includedExams: [],
            certifications: [],
            awardingBodies: [],
            financeOptions: [],
            support: [],
            targetCustomer: "",
            entryRequirements: [],
            outcomes: [],
            caveats: [],
            sourcePageIds: [PAGE],
          },
        ],
        finance: [],
        certificationsAndAccreditation: [],
        supportAndOutcomes: [],
        policies: [],
        refundCancellationTerms: [],
        contactKnowledge: [],
        faqs: [],
        salesUsefulFacts: [],
        excludedContent: [],
        conflicts: [],
        importantGaps: [],
        sourceIndex: { [PAGE]: "https://www.example.test/course/alpha" },
      },
      mode: "full_analysis",
      schema: companyKnowledgePackSchema,
      context: { phase: "analysis", pageIds: [PAGE] },
    });

    expect(parsed.data.offerings[0].prices[0].label).toBe(
      "full current price"
    );
    expect(parsed.normalizationActions).toContain(
      "offerings[0].prices[0].label:derived_from_semantic_type"
    );
  });
});
