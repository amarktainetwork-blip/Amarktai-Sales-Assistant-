import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import { companyKnowledgePackSchema } from "./companyKnowledgeSynthesis";
import { companyKnowledgeReviewArtifact } from "./verifyCompanyKnowledge";

describe("no-write whole-site operator verifier", () => {
  it("emits durable progress and the complete acceptance contract and exits", () => {
    const source = readFileSync(
      new URL("./verifyCompanyKnowledge.ts", import.meta.url),
      "utf8"
    );
    for (const key of [
      "DISCOVERY_FETCH",
      "PAGES_SCANNED",
      "PAGES_CLASSIFIED",
      "CORPUS_PAGES",
      "CORPUS_BYTES",
      "CORPUS_BUILD",
      "GENX_FILE_UPLOAD",
      "ANALYSIS_MODEL_SELECTED",
      "PARTIAL_BATCH_SCHEMA",
      "ANALYSIS_PASS",
      "AUDIT_NORMALIZATION",
      "AUDIT_PASS",
      "SOURCE_VALIDATION",
      "PAGES_USED",
      "CAREER_PROGRAMMES_FOUND",
      "INDIVIDUAL_COURSES_FOUND",
      "FINAL_OFFERINGS",
      "OFFERINGS_WITH_FULL_PRICE",
      "FINANCE_FOUND",
      "CONTACT_FOUND",
      "POLICIES_FOUND",
      "CERTIFICATIONS_FOUND",
      "SUPPORT_FOUND",
      "CONFLICTS_FOUND",
      "COMPLETENESS_STATUS",
      "AI_ANALYSIS_CALLS",
      "AI_AUDIT_CALLS",
      "NORMALIZATION_EVENTS",
      "AI_REPAIR_CALLS",
      "TOTAL_AI_CALLS",
      "EXACT_REVIEW_PACK",
      "REVIEW_ARTIFACT",
      "ELAPSED_SECONDS",
      "APP_PROCESS_STABLE",
      "KNOWLEDGE_PERSISTED",
      "KNOWLEDGE_APPROVED",
      "CRM_TOUCHED",
      "GENIE_TOUCHED",
    ])
      expect(source).toContain(`\"${key}\"`);
    expect(source).toContain("process.exit(process.exitCode ?? 0)");
    expect(source).not.toContain("saveWebsiteDiscoveryReview");
    expect(source).not.toMatch(
      /crm|genie/i.test("touch") ? /never/ : /saveCrm/
    );
  });

  it("builds an exact human-review artifact without raw corpus bodies or writes", () => {
    const corpus = buildCompanyCorpus([
      {
        url: "https://www.example.test/course/alpha",
        title: "Alpha Course",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: "PRIVATE_RAW_BODY Alpha Course price £999.",
        category: "course",
        description: "Alpha Course",
        headings: ["Alpha Course"],
        links: [],
        jsonLd: [],
      },
    ]);
    const pack = companyKnowledgePackSchema.parse({
      company: {
        name: "Example Learning",
        sourcePageIds: ["PAGE_0001"],
      },
      offerings: [
        {
          id: "alpha",
          name: "Alpha Course",
          type: "individual_course",
          prices: [
            {
              value: "£999",
              semanticType: "full_current_price",
              label: "Full price",
              sourcePageIds: ["PAGE_0001"],
            },
          ],
          sourcePageIds: ["PAGE_0001"],
        },
      ],
      conflicts: [
        {
          subject: "Alpha price",
          values: ["£999", "£799"],
          sourcePageIds: ["PAGE_0001", "PAGE_0002"],
          explanation: "Published sources disagree.",
        },
      ],
      sourceIndex: {
        PAGE_0001: "https://www.example.test/course/alpha",
      },
    });
    const artifact = companyKnowledgeReviewArtifact({
      websiteUrl: "https://www.example.test/",
      review: {
        agentKey: "company_intelligence_review",
        available: true,
        pack,
        corpus,
        completeness: {
          status: "complete_with_conflicts",
          importantGaps: ["Confirm the current price"],
        },
        reviewedAt: "2026-08-29T00:00:00.000Z",
        analysisCalls: 4,
        auditCalls: 4,
        normalizationEvents: 12,
        repairCalls: 0,
        totalAiCalls: 8,
        cleanupFailures: [],
        selectedModelOperations: { analysis: true, audit: true },
      } as never,
    });

    expect(artifact.lifecycleState).toBe("REVIEW_REQUIRED");
    expect(artifact.offerings[0]).toMatchObject({
      name: "Alpha Course",
      prices: [expect.objectContaining({ value: "£999" })],
      sourcePageIds: ["PAGE_0001"],
    });
    expect(artifact.conflicts[0]).toMatchObject({
      values: ["£999", "£799"],
      sourcePageIds: ["PAGE_0001", "PAGE_0002"],
    });
    expect(artifact.safety).toEqual({
      knowledgePersisted: false,
      knowledgeApproved: false,
      crmTouched: false,
      genieTouched: false,
    });
    expect(JSON.stringify(artifact)).not.toContain("PRIVATE_RAW_BODY");
  });
});
