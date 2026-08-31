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

function expectHumanReview(result: ReturnType<typeof parse>) {
  expect(result.data.replaceOfferings).toEqual([]);
  expect(result.data.addOfferings).toEqual([]);
  expect(result.data.importantGaps[0]).toContain(
    "Human review required for audit batch 27/36"
  );
  expect(result.normalizationActions).toContain(
    "$:quarantined_audit_schema_for_human_review"
  );
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

  it("quarantines an ambiguous courses merge for human review instead of guessing", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            courses: ["Unclear Course"],
            includedCourses: ["Canonical Course"],
          }),
        ],
      })
    );
    expectHumanReview(result);
  });

  it("removes only the explicit audit offering _comment annotation", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            _comment: "Model explanation that is not company knowledge.",
          }),
        ],
      })
    );

    expect(result.data.replaceOfferings[0]).not.toHaveProperty("_comment");
    expect(result.normalizationActions).toContain(
      "replaceOfferings[0]._comment:removed_audit_annotation"
    );
  });

  it("quarantines unknown audit offering metadata for human review", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            _note: "Unknown model metadata must not become company knowledge.",
          }),
        ],
      })
    );
    expectHumanReview(result);
    expect(result.data.importantGaps[0]).toContain("_note");
  });

  it("keeps _comment invalid in full analysis", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          company: {
            name: "Course2Career",
            sourcePageIds: ["PAGE_0076"],
          },
          offerings: [
            offering({
              _comment: "Audit-only metadata must remain strict here.",
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

  it("preserves canonical original prices as historical pricing", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            prices: [price("original_price")],
          }),
        ],
      })
    );

    expect(result.data.replaceOfferings[0].prices[0].semanticType).toBe(
      "original_price"
    );
    expect(result.normalizationActions).not.toContain(
      "replaceOfferings[0].prices[0].semanticType:canonicalized_alias"
    );
  });

  it("maps only the proven audit was_price alias to original_price", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            prices: [price("was_price")],
          }),
        ],
      })
    );

    expect(result.data.replaceOfferings[0].prices[0].semanticType).toBe(
      "original_price"
    );
    expect(result.normalizationActions).toContain(
      "replaceOfferings[0].prices[0].semanticType:canonicalized_alias"
    );
  });

  it("quarantines semantically unknown audit price types for a human decision", () => {
    const result = parse(
      audit({
        replaceOfferings: [
          offering({
            prices: [price("monthly_installment")],
          }),
        ],
      })
    );
    expectHumanReview(result);
    expect(result.data.importantGaps[0]).toContain("semanticType");
  });

  it("does not normalize formatting variants in full analysis", () => {
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

  it("does not apply the audit-only was_price alias in full analysis", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          company: {
            name: "Course2Career",
            sourcePageIds: ["PAGE_0076"],
          },
          offerings: [
            offering({
              prices: [price("was_price")],
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

  it("quarantines semantically unknown excluded-content classifications", () => {
    const result = parse(
      audit({
        addExcludedContent: [
          {
            sourcePageIds: ["PAGE_0076"],
            classification: "programme_page",
            reason: "Unknown semantic classification.",
          },
        ],
      })
    );
    expectHumanReview(result);
    expect(result.data.importantGaps[0]).toContain("classification");
  });
});
