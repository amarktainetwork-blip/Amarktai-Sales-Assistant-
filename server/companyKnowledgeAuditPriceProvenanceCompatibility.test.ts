import { describe, expect, it } from "vitest";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
} from "./companyKnowledgeSynthesis";
import {
  CompanyKnowledgeOutputError,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";

function offering(input: {
  id: string;
  name: string;
  sourcePageIds: string[];
  prices?: Array<{
    value: string;
    semanticType: string;
    label: string;
    sourcePageIds?: string[];
  }>;
}) {
  return {
    id: input.id,
    name: input.name,
    type: "individual_course",
    prices: input.prices || [],
    sourcePageIds: input.sourcePageIds,
  };
}

function parseAudit(raw: unknown, pageIds: string[]) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "audit",
    schema: companyKnowledgeAuditSchema,
    context: {
      phase: "audit",
      batchIndex: 1,
      batchTotal: 36,
      pageIds,
    },
  });
}

function expectHumanReview(result: ReturnType<typeof parseAudit>) {
  expect(result.data.replaceOfferings).toEqual([]);
  expect(result.data.addOfferings).toEqual([]);
  expect(result.data.importantGaps[0]).toContain(
    "Human review required for audit batch 1/36"
  );
  expect(result.normalizationActions).toContain(
    "$:quarantined_audit_schema_for_human_review"
  );
}

describe("audit price provenance compatibility", () => {
  it("ignores a replacement offering whose prices explicitly have empty provenance and preserves its draft id from removal", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "microsoft-azure-fundamentals-az-900",
            name: "Microsoft Azure Fundamentals (AZ-900)",
            sourcePageIds: ["PAGE_0003"],
            prices: [
              {
                value: "229.00",
                semanticType: "full_current_price",
                label: "GBP",
                sourcePageIds: [],
              },
              {
                value: "319.00",
                semanticType: "alternative_plan",
                label: "With Exam",
                sourcePageIds: [],
              },
            ],
          }),
        ],
        removeOfferingIds: ["microsoft-azure-fundamentals-az-900"],
      },
      ["PAGE_0003"]
    );

    expect(parsed.data.replaceOfferings).toEqual([]);
    expect(parsed.data.removeOfferingIds).toEqual([]);
    expect(parsed.data.importantGaps).toContain(
      "Audit offering change ignored because one or more prices lacked source provenance: Microsoft Azure Fundamentals (AZ-900)."
    );
    expect(parsed.normalizationActions).toContain(
      "replaceOfferings[0]:ignored_unproven_price_provenance"
    );
  });

  it("covers verifier #21 audit batch 23 by retaining sourced changes and rejecting only the unproven CASP+ replacement", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "comptia-a-plus-core-1-2",
            name: "CompTIA A+ (Core 1 & 2) Course & Certification",
            sourcePageIds: ["PAGE_0069"],
            prices: [
              {
                value: "£229.00",
                semanticType: "full_current_price",
                label: "Listed price on Server Engineer page",
                sourcePageIds: ["PAGE_0069"],
              },
            ],
          }),
          offering({
            id: "comptia-casp-plus",
            name: "CompTIA CASP+",
            sourcePageIds: ["PAGE_0070"],
            prices: [
              {
                value: "639.00",
                semanticType: "alternative_plan",
                label: "With Exam",
                sourcePageIds: [],
              },
              {
                value: "229.00",
                semanticType: "full_current_price",
                label: "Without Exam",
                sourcePageIds: [],
              },
            ],
          }),
          offering({
            id: "cyber-security-career-path",
            name: "Cyber Security Career Path",
            sourcePageIds: ["PAGE_0070"],
          }),
        ],
      },
      ["PAGE_0069", "PAGE_0070", "PAGE_0071", "PAGE_0072", "PAGE_0073"]
    );

    expect(parsed.data.replaceOfferings.map(item => item.id)).toEqual([
      "comptia-a-plus-core-1-2",
      "cyber-security-career-path",
    ]);
    expect(parsed.data.importantGaps).toContain(
      "Audit offering change ignored because one or more prices lacked source provenance: CompTIA CASP+."
    );
  });

  it("drops only an evidenced duplicate schema_price when a canonical same-amount price already exists", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "microsoft-sc-900",
            name: "Microsoft SC-900",
            sourcePageIds: ["PAGE_0049"],
            prices: [
              {
                value: "£229.00",
                semanticType: "full_current_price",
                label: "Without Exam",
                sourcePageIds: ["PAGE_0049"],
              },
              {
                value: "£319.00",
                semanticType: "alternative_plan",
                label: "With Exam",
                sourcePageIds: ["PAGE_0049"],
              },
              {
                value: "319",
                semanticType: "schema_price",
                label: "Schema.org listed price (With Exam)",
                sourcePageIds: ["PAGE_0049"],
              },
            ],
          }),
        ],
      },
      ["PAGE_0049"]
    );

    expect(parsed.data.replaceOfferings[0].prices).toHaveLength(2);
    expect(
      parsed.data.replaceOfferings[0].prices.map(price => price.semanticType)
    ).toEqual(["full_current_price", "alternative_plan"]);
    expect(parsed.normalizationActions).toContain(
      "replaceOfferings[0].prices[2]:dropped_duplicate_schema_price"
    );
  });

  it("quarantines an unsupported non-duplicate schema_price for human review", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "microsoft-sc-900",
            name: "Microsoft SC-900",
            sourcePageIds: ["PAGE_0049"],
            prices: [
              {
                value: "£999.00",
                semanticType: "schema_price",
                label: "Schema.org listed price",
                sourcePageIds: ["PAGE_0049"],
              },
            ],
          }),
        ],
      },
      ["PAGE_0049"]
    );
    expectHumanReview(parsed);
  });

  it("quarantines other unknown audit price semantics for human review", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "course-a",
            name: "Course A",
            sourcePageIds: ["PAGE_0001"],
            prices: [
              {
                value: "£100",
                semanticType: "monthly_installment",
                label: "Monthly",
                sourcePageIds: ["PAGE_0001"],
              },
            ],
          }),
        ],
      },
      ["PAGE_0001"]
    );
    expectHumanReview(parsed);
  });

  it("quarantines a missing audit price sourcePageIds property rather than inventing provenance", () => {
    const parsed = parseAudit(
      {
        replaceOfferings: [
          offering({
            id: "course-a",
            name: "Course A",
            sourcePageIds: ["PAGE_0001"],
            prices: [
              {
                value: "£100",
                semanticType: "full_current_price",
                label: "Full price",
              },
            ],
          }),
        ],
      },
      ["PAGE_0001"]
    );
    expectHumanReview(parsed);
  });

  it("does not weaken partial analysis price provenance", () => {
    const partialSchema = companyKnowledgePackSchema.partial();
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          offerings: [
            offering({
              id: "course-a",
              name: "Course A",
              sourcePageIds: ["PAGE_0001"],
              prices: [
                {
                  value: "£100",
                  semanticType: "full_current_price",
                  label: "Full price",
                  sourcePageIds: [],
                },
              ],
            }),
          ],
        },
        mode: "partial_analysis",
        schema: partialSchema,
        context: {
          phase: "analysis",
          batchIndex: 1,
          batchTotal: 1,
          pageIds: ["PAGE_0001"],
        },
      })
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("still rejects retained audit evidence outside the bounded batch", () => {
    expect(() =>
      parseAudit(
        {
          replaceOfferings: [
            offering({
              id: "course-a",
              name: "Course A",
              sourcePageIds: ["PAGE_9999"],
              prices: [
                {
                  value: "£100",
                  semanticType: "full_current_price",
                  label: "Full price",
                  sourcePageIds: ["PAGE_9999"],
                },
              ],
            }),
          ],
        },
        ["PAGE_0001"]
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });
});
