import { describe, expect, it } from "vitest";
import type { CompanyIntelligenceReviewItem } from "./companyIntelligenceReview";
import {
  buildCompanyPageInventory,
  synthesiseCompanyKnowledge,
  type CompanyKnowledgeModel,
  type ReviewPage,
} from "./companyKnowledgeSynthesis";

const fetchedAt = "2026-08-28T08:00:00.000Z";

function page(path: string, title: string, text: string): ReviewPage {
  return {
    url: `https://example.test${path}`,
    title,
    fetchedAt,
    text: `${text} ${"Complete first-party page evidence. ".repeat(8)}`,
    headings: [title],
    links: [],
    jsonLd: [],
  };
}

function fact(
  source: ReviewPage,
  classification: CompanyIntelligenceReviewItem["classification"],
  title: string,
  evidenceText: string
): CompanyIntelligenceReviewItem {
  return {
    classification,
    title,
    summary: evidenceText,
    sourceUrls: [source.url],
    pageTitle: source.title,
    fetchedAt: source.fetchedAt,
    evidenceText,
    confidence: "high",
    reviewState: "review_required",
    trustEligible: true,
  };
}

function offering(
  source: ReviewPage,
  name: string,
  type: "career_programme" | "individual_course",
  options: {
    fullPrice?: string;
    deposit?: string;
    planName?: string;
    alternativePrice?: string;
  } = {}
): CompanyIntelligenceReviewItem {
  const priceFacts: NonNullable<CompanyIntelligenceReviewItem["offering"]>["prices"] = [];
  if (options.fullPrice)
    priceFacts.push({
      value: options.fullPrice,
      semanticType: "full_current_price",
      label: `Current full price ${options.fullPrice}`,
      sourceUrl: source.url,
      evidenceText: `${name} current full price ${options.fullPrice}`,
    });
  if (options.deposit)
    priceFacts.push({
      value: options.deposit,
      semanticType: "deposit",
      label: `Deposit ${options.deposit}`,
      sourceUrl: source.url,
      evidenceText: `${name} deposit ${options.deposit}`,
    });
  if (options.alternativePrice)
    priceFacts.push({
      value: options.alternativePrice,
      semanticType: "alternative_plan",
      label: `Retake Cover ${options.alternativePrice}`,
      sourceUrl: source.url,
      evidenceText: `${name} Retake Cover ${options.alternativePrice}`,
    });
  const evidenceText = priceFacts[0]?.evidenceText || `${name} is available`;
  return {
    classification: "company_offering",
    title: name,
    summary: evidenceText,
    sourceUrls: [source.url],
    pageTitle: source.title,
    fetchedAt: source.fetchedAt,
    evidenceText,
    confidence: "high",
    reviewState: "review_required",
    trustEligible: true,
    offering: {
      name,
      type,
      planName: options.planName,
      prices: priceFacts,
      currentPrices: options.fullPrice ? [options.fullPrice] : [],
    },
  };
}

function corpus100() {
  const pages: ReviewPage[] = [
    page("/", "Example Learning", "Example Learning provides career training and individual courses."),
  ];
  for (let index = 1; index <= 8; index += 1) {
    const name = `Career Programme ${index}`;
    pages.push(page(
      `/job-programmes/program-${index}`,
      name,
      `${name} is available. ${name} current full price ${index === 1 ? "£1,000" : `£1,${index}00`}. Career support and certification included.`
    ));
  }
  for (let index = 1; index <= 45; index += 1) {
    const name = `Individual Course ${index}`;
    pages.push(page(
      `/courses/course-${index}`,
      name,
      index === 1
        ? `${name} is available. ${name} deposit £50. Typical salary £50,000.`
        : `${name} is available. ${name} current full price £${200 + index}.`
    ));
  }
  pages.push(
    page("/courses", "All Courses", "Browse courses in our complete course catalogue."),
    page("/pricing", "Programme Pricing", "Career Programme 1 current full price £1,200. Career Programme 1 Retake Cover £300."),
    page("/finance", "Finance", "Finance is available with monthly payments and a £50 deposit."),
    page("/contact", "Contact", "Contact Example Learning at sales@example.test or 020 7000 0000."),
    page("/terms", "Terms and Refunds", "Cancellation requires notice. Refunds follow the published terms."),
    page("/certifications", "Certifications", "Qualifications are awarded by Example Awarding Body."),
    page("/career-support", "Career Support", "Recruitment support includes CV review and interview coaching."),
    page("/faq", "Frequently Asked Questions", "Frequently asked questions about access and study."),
    page("/about", "About Example Learning", "Example Learning is a training company."),
  );
  while (pages.length < 100) {
    const index = pages.length;
    pages.push(page(`/blog/reference-${index}`, `Career reference ${index}`, "Editorial career path guide comparing other providers."));
  }
  return pages;
}

function fixtureModel(options: { missingUrl?: string; failUrl?: string } = {}) {
  let active = 0;
  let maxActive = 0;
  const calls = new Map<string, number>();
  const model: CompanyKnowledgeModel = {
    async mapPage({ page: source, inventory }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.set(source.url, (calls.get(source.url) || 0) + 1);
      await Promise.resolve();
      active -= 1;
      if (source.url === options.failUrl) throw new Error("malformed map response");
      if (source.url === options.missingUrl) return [];
      if (inventory.primaryDisposition === "category_index")
        return [offering(source, "All Courses", "individual_course")];
      const programme = source.url.match(/program-(\d+)/)?.[1];
      if (programme) {
        const name = `Career Programme ${programme}`;
        return [offering(source, name, "career_programme", {
          fullPrice: programme === "1" ? "£1,000" : `£1,${programme}00`,
        })];
      }
      const course = source.url.match(/course-(\d+)/)?.[1];
      if (course) {
        const name = `Individual Course ${course}`;
        return [offering(source, name, "individual_course", course === "1"
          ? { deposit: "£50" }
          : { fullPrice: `£${200 + Number(course)}` })];
      }
      if (source.url.endsWith("/pricing"))
        return [
          offering(source, "Career Programme 1", "career_programme", { fullPrice: "£1,200" }),
          offering(source, "Career Programme 1", "career_programme", { alternativePrice: "£300", planName: "Retake Cover" }),
        ];
      if (source.url.endsWith("/finance")) return [fact(source, "company_finance", "Finance", "Finance is available with monthly payments and a £50 deposit.")];
      if (source.url.endsWith("/contact")) return [fact(source, "company_contact", "Contact", "Contact Example Learning at sales@example.test or 020 7000 0000.")];
      if (source.url.endsWith("/terms")) return [fact(source, "company_policy", "Terms and refunds", "Cancellation requires notice. Refunds follow the published terms.")];
      if (source.url.endsWith("/certifications")) return [fact(source, "company_certification", "Awarding body", "Qualifications are awarded by Example Awarding Body.")];
      if (source.url.endsWith("/career-support")) return [fact(source, "company_support", "Career support", "Recruitment support includes CV review and interview coaching.")];
      if (source.url.endsWith("/faq")) return [fact(source, "company_faq", "FAQs", "Frequently asked questions about access and study.")];
      if (source.url === "https://example.test/" || source.url.endsWith("/about")) return [fact(source, "company_overview", "Company overview", source.url === "https://example.test/" ? "Example Learning provides career training and individual courses." : "Example Learning is a training company.")];
      return [];
    },
    async reconcile() {
      return { exclude: [], duplicateGroups: [], conflicts: [], warnings: [] };
    },
  };
  return { model, calls, maxActive: () => maxActive };
}

describe("complete company knowledge map/reduce pipeline", () => {
  it("inventories all 100 pages and maps every relevant page without the old 32-page cap", async () => {
    const pages = corpus100();
    const fixture = fixtureModel();
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 9,
      pages,
      reference: "fixture-complete",
      model: fixture.model,
      mapConcurrency: 3,
    });

    expect(result.pageInventory).toHaveLength(100);
    expect(result.mapResults.filter(item => item.status === "completed").length).toBeGreaterThan(32);
    expect(result.mapResults).toHaveLength(100);
    expect(fixture.maxActive()).toBeLessThanOrEqual(3);
    expect(result.completeness.pagesScanned).toBe(100);
    expect(result.completeness.pagesClassified).toBe(100);
    expect(result.completeness.careerProgrammesDiscovered).toBe(8);
    expect(result.completeness.individualCoursesDiscovered).toBe(45);
    expect(result.pageInventory.filter(item => item.excludedReason)).toHaveLength(37);
    expect(result.items.some(item => item.offering?.name === "All Courses" && item.trustEligible)).toBe(false);
    expect(result.items.some(item => /reference/i.test(item.title) && item.classification === "company_offering")).toBe(false);
  });

  it("preserves price semantics, provenance, support pages and genuine conflicts", async () => {
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 9,
      pages: corpus100(),
      reference: "fixture-semantics",
      model: fixtureModel().model,
    });

    const courseOne = result.items.find(item => item.offering?.name === "Individual Course 1");
    expect(courseOne?.offering?.currentPrices).toEqual([]);
    expect(courseOne?.offering?.prices?.[0]?.semanticType).toBe("deposit");
    expect(JSON.stringify(courseOne)).not.toContain("£50,000");
    const standard = result.items.find(item => item.offering?.name === "Career Programme 1" && !item.offering?.planName);
    const retake = result.items.find(item => item.offering?.planName === "Retake Cover");
    expect(standard?.reviewState).toBe("conflict");
    expect(standard?.offering?.currentPrices).toEqual(["£1,000", "£1,200"]);
    expect(standard?.sourceUrls).toHaveLength(2);
    expect(retake?.offering?.prices?.[0]?.semanticType).toBe("alternative_plan");
    expect(retake?.offering?.currentPrices).toEqual([]);
    expect(result.completeness.financeInformationFound).toBe(true);
    expect(result.completeness.contactInformationFound).toBe(true);
    expect(result.completeness.policyTermsInformationFound).toBe(true);
    expect(result.completeness.certificationInformationFound).toBe(true);
    expect(result.completeness.supportAndOutcomeInformationFound).toBe(true);
    expect(result.completeness.status).toBe("complete_with_conflicts");
    expect(result.conflicts).toHaveLength(1);
  });

  it("marks the pack incomplete when a likely offering page has no mapped offering", async () => {
    const missingUrl = "https://example.test/courses/course-45";
    const result = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 9,
      pages: corpus100(),
      reference: "fixture-missing",
      model: fixtureModel({ missingUrl }).model,
    });
    expect(result.completeness.status).toBe("incomplete");
    expect(result.completeness.importantGaps.join(" ")).toContain("likely sellable offering page");
  });

  it("retains completed maps and retries only the failed portion", async () => {
    const failUrl = "https://example.test/courses/course-45";
    const firstFixture = fixtureModel({ failUrl });
    const first = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 9,
      pages: corpus100(),
      reference: "fixture-partial",
      model: firstFixture.model,
    });
    expect(first.completeness.status).toBe("incomplete");
    expect(first.mapResults.find(item => item.pageUrl === failUrl)?.status).toBe("failed");
    expect(first.items.some(item => item.offering?.name === "Individual Course 44")).toBe(true);

    const retryFixture = fixtureModel();
    const retried = await synthesiseCompanyKnowledge({
      userId: 1,
      organisationId: 9,
      pages: corpus100(),
      reference: "fixture-partial-retry",
      model: retryFixture.model,
      resumeMapResults: first.mapResults,
    });
    expect(retryFixture.calls.get(failUrl)).toBe(1);
    expect(Array.from(retryFixture.calls.values()).reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(retried.mapResults.every(item => item.status !== "failed")).toBe(true);
    expect(retried.completeness.status).toBe("complete_with_conflicts");
  });
});

describe("deterministic company page inventory", () => {
  it("accounts for noise and duplicates with explicit exclusion reasons", () => {
    const duplicateText = "A complete product detail with enough unique text to classify and compare safely. ".repeat(4);
    const inventory = buildCompanyPageInventory([
      page("/services/one", "Service One", duplicateText),
      page("/services/two", "Service Two", duplicateText),
      page("/blog/comparison", "Competitor comparison", "Compare our competitor with another provider."),
    ]);
    expect(inventory).toHaveLength(3);
    expect(inventory[1].primaryDisposition).toBe("duplicate");
    expect(inventory[1].excludedReason).toContain("Duplicate");
    expect(inventory[2].primaryDisposition).toBe("comparison_competitor_reference");
    expect(inventory[2].excludedReason).toBeTruthy();
  });
});
