import { describe, expect, it } from "vitest";
import {
  buildCompanyCorpus,
  type CompanyCorpusInputPage,
} from "./companyKnowledgeCorpus";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  synthesiseCompanyKnowledge,
  validateCompanyKnowledgePack,
  type CompanyKnowledgePack,
  type WholeSiteLearningModel,
} from "./companyKnowledgeSynthesis";

function page(
  index: number,
  path: string,
  text: string,
  category = "courses"
): CompanyCorpusInputPage {
  return {
    url: `https://example.test${path}`,
    title: text.split(".")[0],
    fetchedAt: "2026-08-28T00:00:00.000Z",
    text: `Example Learning. ${text}`,
    category,
    description: null,
    headings: [text.split(".")[0]],
    links: [`https://example.test/link-${index}`],
    jsonLd: [],
  };
}

function basePack(overrides: Partial<CompanyKnowledgePack> = {}) {
  return companyKnowledgePackSchema.parse({
    company: {
      name: "Example Learning",
      legalName: "",
      description: "Training company",
      sourcePageIds: ["PAGE_0001"],
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
    sourceIndex: {},
    ...overrides,
  });
}

function offering(id: string, name: string, pageId: string, value = "£719") {
  return {
    id,
    name,
    type: "individual_course" as const,
    description: "A useful sourced paraphrase that need not appear verbatim.",
    plans: [],
    prices: [
      {
        value,
        semanticType: "full_current_price" as const,
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
  };
}

describe("whole-site company learning", () => {
  it("uses two semantic passes for a 100-page corpus instead of one call per page", async () => {
    const pages = Array.from({ length: 100 }, (_, index) =>
      index < 50
        ? page(
            index,
            `/course/course-${String(index).padStart(2, "0")}`,
            `Course ${index}. Full price £${719 + index}. Includes mentor support.`
          )
        : page(
            index,
            `/about/page-${index}`,
            `Business information page ${index}. Contact and policy context.`,
            "about"
          )
    );
    const corpus = buildCompanyCorpus(pages);
    const offerings = corpus.pages
      .filter(item => item.url.includes("/course/"))
      .map((item, index) =>
        offering(
          `course-${index}`,
          `Course ${index}`,
          item.pageId,
          `£${719 + index}`
        )
      );
    let calls = 0;
    const model: WholeSiteLearningModel = {
      async analyse() {
        calls += 1;
        return basePack({ offerings });
      },
      async audit() {
        calls += 1;
        return companyKnowledgeAuditSchema.parse({});
      },
    };
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 1,
      pages,
      reference: "bounded",
      model,
    });
    expect(calls).toBe(2);
    expect(result.totalAiCalls).toBe(2);
    expect(result.corpus.pageCount).toBe(100);
    expect(result.pack.offerings).toHaveLength(50);
  });

  it("rejects unknown source IDs and material prices absent from cited pages without destroying a grounded offering", () => {
    const corpus = buildCompanyCorpus([
      page(
        1,
        "/course/alpha",
        "Alpha Course. Full price £719. Mentor support included."
      ),
    ]);
    const id = corpus.pages[0].pageId;
    const pack = basePack({
      company: {
        name: "Alpha",
        legalName: "",
        description: "",
        sourcePageIds: [id],
      },
      offerings: [
        {
          ...offering("alpha", "Alpha Course", id, "£9,999"),
          description: "Faithful optional paraphrase.",
        },
        offering("fabricated", "Fabricated Course", "PAGE_9999"),
      ],
    });
    const validated = validateCompanyKnowledgePack(pack, corpus);
    expect(validated.offerings).toHaveLength(1);
    expect(validated.offerings[0].description).toBe(
      "Faithful optional paraphrase."
    );
    expect(validated.offerings[0].prices).toEqual([]);
    expect(Object.keys(validated.sourceIndex)).toEqual([id]);
  });

  it("removes fabricated contacts, locations and sourced facts at the deterministic authority boundary", () => {
    const corpus = buildCompanyCorpus([
      page(
        1,
        "/contact",
        "Contact help@example.test. London office. Refunds are available within 14 days.",
        "contact"
      ),
    ]);
    const id = corpus.pages[0].pageId;
    const validated = validateCompanyKnowledgePack(
      basePack({
        contacts: [
          {
            type: "email",
            value: "help@example.test",
            label: "Help",
            sourcePageIds: [id],
          },
          {
            type: "email",
            value: "invented@example.test",
            label: "Invented",
            sourcePageIds: [id],
          },
        ],
        locations: [
          { name: "London office", address: "", sourcePageIds: [id] },
          { name: "Paris office", address: "", sourcePageIds: [id] },
        ],
        policies: [
          {
            title: "Refunds",
            details: "Refunds are available within 14 days.",
            sourcePageIds: [id],
          },
          {
            title: "Lifetime guarantee",
            details: "All purchases have a lifetime guarantee.",
            sourcePageIds: [id],
          },
        ],
      }),
      corpus
    );
    expect(validated.contacts.map(item => item.value)).toEqual([
      "help@example.test",
    ]);
    expect(validated.locations.map(item => item.name)).toEqual([
      "London office",
    ]);
    expect(validated.policies.map(item => item.title)).toEqual(["Refunds"]);
  });

  it("keeps deposits, monthly finance, exam fees and alternative plans distinct and rejects salary as price", () => {
    const corpus = buildCompanyCorpus([
      page(
        1,
        "/programme/data",
        "Data Programme. Standard plan and full price £2,999. Deposit £299. Finance £149 per month. Exam fee £120. Graduate salary £50,000. Premium plan £3,499."
      ),
    ]);
    const id = corpus.pages[0].pageId;
    const candidate = offering("data", "Data Programme", id, "£2,999");
    candidate.type = "individual_course";
    candidate.plans = ["Standard", "Premium"];
    candidate.prices = [
      {
        value: "£2,999",
        semanticType: "full_current_price",
        label: "Standard full price",
        sourcePageIds: [id],
      },
      {
        value: "£299",
        semanticType: "full_current_price",
        label: "Deposit",
        sourcePageIds: [id],
      },
      {
        value: "£149",
        semanticType: "full_current_price",
        label: "Monthly finance",
        sourcePageIds: [id],
      },
      {
        value: "£120",
        semanticType: "full_current_price",
        label: "Exam fee",
        sourcePageIds: [id],
      },
      {
        value: "£50,000",
        semanticType: "full_current_price",
        label: "Salary",
        sourcePageIds: [id],
      },
      {
        value: "£3,499",
        semanticType: "alternative_plan",
        label: "Premium plan",
        sourcePageIds: [id],
      },
    ];
    const validated = validateCompanyKnowledgePack(
      basePack({ offerings: [candidate] }),
      corpus
    );
    expect(
      validated.offerings[0].prices.map(item => item.semanticType)
    ).toEqual([
      "full_current_price",
      "deposit",
      "finance_payment_plan",
      "other_fee",
      "alternative_plan",
    ]);
    expect(
      validated.offerings[0].prices.some(item => item.value === "£50,000")
    ).toBe(false);
    expect(validated.offerings[0].plans).toEqual(["Standard", "Premium"]);
  });

  it("does not promote category or editorial career-path pages as offerings", () => {
    const corpus = buildCompanyCorpus([
      page(
        1,
        "/courses",
        "Course catalogue. Browse Alpha Course and Beta Course."
      ),
      page(
        2,
        "/career-path/data",
        "Data career path editorial guide. Salary £50,000."
      ),
      page(3, "/course/alpha", "Alpha Course. Full price £719."),
      page(
        4,
        "/programme/data-career",
        "Data Career Programme. Full price £2,999."
      ),
    ]);
    const ids = Object.fromEntries(
      corpus.pages.map(item => [new URL(item.url).pathname, item.pageId])
    );
    const categoryId = ids["/courses"];
    const editorialId = ids["/career-path/data"];
    const courseId = ids["/course/alpha"];
    const programmeId = ids["/programme/data-career"];
    const category = offering("category", "Course catalogue", categoryId);
    const editorial = {
      ...offering("editorial", "Data career path", editorialId),
      type: "career_programme" as const,
    };
    const course = offering("course", "Alpha Course", courseId);
    const programme = {
      ...offering("programme", "Data Career Programme", programmeId, "£2,999"),
      type: "career_programme" as const,
    };
    const validated = validateCompanyKnowledgePack(
      basePack({ offerings: [category, editorial, course, programme] }),
      corpus
    );
    expect(validated.offerings.map(item => [item.name, item.type])).toEqual([
      ["Alpha Course", "individual_course"],
      ["Data Career Programme", "career_programme"],
    ]);
  });

  it("applies critic additions and preserves whole-corpus finance, contacts, certification, support and policy facts", async () => {
    const pages = [
      page(
        1,
        "/",
        "Example Learning. Call +44 20 1234 5678 or email hello@example.test.",
        "about"
      ),
      page(
        2,
        "/course/alpha",
        "Alpha Course. Full price £719. Mentor support included."
      ),
      page(
        3,
        "/course/beta",
        "Beta Course. Full price £1,029. Accredited by Skills Board."
      ),
      page(4, "/finance", "Finance options. Pay £99 per month.", "finance"),
      page(
        5,
        "/refund-policy",
        "Refund policy. Cancel within 14 days.",
        "policies"
      ),
    ];
    const corpus = buildCompanyCorpus(pages);
    const ids = Object.fromEntries(
      corpus.pages.map(item => [new URL(item.url).pathname, item.pageId])
    );
    const draft = basePack({
      company: {
        name: "Example Learning",
        legalName: "",
        description: "",
        sourcePageIds: [ids["/"]],
      },
      offerings: [offering("alpha", "Alpha Course", ids["/course/alpha"])],
      contacts: [
        {
          type: "email",
          value: "hello@example.test",
          label: "Sales",
          sourcePageIds: [ids["/"]],
        },
      ],
      finance: [
        {
          title: "Finance options",
          details: "Pay £99 per month.",
          sourcePageIds: [ids["/finance"]],
        },
      ],
      certificationsAndAccreditation: [
        {
          title: "Skills Board",
          details: "Accredited by Skills Board.",
          sourcePageIds: [ids["/course/beta"]],
        },
      ],
      supportAndOutcomes: [
        {
          title: "Mentor support",
          details: "Mentor support included.",
          sourcePageIds: [ids["/course/alpha"]],
        },
      ],
      policies: [
        {
          title: "Refund policy",
          details: "Cancel within 14 days.",
          sourcePageIds: [ids["/refund-policy"]],
        },
      ],
    });
    const model: WholeSiteLearningModel = {
      async analyse() {
        return draft;
      },
      async audit() {
        return companyKnowledgeAuditSchema.parse({
          addOfferings: [
            offering("beta", "Beta Course", ids["/course/beta"], "£1,029"),
          ],
        });
      },
    };
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 1,
      pages,
      reference: "critic",
      model,
    });
    expect(result.pack.offerings.map(item => item.name)).toEqual([
      "Alpha Course",
      "Beta Course",
    ]);
    expect(result.completeness).toMatchObject({
      financeInformationFound: true,
      contactInformationFound: true,
      certificationInformationFound: true,
      supportAndOutcomeInformationFound: true,
      policyTermsInformationFound: true,
    });
  });

  it("surfaces conflicting first-party full prices instead of deleting the offering", () => {
    const corpus = buildCompanyCorpus([
      page(1, "/programme/data", "Data Programme. Full price £2,499."),
      page(
        2,
        "/pricing/data",
        "Data Programme advertised full price £2,999.",
        "pricing"
      ),
    ]);
    const ids = Object.fromEntries(
      corpus.pages.map(item => [new URL(item.url).pathname, item.pageId])
    );
    const item = offering(
      "data",
      "Data Programme",
      ids["/programme/data"],
      "£2,499"
    );
    item.sourcePageIds = Object.values(ids);
    item.prices.push({
      value: "£2,999",
      semanticType: "full_current_price",
      label: "Advertised full price",
      sourcePageIds: [ids["/pricing/data"]],
    });
    const validated = validateCompanyKnowledgePack(
      basePack({ offerings: [item] }),
      corpus
    );
    expect(validated.offerings).toHaveLength(1);
    expect(validated.conflicts).toHaveLength(1);
    expect(validated.conflicts[0].values).toEqual(["£2,499", "£2,999"]);
  });

  it("allows only one bounded schema repair", async () => {
    const pages = [
      page(
        1,
        "/course/alpha",
        "Alpha Course. Full price £719. Duration 12 months."
      ),
    ];
    let repairs = 0;
    const corpus = buildCompanyCorpus(pages);
    const id = corpus.pages[0].pageId;
    const model: WholeSiteLearningModel = {
      async analyse() {
        return "not json";
      },
      async audit() {
        return companyKnowledgeAuditSchema.parse({});
      },
      async repair() {
        repairs += 1;
        return {
          result: {
            ...basePack(),
            offerings: [
              {
                ...offering("alpha", "Alpha Course", id),
                duration: { value: "12", unit: "months" },
              },
            ],
          },
        };
      },
    };
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 1,
      pages,
      reference: "repair",
      model,
    });
    expect(repairs).toBe(1);
    expect(result.repairCalls).toBe(1);
    expect(result.normalizationEvents).toBeGreaterThan(0);
    expect(result.pack.offerings[0].duration).toEqual(["12 months"]);
    expect(result.totalAiCalls).toBe(3);
  });

  it("resumes from an analyst checkpoint without buying the successful pass again", async () => {
    const pages = [page(1, "/course/alpha", "Alpha Course. Full price £719.")];
    const corpus = buildCompanyCorpus(pages);
    const draft = basePack({
      offerings: [offering("alpha", "Alpha Course", corpus.pages[0].pageId)],
    });
    let analyses = 0;
    let audits = 0;
    const model: WholeSiteLearningModel = {
      async analyse() {
        analyses += 1;
        return draft;
      },
      async audit() {
        audits += 1;
        return companyKnowledgeAuditSchema.parse({});
      },
    };
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 1,
      pages,
      reference: "resume",
      model,
      resume: { corpus, draft },
    });
    expect(analyses).toBe(0);
    expect(audits).toBe(1);
    expect(result.totalAiCalls).toBe(1);
  });
});
