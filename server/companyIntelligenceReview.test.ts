import { describe, expect, it } from "vitest";
import {
  applyCompanyIntelligenceDecisions,
  deterministicRiskClassification,
  failClosedCompanyIntelligenceCandidates,
} from "./companyIntelligenceReview";
import type { DiscoveryKnowledgeCandidate } from "./companyDiscovery";

function candidate(
  title: string,
  content: string,
  category = "offering"
): DiscoveryKnowledgeCandidate {
  return {
    title,
    content,
    sourceUrl: "https://example.com/courses/cyber-security",
    fetchedAt: "2026-08-26T12:00:00.000Z",
    category,
    reviewState: "review_required",
    confidence: "high",
    evidenceBasis: "page_text",
    trustEligible: true,
  };
}

describe("company intelligence semantic review", () => {
  it("never promotes an obvious competitor comparison as the company's course", () => {
    const candidates = [
      candidate(
        "Cyber Security Programme",
        "Our Cyber Security Programme costs £1,899 and includes career support."
      ),
      candidate(
        "Example Academy Cyber Security",
        "Compare us with Example Academy. Example Academy's Cyber Security programme costs £2,500."
      ),
    ];

    const reviewed = applyCompanyIntelligenceDecisions(candidates, [
      {
        index: 0,
        classification: "company_offering",
        confidence: "high",
        trustEligible: true,
        reason: "The statement directly identifies the company's own programme and price.",
      },
      {
        index: 1,
        // Even a bad model decision cannot override the deterministic comparison guard.
        classification: "company_offering",
        confidence: "high",
        trustEligible: true,
        reason: "Incorrect optimistic model classification used to prove fail-closed behaviour.",
      },
    ]);

    expect(reviewed[0].classification).toBe("company_offering");
    expect(reviewed[0].trustEligible).toBe(true);
    expect(reviewed[1].classification).toBe("comparison");
    expect(reviewed[1].trustEligible).toBe(false);
  });

  it("marks testimonials and historical prices as unsafe for automatic approval", () => {
    expect(
      deterministicRiskClassification(
        candidate("Learner story", "A learner testimonial says they paid £999 last year.")
      )
    ).toBe("testimonial");
    expect(
      deterministicRiskClassification(
        candidate("Previous pricing", "The programme was previously priced at £1,499.")
      )
    ).toBe("historical");
  });

  it("fails closed when AI interpretation is unavailable", () => {
    const reviewed = failClosedCompanyIntelligenceCandidates(
      [candidate("AI Programme", "AI Programme £2,999")],
      "provider unavailable"
    );
    expect(reviewed[0].trustEligible).toBe(false);
    expect(reviewed[0].classification).toBe("ambiguous");
    expect(reviewed[0].reviewReason).toContain("AI interpretation unavailable");
  });

  it("keeps extraction conflicts untrusted even when the model is confident", () => {
    const conflicted = {
      ...candidate("AI Programme", "Published prices include £2,499 and £2,999."),
      reviewState: "conflict" as const,
      confidence: "conflicting" as const,
      trustEligible: false,
    };
    const reviewed = applyCompanyIntelligenceDecisions([conflicted], [
      {
        index: 0,
        classification: "company_price",
        confidence: "high",
        trustEligible: true,
        reason: "Both values are attached to the same programme but conflict.",
      },
    ]);
    expect(reviewed[0].reviewState).toBe("conflict");
    expect(reviewed[0].trustEligible).toBe(false);
  });
});
