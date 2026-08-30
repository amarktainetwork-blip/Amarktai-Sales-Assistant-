import { describe, expect, it } from "vitest";
import {
  CompanyKnowledgeOutputError,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
} from "./companyKnowledgeSynthesis";

function audit(overrides: Record<string, unknown> = {}) {
  return {
    addOfferings: [],
    replaceOfferings: [],
    removeOfferingIds: [],
    addFinance: [],
    addCertificationsAndAccreditation: [],
    addSupportAndOutcomes: [],
    addPolicies: [],
    addRefundCancellationTerms: [],
    addContactKnowledge: [],
    addContacts: [],
    addConflicts: [],
    addExcludedContent: [],
    importantGaps: [],
    ...overrides,
  };
}

function offering(overrides: Record<string, unknown> = {}) {
  return {
    id: "programme-a",
    name: "Programme A",
    type: "career_programme",
    sourcePageIds: ["PAGE_0076"],
    ...overrides,
  };
}

function parse(raw: unknown) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "audit",
    schema: companyKnowledgeAuditSchema,
    context: {
      phase: "audit",
      batchIndex: 27,
      batchTotal: 36,
      pageIds: ["PAGE_0076"],
    },
  });
}

function price(semanticType: string) {
  return {
    value: "£1,000",
    semanticType,
    label: "Published price",
    sourcePageIds: ["PAGE_0076"],
  };
}

describe("bounded audit schema compatibility", () => {
  it("maps the audit-only courses key to includedCourses when the canonical key is absent", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            courses: ["Course One", { name: "Course Two" }],
          }),
        ],
      })
    );

    expect(result.data.replaceOfferings[0].includedCourses).toEqual([
      "Course One",
      "Course Two",
    ]);
    expect(result.normalizationActions).toContain(
      "replaceOfferings[0].courses:renamed_to_includedCourses"
    );
  });

  it("does not guess how to merge courses when includedCourses is already present", () => {
    expect(() =>
      parse(
        audit({
          replaceOfferings: [
            offering({
              courses: ["Unclear Course"],
              includedCourses: ["Canonical Course"],
            }),
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("canonicalizes formatting-equivalent audit price semantic types", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            prices: [price("Full Current Price")],
          }),
        ],
      })
    );

    expect(result.data.replaceOfferings[0].prices[0].semanticType).toBe(
      "full_current_price"
    );
    expect(result.normalizationActions).toContain(
      "replaceOfferings[0].prices[0].semanticType:canonicalized_format"
    );
  });

  it("keeps semantically unknown audit price semantic types invalid", () => {
    expect(() =>
      parse(
        audit({
          replaceOfferings: [
            offering({
              prices: [price("monthly_installment")],
            }),
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("does not normalize price semantic types in full analysis", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          company: {
            name: "Course2Career",
            sourcePageIds: ["PAGE_0076"],
          },
          offerings: [
            offering({
              prices: [price("Full Current Price")],
            }),
          ],
        },
        mode: "full_analysis",
        schema: companyKnowledgePackSchema,
        context: {
          phase: "analysis",
          pageIds: ["PAGE_0076"],
        },
      })
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("canonicalizes only formatting-equivalent excluded-content classifications", () => {
    const result = parse(
      audit({
        addExcludedContent: [
          {
            sourcePageIds: ["PAGE_0076"],
            classification: "Other Non-Company Content",
            reason: "The page is not company sales knowledge.",
          },
        ],
      })
    );

    expect(result.data.addExcludedContent[0].classification).toBe(
      "other_non_company_content"
    );
    expect(result.normalizationActions).toContain(
      "addExcludedContent[0].classification:canonicalized_format"
    );
  });

  it("keeps semantically unknown excluded-content classifications invalid", () => {
    expect(() =>
      parse(
        audit({
          addExcludedContent: [
            {
              sourcePageIds: ["PAGE_0076"],
              classification: "programme_page",
              reason: "Unknown semantic classification.",
            },
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });
});
