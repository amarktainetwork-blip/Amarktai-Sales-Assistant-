import { describe, expect, it } from "vitest";
import {
  verifyPageReviewProvenance,
  type CompanyIntelligenceReviewItem,
} from "./companyIntelligenceReview";

const fetchedAt = "2026-08-28T12:00:00.000Z";
const url = "https://www.course2career.com/job-programmes/ai-career";
const pageTitle = "AI and Data Career Programme UK";
const pageText = [
  "AI and Data Career Programme",
  "Standard Plan £2,499",
  "Study for 12 months.",
  "Includes career support.",
  "Standard Plan current full price £2,499.",
].join(" ");

function baseItem(): CompanyIntelligenceReviewItem {
  return {
    classification: "company_offering",
    title: "AI and Data Career Programme",
    summary: "AI career training with extensive support and outcomes.",
    sourceUrls: [url],
    pageTitle,
    fetchedAt,
    evidenceText: "Standard Plan current full price £2,499.",
    confidence: "high",
    reviewState: "review_required",
    trustEligible: true,
    offering: {
      name: "AI and Data Career Programme",
      type: "career_programme",
      description: "An intensive programme that transforms your future.",
      planName: "Standard Plan",
      prices: [
        {
          value: "£2,499",
          semanticType: "full_current_price",
          label: "Complete standard programme fee",
          sourceUrl: url,
          evidenceText: "Standard Plan current full price £2,499.",
        },
      ],
      currentPrices: ["£9,999"],
      duration: ["12 months"],
      support: ["Dedicated unlimited career coaching", "career support"],
      outcomes: ["Guaranteed senior role"],
      targetCustomer: "People who want an AI career",
    },
  };
}

describe("field-level company knowledge provenance", () => {
  it("keeps a grounded offering while stripping unsupported optional paraphrases", () => {
    const result = verifyPageReviewProvenance(baseItem(), [
      { url, title: pageTitle, fetchedAt, text: pageText },
    ]);

    expect(result.trustEligible).toBe(true);
    expect(result.reviewState).toBe("review_required");
    expect(result.summary).toBe("Standard Plan current full price £2,499.");
    expect(result.offering?.description).toBeUndefined();
    expect(result.offering?.planName).toBe("Standard Plan");
    expect(result.offering?.duration).toEqual(["12 months"]);
    expect(result.offering?.support).toEqual(["career support"]);
    expect(result.offering?.outcomes).toEqual([]);
    expect(result.offering?.targetCustomer).toBeUndefined();
    expect(result.offering?.currentPrices).toEqual(["£2,499"]);
    expect(result.offering?.prices).toHaveLength(1);
    expect(result.offering?.prices?.[0].label).toBe("full current price: £2,499");
    expect(JSON.stringify(result.evidence)).not.toContain("transforms your future");
    expect(JSON.stringify(result.evidence)).not.toContain("Guaranteed senior role");
    expect(JSON.stringify(result.evidence)).not.toContain("£9,999");
  });

  it("fails closed when the core offering name is not present in first-party evidence", () => {
    const item = baseItem();
    item.offering = { ...item.offering!, name: "Invented Executive AI Programme" };
    item.title = "Invented Executive AI Programme";

    const result = verifyPageReviewProvenance(item, [
      { url, title: pageTitle, fetchedAt, text: pageText },
    ]);

    expect(result.trustEligible).toBe(false);
    expect(result.reviewState).toBe("ambiguous");
  });

  it("drops an unsupported price and never carries its model-provided current price forward", () => {
    const item = baseItem();
    item.offering = {
      ...item.offering!,
      prices: [
        {
          value: "£7,777",
          semanticType: "full_current_price",
          label: "Current fee £7,777",
          sourceUrl: url,
          evidenceText: "Current fee £7,777.",
        },
      ],
      currentPrices: ["£7,777"],
    };

    const result = verifyPageReviewProvenance(item, [
      { url, title: pageTitle, fetchedAt, text: pageText },
    ]);

    expect(result.trustEligible).toBe(true);
    expect(result.offering?.prices).toEqual([]);
    expect(result.offering?.currentPrices).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("£7,777");
  });
});
