import { describe, expect, it } from "vitest";
import { buildCompanyCorpus } from "./companyKnowledgeCorpus";
import { finaliseCompanyKnowledgeRuntimeResult } from "./companyKnowledgeRuntimeFinalization";
import {
  companyKnowledgePackSchema,
  type CompanyKnowledgeCompleteness,
  type CompanyKnowledgeSynthesisResult,
  type CompanyOffering,
} from "./companyKnowledgeSynthesis";

function inputPage(
  url: string,
  title: string,
  heading: string,
  category = "courses"
) {
  return {
    url,
    title,
    fetchedAt: "2026-08-30T18:00:00.000Z",
    text: `${heading}. First-party Course2Career page content.`,
    category,
    description: null,
    headings: [heading],
    links: [],
    jsonLd: [],
  };
}

function offering(
  id: string,
  name: string,
  sourcePageId: string
): CompanyOffering {
  return {
    id,
    name,
    type: "individual_course",
    description: "",
    plans: [],
    prices: [],
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
    sourcePageIds: [sourcePageId],
  };
}

function completeness(overrides: Partial<CompanyKnowledgeCompleteness> = {}) {
  return {
    status: "incomplete" as const,
    pagesDiscovered: 99,
    pagesScanned: 99,
    pagesCrawled: 99,
    pagesSuccessfullyRead: 99,
    pagesClassified: 99,
    pagesUsedAsEvidence: 1,
    pagesUsed: 1,
    pagesExcludedWithReason: 0,
    pagesExcluded: 0,
    candidateSellableOfferingsDiscovered: 12,
    careerProgrammesDiscovered: 0,
    individualCoursesDiscovered: 5,
    finalProposedOfferings: 5,
    offeringsFound: 5,
    offeringsWithEvidencedFullPrice: 0,
    offeringsWithPublishedPrice: 0,
    offeringsWithoutEvidencedFullPrice: 5,
    financeInformationFound: true,
    contactInformationFound: true,
    certificationInformationFound: true,
    supportAndOutcomeInformationFound: true,
    policyTermsInformationFound: false,
    conflictsFound: 2,
    unresolvedConflicts: 2,
    importantGaps: [
      "A real review gap remains visible.",
      "12 likely offering page(s) were not represented in the final pack.",
    ],
    ...overrides,
  } satisfies CompanyKnowledgeCompleteness;
}

function resultForCourse2CareerFixture(): CompanyKnowledgeSynthesisResult {
  const special = [
    inputPage(
      "https://www.course2career.com/career-programme-vs-university-degree",
      "Career Programme vs University Degree UK | The Real Cost | Course 2 Career",
      "Career programme or university degree?"
    ),
    inputPage(
      "https://www.course2career.com/courses/accounting/accounting-bookkeeping-beginners",
      "Accounting & Bookkeeping Course For Beginners",
      "Accounting & Bookkeeping Course For Beginners"
    ),
    inputPage(
      "https://www.course2career.com/courses/accounting/ultimate-intuit-quickbooks-bundle-2020",
      "Ultimate INTUIT® QuickBooks® Bundle: 2020",
      "Ultimate INTUIT® QuickBooks® Bundle: 2020"
    ),
    inputPage(
      "https://www.course2career.com/courses/artificial-intelligence",
      "Artificial-intelligence Courses & Training",
      "Artificial Intelligence"
    ),
    inputPage(
      "https://www.course2career.com/courses/programmer",
      "Programmer Courses & Training",
      "Programmer"
    ),
    inputPage(
      "https://www.course2career.com/courses/project-management/apm-pfq-project-management-fundamentals",
      "APM - PFQ: Project Management Fundamentals",
      "APM - PFQ: Project Management Fundamentals"
    ),
    inputPage(
      "https://www.course2career.com/courses/project-management/capm",
      "Certified Associate in Project Management (CAPM)®",
      "Certified Associate in Project Management (CAPM)®"
    ),
    inputPage(
      "https://www.course2career.com/finance-terms",
      "Finance Options | Course 2 Career",
      "Finance Options",
      "finance"
    ),
    inputPage(
      "https://www.course2career.com/job-programmes/cyber-security",
      "Cyber Security Career Programme UK | Job Placement Support | Course 2 Career",
      "Cyber Security Technician Career Programme"
    ),
    inputPage(
      "https://www.course2career.com/job-programmes/data-analyst",
      "Data Analyst Career Programme UK | Job Placement Support | Course 2 Career",
      "Data Analyst Career Programme"
    ),
    inputPage(
      "https://www.course2career.com/job-programmes/it-support",
      "IT Support Career Programme UK | Job Placement Support | Course 2 Career",
      "IT Support Technician Career Programme"
    ),
    inputPage(
      "https://www.course2career.com/job-programmes/project-management",
      "Project Management Career Programme UK | PRINCE2® + Job Placement | Course 2 Career",
      "PRINCE2® Project Management Career Programme Career Programme"
    ),
  ];
  const filler = Array.from({ length: 87 }, (_, index) =>
    inputPage(
      `https://www.course2career.com/about/filler-${String(index).padStart(2, "0")}`,
      `About filler ${index}`,
      `About filler ${index}`,
      "about"
    )
  );
  const corpus = buildCompanyCorpus([...special, ...filler]);
  const byPath = Object.fromEntries(
    corpus.pages.map(page => [new URL(page.url).pathname, page.pageId])
  );
  const safeSource = byPath["/about/filler-00"];
  const offerings = [
    offering(
      "capm-certified-associate-project-management",
      "Certified Associate in Project Management (CAPM)®",
      safeSource
    ),
    offering(
      "cyber-security-career-programme",
      "Cyber Security Career Programme",
      safeSource
    ),
    offering(
      "data-analyst-career-programme",
      "Data Analyst Career Programme",
      safeSource
    ),
    offering(
      "it-support-career-programme",
      "IT Support Career Programme",
      safeSource
    ),
    offering(
      "project-management-career-programme",
      "Project Management Career Programmes",
      safeSource
    ),
  ];
  const conflictPages = [byPath["/about/filler-00"], byPath["/about/filler-01"]];
  const pack = companyKnowledgePackSchema.parse({
    company: {
      name: "Course2Career",
      legalName: "",
      description: "",
      sourcePageIds: [safeSource],
    },
    contacts: [],
    locations: [],
    offerings,
    finance: [],
    certificationsAndAccreditation: [],
    supportAndOutcomes: [],
    policies: [],
    refundCancellationTerms: [],
    contactKnowledge: [],
    faqs: [],
    salesUsefulFacts: [],
    excludedContent: [],
    conflicts: [
      {
        subject: "AI and Data Career Programme current price",
        values: ["£2,999", "£2,999.00"],
        sourcePageIds: conflictPages,
        explanation: "Formatting-only price difference.",
      },
      {
        subject: "CompTIA A+ current price",
        values: ["£529.00", "£229.00"],
        sourcePageIds: conflictPages,
        explanation: "Different evidenced prices.",
      },
    ],
    importantGaps: ["A real review gap remains visible."],
    sourceIndex: {},
  });
  return {
    agentKey: "company_intelligence_review",
    available: true,
    pack,
    corpus,
    completeness: completeness(),
    reviewedAt: "2026-08-30T18:09:13.000Z",
    analysisCalls: 36,
    auditCalls: 36,
    normalizationEvents: 524,
    repairCalls: 3,
    totalAiCalls: 75,
    cleanupFailures: [],
    selectedModelOperations: { analysis: true, audit: true },
  };
}

describe("company knowledge runtime finalization", () => {
  it("fixes the complete verifier #20 coverage class without lowering the threshold or inventing offerings", () => {
    const before = resultForCourse2CareerFixture();
    const originalOfferings = before.pack.offerings.map(item => ({
      name: item.name,
      sourcePageIds: [...item.sourcePageIds],
    }));

    const after = finaliseCompanyKnowledgeRuntimeResult(before);

    expect(after.completeness.status).toBe("complete_with_conflicts");
    expect(after.completeness.candidateSellableOfferingsDiscovered).toBe(8);
    expect(after.completeness.importantGaps).toContain(
      "3 likely offering page(s) were not represented in the final pack."
    );
    expect(after.completeness.importantGaps).not.toContain(
      "12 likely offering page(s) were not represented in the final pack."
    );
    expect(after.completeness.importantGaps).toContain(
      "A real review gap remains visible."
    );
    expect(after.pack.offerings.map(item => ({
      name: item.name,
      sourcePageIds: item.sourcePageIds,
    }))).toEqual(originalOfferings);
    expect(after.pack.conflicts).toHaveLength(1);
    expect(after.pack.conflicts[0].values).toEqual(["£529.00", "£229.00"]);
    expect(after.completeness.conflictsFound).toBe(1);
    expect(after.completeness.unresolvedConflicts).toBe(1);
  });

  it("keeps the unchanged five-percent missing-offering ceiling strict", () => {
    const base = resultForCourse2CareerFixture();
    const replacementMissing = Array.from({ length: 3 }, (_, index) =>
      inputPage(
        `https://www.course2career.com/courses/security/genuine-missing-${index}`,
        `Genuine Missing Course ${index}`,
        `Genuine Missing Course ${index}`
      )
    );
    const retained = base.corpus.pages
      .filter(page => !/\/about\/filler-(84|85|86)$/.test(new URL(page.url).pathname))
      .map(page => ({
        url: page.url,
        title: page.title,
        fetchedAt: page.fetchedAt,
        text: page.text,
        category: page.pageHint,
        description: page.description,
        headings: page.headings,
        links: page.internalLinks,
        jsonLd: page.jsonLd,
      }));
    const corpus = buildCompanyCorpus([...retained, ...replacementMissing]);
    expect(corpus.pageCount).toBe(99);

    const result = {
      ...base,
      corpus,
      completeness: completeness(),
    };

    const after = finaliseCompanyKnowledgeRuntimeResult(result);

    expect(after.completeness.status).toBe("incomplete");
    expect(after.completeness.importantGaps).toContain(
      "6 likely offering page(s) were not represented in the final pack."
    );
  });

  it("never overrides a cleanup failure", () => {
    const result = resultForCourse2CareerFixture();
    result.cleanupFailures = ["session cleanup failed"];
    result.completeness.importantGaps.push(
      "Temporary company-learning resources require cleanup before this job can complete."
    );

    const after = finaliseCompanyKnowledgeRuntimeResult(result);

    expect(after.completeness.status).toBe("incomplete");
    expect(after.completeness.importantGaps).toContain(
      "Temporary company-learning resources require cleanup before this job can complete."
    );
  });
});
