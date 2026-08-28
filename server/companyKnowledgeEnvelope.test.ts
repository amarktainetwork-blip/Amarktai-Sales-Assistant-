import { describe, expect, it } from "vitest";
import { buildCompanyCorpus, type CompanyCorpusInputPage } from "./companyKnowledgeCorpus";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  synthesiseCompanyKnowledge,
  type CompanyKnowledgePack,
  type WholeSiteLearningModel,
} from "./companyKnowledgeSynthesis";

function page(): CompanyCorpusInputPage {
  return {
    url: "https://example.test/course/alpha",
    title: "Alpha Course",
    fetchedAt: "2026-08-28T00:00:00.000Z",
    text: "Alpha Course. Full price £719.",
    category: "courses",
    description: null,
    headings: ["Alpha Course"],
    links: [],
    jsonLd: [],
  };
}

function pack(pageId: string): CompanyKnowledgePack {
  return companyKnowledgePackSchema.parse({
    company: {
      name: "Example Learning",
      legalName: "",
      description: "Training company",
      sourcePageIds: [pageId],
    },
    contacts: [],
    locations: [],
    offerings: [
      {
        id: "alpha-course",
        name: "Alpha Course",
        type: "individual_course",
        description: "",
        plans: [],
        prices: [
          {
            value: "£719",
            semanticType: "full_current_price",
            label: "Full course price",
            sourcePageIds: [pageId],
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
        sourcePageIds: [pageId],
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
    sourceIndex: {},
  });
}

describe("company-learning schema envelopes", () => {
  it("accepts one strict analysis and audit envelope without spending repair budget", async () => {
    const pages = [page()];
    const corpus = buildCompanyCorpus(pages);
    const pageId = corpus.pages[0].pageId;
    let repairs = 0;
    const model: WholeSiteLearningModel = {
      async analyse() {
        return JSON.stringify({ company_knowledge_pack: pack(pageId) });
      },
      async audit() {
        return {
          company_knowledge_audit: companyKnowledgeAuditSchema.parse({}),
        };
      },
      async repair() {
        repairs += 1;
        return {};
      },
    };

    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 1,
      pages,
      reference: "schema-envelope",
      model,
    });

    expect(result.pack.offerings.map(item => item.name)).toEqual(["Alpha Course"]);
    expect(repairs).toBe(0);
    expect(result.repairCalls).toBe(0);
    expect(result.totalAiCalls).toBe(2);
  });

  it("does not unwrap an envelope that has sibling metadata", async () => {
    const pages = [page()];
    const corpus = buildCompanyCorpus(pages);
    const pageId = corpus.pages[0].pageId;
    const model: WholeSiteLearningModel = {
      async analyse() {
        return {
          company_knowledge_pack: pack(pageId),
          metadata: { source: "unexpected" },
        };
      },
      async audit() {
        return companyKnowledgeAuditSchema.parse({});
      },
    };

    await expect(
      synthesiseCompanyKnowledge({
        userId: 1,
        organisationId: 1,
        pages,
        reference: "schema-envelope-sibling",
        model,
      })
    ).rejects.toThrow();
  });
});
