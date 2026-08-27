import { discoverPublicWebsite } from "./companyDiscovery";
import type { CompanyIntelligenceReview } from "./companyIntelligenceReview";
import {
  buildClientKnowledgeFacts,
  clientReadyKnowledgeItems,
  synthesiseCompanyKnowledge,
} from "./companyKnowledgeSynthesis";

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

function clientSafeIntelligenceError(error: unknown) {
  const detail =
    error instanceof Error ? error.message : "Amarktai intelligence unavailable";
  return detail
    .replace(/genx/gi, "Amarktai intelligence")
    .replace(/provider/gi, "service")
    .slice(0, 320);
}

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

function clientKnowledgeCategory(
  classification: CompanyIntelligenceReview["items"][number]["classification"]
) {
  if (classification === "company_contact") return "contact";
  if (classification === "company_faq") return "faq";
  if (classification === "company_policy") return "policies";
  return classification;
}

export function companyReviewCandidate(
  item: CompanyIntelligenceReview["items"][number]
) {
  const offering = item.offering;
  const lines = [
    item.summary,
    offering ? `Offering: ${offering.name}` : "",
    offering?.currentPrices?.length
      ? `Current total price: ${offering.currentPrices.join(" / ")}`
      : "",
    offering?.duration?.length
      ? `Duration: ${offering.duration.join(" / ")}`
      : "",
    offering?.certifications?.length
      ? `Certifications: ${offering.certifications.join(", ")}`
      : "",
    offering?.financeOptions?.length
      ? `Finance / payment options: ${offering.financeOptions.join("; ")}`
      : "",
    offering?.support?.length
      ? `Support: ${offering.support.join("; ")}`
      : "",
    offering?.outcomes?.length
      ? `Outcomes: ${offering.outcomes.join("; ")}`
      : "",
    offering?.targetCustomer ? `Best fit: ${offering.targetCustomer}` : "",
    `Evidence: ${item.evidenceText}`,
  ].filter(Boolean);
  return {
    title: offering ? offering.name : item.title,
    content: lines.join("\n\n"),
    sourceUrl: item.sourceUrls[0] || "",
    fetchedAt: item.fetchedAt,
    category: clientKnowledgeCategory(item.classification),
    classification: item.classification,
    reviewState: item.reviewState,
    confidence: item.confidence,
    evidenceBasis: "amarktai_synthesis_with_page_provenance" as const,
    evidenceText: item.evidenceText,
    pageTitle: item.pageTitle,
    sourceUrls: item.sourceUrls,
    trustEligible: item.trustEligible,
    offering,
  };
}

export async function discoverAndReviewCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  websiteUrl: string;
  reference: string;
}) {
  const discovery = await discoverPublicWebsite(input.websiteUrl);
  const retainedPages = pagesForCompanyReview(discovery);
  let review: CompanyIntelligenceReview;
  try {
    review = await synthesiseCompanyKnowledge({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: retainedPages,
      reference: input.reference,
    });
  } catch (error) {
    throw new Error(
      `The public website was read, but Amarktai intelligence could not produce a verified company-knowledge document. Nothing is ready for approval and no raw scraper output was promoted. ${clientSafeIntelligenceError(error)}`
    );
  }

  const clientItems = clientReadyKnowledgeItems(review.items);
  const clientFacts = buildClientKnowledgeFacts(review.items);
  const safeDiscovery = {
    ...discovery,
    proposedFacts: {
      ...discovery.proposedFacts,
      conflicts: clientFacts.conflicts,
      completeness: clientFacts.completeness,
      clientKnowledgeSynthesis: clientFacts.synthesis,
      rawCrawlerDiagnostics: {
        pagesCollected: discovery.pages.length,
        hiddenFromApproval: true,
        note:
          "Raw heuristic offering and currency extraction is diagnostic evidence only. Client-facing knowledge comes exclusively from provenance-verified Amarktai intelligence.",
      },
    },
  };

  return {
    discovery: safeDiscovery,
    proposedKnowledge: clientItems.map(companyReviewCandidate),
    reviewState: "completed" as const,
    reviewUnavailable: undefined,
    aiReview: review,
  };
}

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

  let review: CompanyIntelligenceReview;
  try {
    review = await synthesiseCompanyKnowledge({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: input.pages,
      reference: `website-review-retry:${input.discoveryId}:${Date.now()}`,
    });
  } catch (error) {
    throw new Error(
      `Amarktai intelligence could not complete the website review retry. No unverified knowledge was promoted. ${clientSafeIntelligenceError(error)}`
    );
  }

  return {
    proposedKnowledge: clientReadyKnowledgeItems(review.items).map(
      companyReviewCandidate
    ),
    aiReview: review,
  };
}
