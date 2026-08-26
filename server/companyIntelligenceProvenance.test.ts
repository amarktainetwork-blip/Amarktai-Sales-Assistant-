import { describe, expect, it } from "vitest";
import {
  verifyPageReviewProvenance,
  type CompanyIntelligenceReviewItem,
} from "./companyIntelligenceReview";

const page = {
  url: "https://academy.example/cyber-security",
  title: "Cyber Security Programme",
  fetchedAt: "2026-08-26T12:00:00.000Z",
  text: "Our Cyber Security Programme costs £1,899 and lasts 12 months.",
};

function item(overrides: Partial<CompanyIntelligenceReviewItem> = {}): CompanyIntelligenceReviewItem {
  return {
    classification: "company_offering",
    title: "Cyber Security Programme",
    summary: "Current company programme.",
    sourceUrls: [page.url],
    pageTitle: page.title,
    fetchedAt: page.fetchedAt,
    evidenceText: "Our Cyber Security Programme costs £1,899 and lasts 12 months.",
    confidence: "high",
    reviewState: "review_required",
    trustEligible: true,
    offering: { name: "Cyber Security Programme", currentPrices: ["£1,899"], duration: ["12 months"] },
    ...overrides,
  };
}

describe("company intelligence crawl provenance", () => {
  it("retains a first-party offering whose source, evidence, title, and claims are present in the supplied page", () => {
    expect(verifyPageReviewProvenance(item(), [page]).trustEligible).toBe(true);
  });

  it("rejects a model-supplied URL that was not part of the crawl chunk", () => {
    const result = verifyPageReviewProvenance(item({ sourceUrls: ["https://fake.example/course"] }), [page]);
    expect(result.sourceUrls).toEqual([]);
    expect(result.trustEligible).toBe(false);
    expect(result.reviewState).toBe("ambiguous");
  });

  it("rejects unsupported evidence and unsupported offering values", () => {
    const result = verifyPageReviewProvenance(item({
      evidenceText: "The programme includes an unsupported lifetime guarantee.",
      offering: { name: "Cyber Security Programme", currentPrices: ["£2,500"] },
    }), [page]);
    expect(result.trustEligible).toBe(false);
    expect(result.reviewState).toBe("ambiguous");
  });

  it("accepts normalised punctuation and whitespace but rejects a wrong page title", () => {
    const normalised = verifyPageReviewProvenance(item({ evidenceText: "Our Cyber Security Programme costs £1,899 — and lasts 12 months.".replace(" —", "") }), [page]);
    expect(normalised.trustEligible).toBe(true);
    const wrongTitle = verifyPageReviewProvenance(item({ pageTitle: "Unrelated page" }), [page]);
    expect(wrongTitle.trustEligible).toBe(false);
  });
});
