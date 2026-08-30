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

function parseAudit(raw: unknown) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "audit",
    schema: companyKnowledgeAuditSchema,
    context: {
      phase: "audit",
      batchIndex: 28,
      batchTotal: 36,
      pageIds: ["PAGE_0076", "PAGE_0077"],
    },
  });
}

describe("audit unclassified exclusion compatibility", () => {
  it("preserves the observed title/details shape as a review gap without guessing a classification", () => {
    const result = parseAudit(
      audit({
        addExcludedContent: [
          {
            title: "DataAI / DataX explicitly excluded",
            details:
              "CompTIA DataAI is explicitly not included in this programme.",
            sourcePageIds: ["PAGE_0076"],
          },
        ],
      })
    );

    expect(result.data.addExcludedContent).toEqual([]);
    expect(result.data.importantGaps).toEqual([
      "Audit note requiring classification (PAGE_0076): DataAI / DataX explicitly excluded: CompTIA DataAI is explicitly not included in this programme.",
    ]);
    expect(result.normalizationActions).toContain(
      "addExcludedContent[0]:moved_unclassified_exclusion_to_important_gap"
    );
  });

  it("preserves the observed description-only shape as a review gap without guessing a classification", () => {
    const result = parseAudit(
      audit({
        addExcludedContent: [
          {
            description:
              "Power BI training is included but the PL-300 examination is not included.",
            sourcePageIds: ["PAGE_0076"],
          },
        ],
      })
    );

    expect(result.data.addExcludedContent).toEqual([]);
    expect(result.data.importantGaps[0]).toContain(
      "Power BI training is included but the PL-300 examination is not included."
    );
  });

  it("normalizes a known classified audit description into the canonical reason field", () => {
    const result = parseAudit(
      audit({
        addExcludedContent: [
          {
            classification: "editorial",
            description: "This is an editorial page, not an offering page.",
            sourcePageIds: ["PAGE_0076"],
          },
        ],
      })
    );

    expect(result.data.addExcludedContent).toEqual([
      {
        classification: "editorial",
        reason: "This is an editorial page, not an offering page.",
        sourcePageIds: ["PAGE_0076"],
      },
    ]);
    expect(result.normalizationActions).toContain(
      "addExcludedContent[0].reason:derived_from_audit_description"
    );
  });

  it("does not convert semantically unknown classifications into review gaps", () => {
    expect(() =>
      parseAudit(
        audit({
          addExcludedContent: [
            {
              classification: "programme_page",
              description: "Unknown semantic classification.",
              sourcePageIds: ["PAGE_0076"],
            },
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("keeps an unclassified object with no reviewable text invalid", () => {
    expect(() =>
      parseAudit(
        audit({
          addExcludedContent: [
            {
              sourcePageIds: ["PAGE_0076"],
            },
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("keeps out-of-batch provenance invalid after moving an unclassified note to review gaps", () => {
    expect(() =>
      parseAudit(
        audit({
          addExcludedContent: [
            {
              description: "This note cites a page outside the bounded batch.",
              sourcePageIds: ["PAGE_9999"],
            },
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("does not truncate oversized malformed exclusions into valid review gaps", () => {
    expect(() =>
      parseAudit(
        audit({
          addExcludedContent: [
            {
              description: "x".repeat(4_100),
              sourcePageIds: ["PAGE_0076"],
            },
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("keeps the same missing-classification shape invalid in full analysis", () => {
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: {
          company: {
            name: "Course2Career",
            sourcePageIds: ["PAGE_0076"],
          },
          excludedContent: [
            {
              description:
                "Audit-only compatibility must never weaken full analysis.",
              sourcePageIds: ["PAGE_0076"],
            },
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
});
