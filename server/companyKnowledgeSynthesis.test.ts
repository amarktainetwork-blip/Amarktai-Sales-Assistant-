import { describe, expect, it } from "vitest";
import type { CompanyIntelligenceReviewItem } from "./companyIntelligenceReview";
import {
  buildClientKnowledgeFacts,
  clientReadyKnowledgeItems,
  selectCompanyKnowledgePages,
} from "./companyKnowledgeSynthesis";

function offering(input: {
  name: string;
  sourceUrl: string;
  price?: string;
  finance?: string;
  reviewState?: "review_required" | "conflict" | "ambiguous";
  trustEligible?: boolean;
}): CompanyIntelligenceReviewItem {
  return {
    classification: "company_offering",
    title: input.name,
    summary: `${input.name} is a first-party programme.`,
    sourceUrls: [input.sourceUrl],
    pageTitle: input.name,
    fetchedAt: "2026-08-27T14:20:00.000Z",
    evidenceText: `${input.name}${input.price ? ` ${input.price}` : ""}${input.finance ? ` ${input.finance}` : ""}`,
    confidence: "high",
    reviewState: input.reviewState ?? "review_required",
    trustEligible: input.trustEligible ?? true,
    offering: {
      name: input.name,
      currentPrices: input.price ? [input.price] : [],
      financeOptions: input.finance ? [input.finance] : [],
    },
  };
}

describe("client-ready company knowledge synthesis", () => {
  it("does not turn deposits or another course price into one programme price conflict", () => {
    const items: CompanyIntelligenceReviewItem[] = [
      offering({
        name: "IT Support Technician Career Programme",
        sourceUrl: "https://example.test/job-programmes/it-support",
        price: "£1,095",
        finance: "£54 deposit",
      }),
      offering({
        name: "CompTIA A+ Course",
        sourceUrl: "https://example.test/courses/comptia-a-plus",
        price: "£229",
      }),
    ];

    const facts = buildClientKnowledgeFacts(items);
    expect(facts.completeness.offeringsFound).toBe(2);
    expect(facts.completeness.offeringsWithPublishedPrice).toBe(2);
    expect(facts.completeness.unresolvedConflicts).toBe(0);
    expect(facts.conflicts).toEqual([]);
  });

  it("keeps a genuine same-offering current-price conflict visible for human review", () => {
    const items: CompanyIntelligenceReviewItem[] = [
      offering({
        name: "Network Engineer Career Programme",
        sourceUrl: "https://example.test/programme/network-engineer",
        price: "£1,799",
        reviewState: "conflict",
        trustEligible: false,
      }),
      offering({
        name: "Network Engineer Career Programme",
        sourceUrl: "https://example.test/pricing/network-engineer",
        price: "£1,899",
        reviewState: "conflict",
        trustEligible: false,
      }),
    ];

    const facts = buildClientKnowledgeFacts(items);
    expect(facts.completeness.offeringsFound).toBe(1);
    expect(facts.completeness.unresolvedConflicts).toBe(1);
    expect(facts.conflicts[0]?.values).toEqual(["£1,799", "£1,899"]);
  });

  it("keeps comparison and marketing diagnostics out of the client approval document", () => {
    const firstParty = offering({
      name: "Cyber Security Career Programme",
      sourceUrl: "https://example.test/job-programmes/cyber-security",
      price: "£1,899",
    });
    const comparison: CompanyIntelligenceReviewItem = {
      classification: "comparison",
      title: "Career programme vs university degree",
      summary: "Comparison material.",
      sourceUrls: ["https://example.test/career-programme-vs-university-degree"],
      pageTitle: "Career Programme vs University",
      fetchedAt: "2026-08-27T14:20:00.000Z",
      evidenceText: "Career programme vs university degree",
      confidence: "high",
      reviewState: "ambiguous",
      trustEligible: false,
    };

    expect(clientReadyKnowledgeItems([comparison, firstParty])).toEqual([
      firstParty,
    ]);
  });

  it("prioritises first-party offering and pricing pages ahead of comparison/reference pages", () => {
    const pages = selectCompanyKnowledgePages([
      {
        url: "https://example.test/career-programme-vs-university-degree",
        title: "Career Programme vs University",
        fetchedAt: "2026-08-27T14:20:00.000Z",
        text: "Comparison article ".repeat(100),
      },
      {
        url: "https://example.test/job-programmes/it-support",
        title: "IT Support Career Programme",
        fetchedAt: "2026-08-27T14:20:00.000Z",
        text: "IT Support Career Programme full price £1,095. ".repeat(80),
      },
      {
        url: "https://example.test/pricing",
        title: "Pricing",
        fetchedAt: "2026-08-27T14:20:00.000Z",
        text: "Current programme pricing and finance. ".repeat(80),
      },
    ]);

    expect(pages[0]?.url).toBe("https://example.test/job-programmes/it-support");
    expect(pages[1]?.url).toBe("https://example.test/pricing");
    expect(pages[2]?.url).toContain("career-programme-vs-university-degree");
  });
});
