import { describe, expect, it } from "vitest";
import { applyDeterministicWebsiteConflicts } from "./companyWebsiteReasoner";
import type { CompanyIntelligenceReviewItem } from "./companyIntelligenceReview";

function item(
  price: string,
  sourceUrl: string
): CompanyIntelligenceReviewItem {
  return {
    classification: "company_offering",
    title: "Cyber Security Programme",
    summary: "Current Cyber Security Programme information.",
    sourceUrls: [sourceUrl],
    pageTitle: "Cyber Security Programme",
    fetchedAt: "2026-08-26T18:00:00.000Z",
    evidenceText: `Cyber Security Programme ${price}`,
    confidence: "high",
    reviewState: "review_required",
    trustEligible: true,
    offering: {
      name: "Cyber Security Programme",
      currentPrices: [price],
    },
  };
}

describe("holistic website intelligence safeguards", () => {
  it("keeps matching current prices eligible", () => {
    const result = applyDeterministicWebsiteConflicts([
      item("£1,899", "https://example.test/cyber"),
      item("£1,899.00", "https://example.test/pricing"),
    ]);
    expect(result.every(candidate => candidate.trustEligible)).toBe(true);
    expect(result.every(candidate => candidate.reviewState === "review_required")).toBe(true);
  });

  it("fails closed when current first-party prices conflict", () => {
    const result = applyDeterministicWebsiteConflicts([
      item("£1,899", "https://example.test/cyber"),
      item("£2,499", "https://example.test/pricing"),
    ]);
    expect(result.every(candidate => candidate.trustEligible === false)).toBe(true);
    expect(result.every(candidate => candidate.reviewState === "conflict")).toBe(true);
  });
});
