import { describe, expect, it } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import { finaliseCompanyKnowledgeRuntimeResult } from "./companyKnowledgeRuntimeFinalization";
import {
  CompanyKnowledgeOutputError,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  type CompanyKnowledgeCompleteness,
  type CompanyKnowledgeSynthesisResult,
} from "./companyKnowledgeSynthesis";

function auditOffering(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-a",
    name: "Course A",
    type: "individual_course",
    prices: [],
    sourcePageIds: ["PAGE_0001"],
    ...overrides,
  };
}

function parseAudit(raw: unknown, pageIds = ["PAGE_0001"]) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "audit",
    schema: companyKnowledgeAuditSchema,
    context: {
      phase: "audit",
      batchIndex: 28,
      batchTotal: 36,
      pageIds,
    },
  });
}

function expectHumanReview(parsed: ReturnType<typeof parseAudit>) {
  expect(parsed.data.addOfferings).toEqual([]);
  expect(parsed.data.replaceOfferings).toEqual([]);
  expect(parsed.data.removeOfferingIds).toEqual([]);
  expect(parsed.data.importantGaps).toHaveLength(1);
  expect(parsed.data.importantGaps[0]).toContain(
    "Human review required for audit batch 28/36"
  );
  expect(parsed.data.importantGaps[0]).toContain("PAGE_0001");
  expect(parsed.normalizationActions).toContain(
    "$:quarantined_audit_schema_for_human_review"
  );
}

describe("company-learning audit human review fallback", () => {
  it("quarantines the production job #1 _comment_removal shape instead of spending a repair", () => {
    const parsed = parseAudit({
      replaceOfferings: [
        auditOffering({
          id: "cisa-certification",
          name: "Certified Information Systems Auditor (CISA) Certification",
          _comment_removal: "Duplicate of isaca-cisa — merging into isaca-cisa instead",
        }),
      ],
      removeOfferingIds: ["cisa-certification"],
    });
    expectHumanReview(parsed);
    expect(parsed.data.importantGaps[0]).toContain("_comment_removal");
  });

  it("quarantines the production job #1 displayed_base_price semantic instead of inventing a canonical meaning", () => {
    const parsed = parseAudit({
      replaceOfferings: [
        auditOffering({
          id: "microsoft-sc-900",
          name: "Microsoft SC-900",
          prices: [
            {
              value: "£319.00",
              semanticType: "full_current_price",
              label: "With Exam",
              sourcePageIds: ["PAGE_0001"],
            },
            {
              value: "£229.00",
              semanticType: "alternative_plan",
              label: "Without Exam",
              sourcePageIds: ["PAGE_0001"],
            },
            {
              value: "£229.00",
              semanticType: "displayed_base_price",
              label: "Displayed price on page",
              sourcePageIds: ["PAGE_0001"],
            },
          ],
        }),
      ],
    });
    expectHumanReview(parsed);
    expect(parsed.data.importantGaps[0]).toContain("semanticType");
  });

  it("quarantines the production job #1 field/detail exclusion-note shape", () => {
    const parsed = parseAudit({
      addExcludedContent: [
        {
          field: "offerings.access",
          detail: "12 months course access. Most learners complete in three to nine months.",
          sourcePageIds: ["PAGE_0001"],
        },
      ],
    });
    expectHumanReview(parsed);
    expect(parsed.data.importantGaps[0]).toContain("addExcludedContent");
  });

  it("quarantines the production job #1 course metadata shape without mapping it into trusted fields", () => {
    const parsed = parseAudit({
      replaceOfferings: [
        auditOffering({
          id: "ai-and-data-career-programme",
          name: "AI and Data Career Programme",
          courseAccess: "12 months",
          typicalCompletion: "3 to 9 months",
          courseWorkload: "P9M",
          courseMode: "online",
          coursePrerequisites: "None",
        }),
      ],
    });
    expectHumanReview(parsed);
    expect(parsed.data.importantGaps[0]).toContain("courseAccess");
  });

  it("keeps malformed audit JSON as a hard failure", () => {
    expect(() => parseAudit("not json at all")).toThrow(
      CompanyKnowledgeOutputError
    );
  });

  it("keeps out-of-batch PAGE provenance as a hard failure", () => {
    expect(() =>
      parseAudit(
        {
          replaceOfferings: [
            auditOffering({ sourcePageIds: ["PAGE_9999"] }),
          ],
        },
        ["PAGE_0001"]
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("does not weaken partial-analysis strictness", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          offerings: [auditOffering({ courseAccess: "12 months" })],
        },
        mode: "partial_analysis",
        schema: companyKnowledgePackSchema.partial(),
        context: {
          phase: "analysis",
          batchIndex: 1,
          batchTotal: 1,
          pageIds: ["PAGE_0001"],
        },
      })
    ).toThrow(CompanyKnowledgeOutputError);
  });
});

function completeness(
  importantGaps: string[]
): CompanyKnowledgeCompleteness {
  return {
    status: "complete",
    pagesDiscovered: 1,
    pagesScanned: 1,
    pagesCrawled: 1,
    pagesSuccessfullyRead: 1,
    pagesClassified: 1,
    pagesUsedAsEvidence: 1,
    pagesUsed: 1,
    pagesExcludedWithReason: 0,
    pagesExcluded: 0,
    candidateSellableOfferingsDiscovered: 1,
    careerProgrammesDiscovered: 0,
    individualCoursesDiscovered: 1,
    finalProposedOfferings: 1,
    offeringsFound: 1,
    offeringsWithEvidencedFullPrice: 0,
    offeringsWithPublishedPrice: 0,
    offeringsWithoutEvidencedFullPrice: 1,
    financeInformationFound: false,
    contactInformationFound: false,
    certificationInformationFound: false,
    supportAndOutcomeInformationFound: false,
    policyTermsInformationFound: false,
    conflictsFound: 0,
    unresolvedConflicts: 0,
    importantGaps,
  };
}

describe("company-learning human review finalization", () => {
  it("forces an amber complete_with_conflicts state while a quarantined audit needs human review", () => {
    const corpus = buildCompanyCorpus([
      {
        url: "https://example.com/courses/course-a",
        title: "Course A",
        fetchedAt: "2026-08-31T07:00:00.000Z",
        text: "Course A is an online course.",
        category: "courses",
        description: null,
        headings: ["Course A"],
        links: [],
        jsonLd: [],
      },
    ]);
    const pageId = corpus.pages[0].pageId;
    const reviewGap = `Human review required for audit batch 1/1 (${pageId}). The audit proposed a change that could not be represented safely, so the complete audit patch for this batch was quarantined and the previously validated company draft was left unchanged.`;
    const pack = companyKnowledgePackSchema.parse({
      company: {
        name: "Example",
        legalName: "",
        description: "",
        sourcePageIds: [pageId],
      },
      offerings: [
        {
          id: "course-a",
          name: "Course A",
          type: "individual_course",
          sourcePageIds: [pageId],
        },
      ],
      importantGaps: [reviewGap],
      sourceIndex: { [pageId]: "https://example.com/courses/course-a" },
    });
    const result: CompanyKnowledgeSynthesisResult = {
      agentKey: "company_intelligence_review",
      available: true,
      pack,
      corpus,
      completeness: completeness([reviewGap]),
      reviewedAt: "2026-08-31T07:01:00.000Z",
      analysisCalls: 1,
      auditCalls: 1,
      normalizationEvents: 1,
      repairCalls: 0,
      totalAiCalls: 2,
      cleanupFailures: [],
      selectedModelOperations: { analysis: true, audit: true },
    };

    const final = finaliseCompanyKnowledgeRuntimeResult(result);
    expect(final.completeness.status).toBe("complete_with_conflicts");
    expect(final.completeness.importantGaps).toContain(reviewGap);
    expect(final.pack.offerings[0].name).toBe("Course A");
    expect(final.pack.conflicts).toEqual([]);
  });
});
