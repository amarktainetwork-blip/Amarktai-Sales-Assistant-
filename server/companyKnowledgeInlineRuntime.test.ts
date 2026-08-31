import { describe, expect, it, vi } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import {
  buildCompanyInlineCorpusBatches,
  COMPANY_INLINE_SOURCE_BATCH_CHARS,
  InlineBatchWholeSiteModel,
} from "./companyKnowledgeInlineRuntime";

function corpus() {
  return buildCompanyCorpus(
    [
      {
        url: "https://www.course2career.com/",
        title: "Course 2 Career",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: `Course2Career online IT training. ${"Homepage knowledge. ".repeat(2_200)}`,
        category: "company",
        description: "Course2Career training",
        headings: ["Course2Career", "Online IT Training"],
        links: ["https://www.course2career.com/courses/example"],
        jsonLd: [{ "@type": "Organization", name: "Course2Career" }],
      },
      {
        url: "https://www.course2career.com/courses/example",
        title: "Example Certification Course",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: `Example Certification Course costs £999. ${"Course detail. ".repeat(1_500)}`,
        category: "course",
        description: "Example course",
        headings: ["Example Certification Course"],
        links: [],
        jsonLd: [],
      },
    ],
    "2026-08-29T00:00:00.000Z"
  );
}

function manyBatchCorpus() {
  return buildCompanyCorpus(
    Array.from({ length: 10 }, (_, index) => ({
      url:
        index === 0
          ? "https://www.course2career.com/"
          : `https://www.course2career.com/courses/example-${index}`,
      title: index === 0 ? "Course2Career" : `Example Course ${index}`,
      fetchedAt: "2026-08-29T00:00:00.000Z",
      text: `${index === 0 ? "Course2Career online IT training." : `Example Course ${index}.`} ${"Source-backed course detail. ".repeat(1_100)}`,
      category: index === 0 ? "company" : "course",
      description:
        index === 0 ? "Course2Career training" : `Example Course ${index}`,
      headings: [index === 0 ? "Course2Career" : `Example Course ${index}`],
      links: [],
      jsonLd: [],
    })),
    "2026-08-29T00:00:00.000Z"
  );
}

function emptyPack(pageId = "PAGE_0001") {
  return {
    company: {
      name: "Course2Career",
      legalName: "",
      description: "Online IT training",
      sourcePageIds: [pageId],
    },
    contacts: [],
    locations: [],
    offerings: [],
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
    sourceIndex: {
      [pageId]:
        pageId === "PAGE_0001"
          ? "https://www.course2career.com/"
          : "https://www.course2career.com/courses/example",
    },
  };
}

const emptyAudit = {
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
};

describe("bounded inline company-learning runtime", () => {
  it("preserves PAGE ids while splitting oversized pages into bounded inline batches", () => {
    const built = corpus();
    const batches = buildCompanyInlineCorpusBatches(built);

    expect(batches.length).toBeGreaterThan(1);
    expect(
      batches.every(
        batch => batch.charCount <= COMPANY_INLINE_SOURCE_BATCH_CHARS
      )
    ).toBe(true);
    expect(batches.some(batch => batch.pageIds.includes("PAGE_0001"))).toBe(
      true
    );
    expect(batches.some(batch => batch.pageIds.includes("PAGE_0002"))).toBe(
      true
    );
    expect(batches.map(batch => batch.source).join("\n")).toContain(
      "PAGE_ID=PAGE_0001"
    );
    expect(batches.map(batch => batch.source).join("\n")).toContain(
      "PAGE_ID=PAGE_0002"
    );
  });

  it("uses multipart inline text with no file_ids for every analysis and audit call", async () => {
    let sequence = 0;
    const sessionKinds = new Map<string, "analysis" | "audit">();
    const createSession = vi.fn(async (input: { title: string }) => {
      sequence += 1;
      const id = `session-${sequence}`;
      sessionKinds.set(
        id,
        input.title.includes("audit") ? "audit" : "analysis"
      );
      return id;
    });
    const sendSessionMessage = vi.fn(
      async (input: {
        sessionId: string;
        content: unknown;
        fileIds: string[];
      }) => {
        const kind = sessionKinds.get(input.sessionId);
        const pageId =
          JSON.stringify(input.content).match(/PAGE_ID=(PAGE_\d{4})/)?.[1] ||
          "PAGE_0001";
        return {
          content: JSON.stringify(
            kind === "audit" ? emptyAudit : emptyPack(pageId)
          ),
          usage: {},
        };
      }
    );
    const client = {
      selectModels: vi.fn(async () => ({
        analysis: {
          id: "analysis-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        audit: {
          id: "audit-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        accountCredits: {},
      })),
      createSession,
      sendSessionMessage,
      closeSession: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => []),
    };

    const model = new InlineBatchWholeSiteModel({
      userId: 1,
      organisationId: 1,
      reference: "test-inline-runtime",
      client: client as never,
    });
    const built = corpus();
    const draft = await model.analyse({ corpus: built });
    await model.audit({ corpus: built, draft: draft as never });
    await model.cleanup();

    expect(sendSessionMessage).toHaveBeenCalled();
    for (const call of sendSessionMessage.mock.calls) {
      const input = call[0];
      expect(input.fileIds).toEqual([]);
      expect(Array.isArray(input.content)).toBe(true);
      expect(input.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "text" })])
      );
    }
    const stats = model.callStats();
    expect(stats.analysis).toBeGreaterThan(0);
    expect(stats.audit).toBeGreaterThan(0);
    expect(stats.repair).toBe(0);
  });

  it("normalizes harmless variation across many audit batches without spending repair budget", async () => {
    let sequence = 0;
    const client = {
      selectModels: vi.fn(async () => ({
        analysis: {
          id: "analysis-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        audit: {
          id: "audit-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        accountCredits: {},
      })),
      createSession: vi.fn(async () => `session-${++sequence}`),
      sendSessionMessage: vi.fn(async (input: { content: unknown }) => {
        const pageId =
          JSON.stringify(input.content).match(/PAGE_ID=(PAGE_\d{4})/)?.[1] ||
          "PAGE_0001";
        return {
          content: JSON.stringify({
            result: {
              importantGaps: { text: "Confirm this bounded source batch" },
              addSupportAndOutcomes: {
                title: { label: "Support" },
                details: { text: "Tutor support" },
                sourcePageIds: pageId,
              },
            },
          }),
          usage: {},
        };
      }),
      closeSession: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => []),
    };
    const model = new InlineBatchWholeSiteModel({
      userId: 1,
      organisationId: 1,
      reference: "many-normalized-audits",
      client: client as never,
    });
    const built = manyBatchCorpus();
    expect(buildCompanyInlineCorpusBatches(built).length).toBeGreaterThan(3);
    const audit = await model.audit({
      corpus: built,
      draft: emptyPack() as never,
    });
    const stats = model.callStats();
    expect(audit.importantGaps).toEqual(["Confirm this bounded source batch"]);
    expect(stats.audit).toBeGreaterThan(3);
    expect(stats.normalizedResponses).toBe(stats.audit);
    expect(stats.normalizationEvents).toBeGreaterThan(stats.audit);
    expect(stats.repair).toBe(0);
  });

  it("keeps the three-repair global ceiling for unreadable audit JSON", async () => {
    let sequence = 0;
    const sessionKinds = new Map<string, "audit" | "repair">();
    const client = {
      selectModels: vi.fn(async () => ({
        analysis: {
          id: "analysis-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        audit: {
          id: "audit-model",
          category: "text",
          contextWindow: 0,
          advertised: {},
        },
        accountCredits: {},
      })),
      createSession: vi.fn(async (input: { title: string }) => {
        const id = `session-${++sequence}`;
        sessionKinds.set(
          id,
          input.title.includes("repair") ? "repair" : "audit"
        );
        return id;
      }),
      sendSessionMessage: vi.fn(async (input: { sessionId: string }) => ({
        content:
          sessionKinds.get(input.sessionId) === "repair"
            ? JSON.stringify(emptyAudit)
            : "not json at all",
        usage: {},
      })),
      closeSession: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => []),
    };
    const model = new InlineBatchWholeSiteModel({
      userId: 1,
      organisationId: 1,
      reference: "repair-cap-unreadable-json",
      client: client as never,
    });
    let failure: unknown;
    try {
      await model.audit({
        corpus: manyBatchCorpus(),
        draft: emptyPack() as never,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(
      /bounded batch-repair contract/i
    );
    expect((failure as Error).message).toContain('"phase":"audit"');
    expect((failure as Error).message).toContain('"batchIndex":');
    expect((failure as Error).message).toContain("$json");
    expect(model.callStats().repair).toBe(3);
    expect(
      client.createSession.mock.calls.filter(call =>
        call[0].title.includes("repair")
      )
    ).toHaveLength(3);
  });
});
