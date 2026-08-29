import { describe, expect, it } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import {
  canonicalizeCompanyKnowledgeOutput,
  CompanyKnowledgeOutputError,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";
import { parsePartialCompanyKnowledgeBatch } from "./companyKnowledgePartialBatchRuntime";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  validateCompanyKnowledgePack,
} from "./companyKnowledgeSynthesis";

const PAGE = "PAGE_0001";
const URL = "https://www.example.test/course/alpha";

function offering(overrides: Record<string, unknown> = {}) {
  return {
    id: "alpha-course",
    name: "Alpha Course",
    type: "individual_course",
    description: "Source-backed training",
    plans: [],
    prices: [
      {
        value: "£999",
        semanticType: "full_current_price",
        label: "Full course price",
        sourcePageIds: [PAGE],
      },
    ],
    duration: ["12 months"],
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
    ...overrides,
  };
}

function pack(overrides: Record<string, unknown> = {}) {
  return {
    company: {
      name: "Example Learning",
      legalName: "",
      description: "Source-backed training company",
      sourcePageIds: [PAGE],
    },
    contacts: [],
    locations: [],
    offerings: [offering()],
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
    sourceIndex: { [PAGE]: URL },
    ...overrides,
  };
}

function parseFull(raw: unknown) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "full_analysis",
    schema: companyKnowledgePackSchema,
    context: {
      phase: "analysis",
      batchIndex: 1,
      batchTotal: 1,
      pageIds: [PAGE, "PAGE_0002"],
    },
  });
}

function parseAudit(raw: unknown) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "audit",
    schema: companyKnowledgeAuditSchema,
    context: {
      phase: "audit",
      batchIndex: 1,
      batchTotal: 1,
      pageIds: [PAGE, "PAGE_0002"],
    },
  });
}

describe("canonical company-learning model-output boundary", () => {
  it("accepts the canonical response without normalization", () => {
    const parsed = parseFull(pack());
    expect(parsed.data.offerings[0].name).toBe("Alpha Course");
    expect(parsed.normalizationActions).toEqual([]);
  });

  it.each([
    ["one-key result wrapper", { result: pack() }],
    ["one-key data wrapper", { data: pack() }],
    ["one-key output wrapper", { output: pack() }],
  ])("unwraps %s", (_name, input) => {
    const parsed = parseFull(input);
    expect(parsed.data.company.name).toBe("Example Learning");
    expect(
      parsed.normalizationActions.some(item => item.includes("unwrapped"))
    ).toBe(true);
  });

  it("removes a Markdown JSON fence", () => {
    const parsed = parseFull(`\`\`\`json\n${JSON.stringify(pack())}\n\`\`\``);
    expect(parsed.data.offerings).toHaveLength(1);
    expect(parsed.normalizationActions).toContain(
      "$:removed_markdown_json_fence"
    );
  });

  it("does not unwrap a legitimate canonical single audit key", () => {
    const parsed = parseAudit({
      importantGaps: { text: "Confirm current price" },
    });
    expect(parsed.data.importantGaps).toEqual(["Confirm current price"]);
  });

  it("normalizes nullable optional arrays to empty arrays", () => {
    const parsed = parseAudit({
      addContacts: null,
      addPolicies: null,
      importantGaps: null,
    });
    expect(parsed.data.addContacts).toEqual([]);
    expect(parsed.data.addPolicies).toEqual([]);
    expect(parsed.data.importantGaps).toEqual([]);
  });

  it("accepts a legitimate partial batch with no company and removes a blank company placeholder", () => {
    expect(
      parsePartialCompanyKnowledgeBatch({ offerings: [offering()] }).company
    ).toBeUndefined();
    const parsed = parsePartialCompanyKnowledgeBatch({
      company: { name: "", legalName: "", description: "", sourcePageIds: [] },
      offerings: [offering()],
    });
    expect(parsed.company).toBeUndefined();
  });

  it.each([
    [
      "structured duration",
      { duration: [{ value: "12", unit: "months" }] },
      ["12 months"],
    ],
    ["scalar duration", { duration: "12 months" }, ["12 months"]],
    ["structured plan", { plans: [{ label: "Premium" }] }, ["Premium"]],
    [
      "structured included course",
      { includedCourses: [{ name: "Module A" }] },
      ["Module A"],
    ],
    [
      "structured included exam",
      { includedExams: [{ label: "Exam A" }] },
      ["Exam A"],
    ],
    [
      "structured support",
      { support: [{ text: "Tutor support" }] },
      ["Tutor support"],
    ],
    [
      "structured certification",
      { certifications: { label: "CompTIA A+" } },
      ["CompTIA A+"],
    ],
    [
      "structured awarding body",
      { awardingBodies: { name: "CompTIA" } },
      ["CompTIA"],
    ],
    [
      "structured finance option",
      { financeOptions: { details: "Monthly plan" } },
      ["Monthly plan"],
    ],
    [
      "structured requirement",
      { entryRequirements: { text: "No experience required" } },
      ["No experience required"],
    ],
    [
      "structured outcome",
      { outcomes: [{ description: "Job-ready skills" }] },
      ["Job-ready skills"],
    ],
    [
      "structured caveat",
      { caveats: [{ text: "Exam voucher excluded" }] },
      ["Exam voucher excluded"],
    ],
  ])("normalizes %s without a repair", (_name, variation, expected) => {
    const parsed = parseFull(pack({ offerings: [offering(variation)] }));
    const key = Object.keys(
      variation
    )[0] as keyof (typeof parsed.data.offerings)[0];
    expect(parsed.data.offerings[0][key]).toEqual(expected);
    expect(parsed.normalizationActions.length).toBeGreaterThan(0);
  });

  it("drops an unrepresentable nested text object instead of inventing prose", () => {
    const parsed = parseFull(
      pack({
        offerings: [offering({ duration: [{ nested: { value: "guess" } }] })],
      })
    );
    expect(parsed.data.offerings[0].duration).toEqual([]);
    expect(JSON.stringify(parsed.data)).not.toContain("nested:");
  });

  it("normalizes scalar PAGE provenance but rejects an invalid PAGE id", () => {
    expect(
      parseFull(pack({ company: { ...pack().company, sourcePageIds: PAGE } }))
        .data.company.sourcePageIds
    ).toEqual([PAGE]);
    expect(() =>
      parseFull(
        pack({ company: { ...pack().company, sourcePageIds: "PAGE_12" } })
      )
    ).toThrow(CompanyKnowledgeOutputError);
    expect(() =>
      parseCanonicalCompanyKnowledgeOutput({
        raw: pack({
          company: { ...pack().company, sourcePageIds: "PAGE_9999" },
        }),
        mode: "full_analysis",
        schema: companyKnowledgePackSchema,
        context: { phase: "analysis", pageIds: [PAGE] },
      })
    ).toThrow(/outside its bounded batch/i);
  });

  it("accepts a real source URL and rejects placeholder or non-HTTP URLs", () => {
    expect(parseFull(pack()).data.sourceIndex[PAGE]).toBe(URL);
    for (const invalid of ["https://...", "file:///tmp/source", "not-a-url"])
      expect(() =>
        parseFull(pack({ sourceIndex: { [PAGE]: invalid } }))
      ).toThrow(CompanyKnowledgeOutputError);
  });

  it("strips blank contact and sourced-fact placeholders", () => {
    const parsed = parseFull(
      pack({
        contacts: [
          { type: "email", value: "", label: "", sourcePageIds: [PAGE] },
        ],
        finance: [{ title: "", details: "", sourcePageIds: [PAGE] }],
      })
    );
    expect(parsed.data.contacts).toEqual([]);
    expect(parsed.data.finance).toEqual([]);
  });

  it("normalizes structured conflict values and important gaps", () => {
    const parsed = parseFull(
      pack({
        conflicts: [
          {
            subject: { text: "Alpha price" },
            values: [{ value: "£999" }, { label: "£799" }],
            sourcePageIds: [PAGE, "PAGE_0002"],
            explanation: { details: "First-party pages disagree" },
          },
        ],
        importantGaps: { text: "Confirm current price" },
      })
    );
    expect(parsed.data.conflicts[0].values).toEqual(["£999", "£799"]);
    expect(parsed.data.importantGaps).toEqual(["Confirm current price"]);
  });

  it("normalizes every audit patch family at the same boundary", () => {
    const parsed = parseAudit({
      result: {
        addOfferings: {
          ...offering(),
          duration: { value: "12", unit: "months" },
        },
        replaceOfferings: {
          ...offering({ id: "replacement" }),
          support: { text: "Mentor" },
        },
        addFinance: {
          title: { label: "Finance" },
          details: { text: "Monthly plan" },
          sourcePageIds: PAGE,
        },
        addCertificationsAndAccreditation: {
          title: "Accreditation",
          details: { text: "Awarded" },
          sourcePageIds: PAGE,
        },
        addSupportAndOutcomes: {
          title: "Support",
          details: { text: "Tutor access" },
          sourcePageIds: PAGE,
        },
        addPolicies: {
          title: "Terms",
          details: { text: "Published terms" },
          sourcePageIds: PAGE,
        },
        addRefundCancellationTerms: {
          title: "Refunds",
          details: { text: "Published refund terms" },
          sourcePageIds: PAGE,
        },
        addContactKnowledge: {
          title: "Contact",
          details: { text: "Use support email" },
          sourcePageIds: PAGE,
        },
        addContacts: {
          type: "email",
          value: { text: "help@example.test" },
          label: { label: "Help" },
          sourcePageIds: PAGE,
        },
        addConflicts: {
          subject: "Price",
          values: [{ value: "£999" }, { value: "£799" }],
          sourcePageIds: [PAGE, "PAGE_0002"],
          explanation: { text: "Published variation" },
        },
        importantGaps: { text: "Confirm price" },
      },
    });
    expect(parsed.data.addOfferings[0].duration).toEqual(["12 months"]);
    expect(parsed.data.replaceOfferings[0].support).toEqual(["Mentor"]);
    expect(parsed.data.addFinance[0].details).toBe("Monthly plan");
    expect(parsed.data.addContacts[0].value).toBe("help@example.test");
    expect(parsed.data.addConflicts[0].values).toEqual(["£999", "£799"]);
    expect(parsed.data.importantGaps).toEqual(["Confirm price"]);
  });

  it("fails closed for malformed JSON and unsupported enums", () => {
    expect(() => parseFull("not json at all")).toThrow(
      CompanyKnowledgeOutputError
    );
    expect(() =>
      parseFull(pack({ offerings: [offering({ type: "made_up_type" })] }))
    ).toThrow(CompanyKnowledgeOutputError);
    expect(() =>
      parseFull(
        pack({
          offerings: [
            offering({
              prices: [
                {
                  value: "£999",
                  semanticType: "sale_price",
                  label: "Price",
                  sourcePageIds: [PAGE],
                },
              ],
            }),
          ],
        })
      )
    ).toThrow(CompanyKnowledgeOutputError);
  });

  it("removes a syntactically valid but unavailable source before it can survive validation", () => {
    const corpus = buildCompanyCorpus([
      {
        url: URL,
        title: "Alpha Course",
        fetchedAt: "2026-08-29T00:00:00.000Z",
        text: "Example Learning offers Alpha Course for £999.",
        category: "course",
        description: "Alpha Course",
        headings: ["Alpha Course"],
        links: [],
        jsonLd: [],
      },
    ]);
    const parsed = companyKnowledgePackSchema.parse(
      pack({ offerings: [offering({ sourcePageIds: ["PAGE_9999"] })] })
    );
    const validated = validateCompanyKnowledgePack(parsed, corpus);
    expect(validated.offerings).toEqual([]);
    expect(validated.importantGaps.join(" ")).toMatch(/removed.*not grounded/i);
  });

  it("exposes bounded diagnostic paths without including raw model output", () => {
    try {
      parseFull(pack({ offerings: [offering({ type: "wrong" })] }));
      throw new Error("expected parse failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CompanyKnowledgeOutputError);
      const diagnostic = (error as CompanyKnowledgeOutputError).diagnostic;
      expect(diagnostic.phase).toBe("analysis");
      expect(diagnostic.batchIndex).toBe(1);
      expect(diagnostic.pageIds).toEqual([PAGE, "PAGE_0002"]);
      expect(diagnostic.schemaErrorPaths.join(" ")).toContain(
        "offerings[0].type"
      );
      expect(JSON.stringify(diagnostic)).not.toContain(
        "Source-backed training company"
      );
    }
  });

  it("keeps canonicalization deterministic for the same untrusted response", () => {
    const raw = { output: { importantGaps: [{ text: "Review this" }] } };
    expect(canonicalizeCompanyKnowledgeOutput(raw, "audit")).toEqual(
      canonicalizeCompanyKnowledgeOutput(raw, "audit")
    );
  });
});
