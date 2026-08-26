import { discoverPublicWebsite } from "./companyDiscovery";
import type { CompanyIntelligenceReview } from "./companyIntelligenceReview";
import { reasonAboutCompanyWebsite } from "./companyWebsiteReasoner";

type RetainedPageMetadata = {
  url: string;
  title?: string | null;
  fetchedAt?: string;
};

type ReviewPage = {
  url: string;
  title: string | null;
  fetchedAt: string;
  text: string;
};

export function retainedPagesForCompanyReview(
  extractedText: string,
  pages: RetainedPageMetadata[]
): ReviewPage[] {
  const segments = Array.from(
    extractedText.matchAll(
      /^\[(https?:\/\/[^\]]+)\]\n([\s\S]*?)(?=^\[https?:\/\/|$)/gm
    )
  );
  return segments
    .map(segment => {
      const url = segment[1];
      const page = pages.find(item => item.url === url);
      return {
        url,
        title: page?.title || null,
        fetchedAt: page?.fetchedAt || new Date().toISOString(),
        text: segment[2] || "",
      };
    })
    .filter(page => page.text.trim().length > 0);
}

export function pagesForCompanyReview(
  discovery: Awaited<ReturnType<typeof discoverPublicWebsite>>
) {
  return retainedPagesForCompanyReview(discovery.extractedText, discovery.pages);
}

export function companyReviewCandidate(
  item: CompanyIntelligenceReview["items"][number]
) {
  const offering = item.offering;
  const lines = [
    item.summary,
    offering ? `Offering: ${offering.name}` : "",
    offering?.currentPrices?.length
      ? `Current prices: ${offering.currentPrices.join(" / ")}`
      : "",
    offering?.duration?.length
      ? `Duration: ${offering.duration.join(" / ")}`
      : "",
    offering?.certifications?.length
      ? `Certifications: ${offering.certifications.join(", ")}`
      : "",
    offering?.financeOptions?.length
      ? `Finance: ${offering.financeOptions.join("; ")}`
      : "",
    offering?.support?.length
      ? `Support: ${offering.support.join("; ")}`
      : "",
    `Evidence: ${item.evidenceText}`,
  ].filter(Boolean);
  return {
    title: offering ? `Offering · ${offering.name}` : item.title,
    content: lines.join("\n\n"),
    sourceUrl: item.sourceUrls[0] || "",
    fetchedAt: item.fetchedAt,
    category: item.classification,
    classification: item.classification,
    reviewState: item.reviewState,
    confidence: item.confidence,
    evidenceBasis: "page_text" as const,
    evidenceText: item.evidenceText,
    pageTitle: item.pageTitle,
    sourceUrls: item.sourceUrls,
    trustEligible: item.trustEligible,
    offering,
  };
}

function failClosedRawDiscovery(
  discovery: Awaited<ReturnType<typeof discoverPublicWebsite>>,
  detail: string
) {
  return discovery.proposedKnowledge.map(item => ({
    ...item,
    classification: "ambiguous",
    reviewState: "ambiguous" as const,
    confidence: "conflicting" as const,
    trustEligible: false,
    reviewReason: `Evidence-grounded company review unavailable. ${detail.slice(0, 320)}`,
  }));
}

/**
 * Canonical website intelligence pipeline.
 *
 * Fresh discovery is intentionally a metered AI operation:
 * crawl -> retain raw page evidence -> site-wide GenX context reasoning ->
 * evidence extraction -> deterministic provenance verification -> site-wide
 * reconciliation -> human-review draft.
 *
 * The AI is allowed to understand context across the site, but it cannot bypass
 * exact source/evidence checks or silently promote comparison/competitor text.
 */
export async function discoverAndReviewCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  websiteUrl: string;
  reference: string;
}) {
  const discovery = await discoverPublicWebsite(input.websiteUrl);
  try {
    const review = await reasonAboutCompanyWebsite({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: pagesForCompanyReview(discovery),
      reference: input.reference,
    });
    return {
      discovery,
      proposedKnowledge: review.items.map(companyReviewCandidate),
      reviewState: "completed" as const,
      reviewUnavailable: undefined,
      aiReview: review,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "AI review unavailable";
    return {
      discovery,
      proposedKnowledge: failClosedRawDiscovery(discovery, detail),
      reviewState: "unavailable" as const,
      reviewUnavailable: detail.slice(0, 320),
      aiReview: {
        agentKey: "company_intelligence_review",
        available: false,
        items: [],
        reviewedAt: new Date().toISOString(),
        failure: detail.slice(0, 320),
      },
    };
  }
}

/**
 * Retry only from retained raw page evidence. A retry still uses GenX and is
 * metered, but never reinterprets a previous AI candidate as source material.
 */
export async function reviewStoredCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  discoveryId: number;
  pages: ReviewPage[];
}) {
  if (!input.pages.length)
    throw new Error(
      "Retained raw page evidence is unavailable; start a fresh discovery before retrying."
    );
  const review = await reasonAboutCompanyWebsite({
    userId: input.userId,
    organisationId: input.organisationId,
    pages: input.pages,
    reference: `website-review-retry:${input.discoveryId}:${Date.now()}`,
  });
  return {
    proposedKnowledge: review.items.map(companyReviewCandidate),
    aiReview: review,
  };
}
