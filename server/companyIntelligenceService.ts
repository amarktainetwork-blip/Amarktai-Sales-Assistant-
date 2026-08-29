import {
  discoverPublicWebsite,
  type DiscoveryResult,
} from "./companyDiscovery";
import {
  synthesiseCompanyKnowledge,
  type CompanyKnowledgePack,
  type CompanyKnowledgeSynthesisResult,
  type ReviewPage,
  type WholeSiteCheckpoint,
} from "./companyKnowledgePartialBatchRuntime";

type RetainedPageMetadata = {
  url: string;
  title?: string | null;
  fetchedAt?: string;
  text?: string;
  category?: string;
  description?: string | null;
  headings?: string[];
  links?: string[];
  jsonLd?: Record<string, unknown>[];
};

function clientSafeIntelligenceError(error: unknown) {
  const detail =
    error instanceof Error
      ? error.message
      : "Amarktai intelligence unavailable";
  return detail
    .replace(/genx/gi, "Amarktai intelligence")
    .replace(/provider/gi, "service")
    .replace(
      /claude|openai|anthropic|gemini|grok|gpt[-\w.]*/gi,
      "Amarktai intelligence"
    )
    .slice(0, 500);
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
  const textByUrl = new Map(
    segments.map(segment => [segment[1], segment[2] || ""] as const)
  );
  return pages
    .map(page => ({
      url: page.url,
      title: page.title || null,
      fetchedAt: page.fetchedAt || new Date().toISOString(),
      text: page.text ?? textByUrl.get(page.url) ?? "",
      category: page.category,
      description: page.description,
      headings: page.headings,
      links: page.links,
      jsonLd: page.jsonLd,
    }))
    .filter(page => page.text.trim().length > 0);
}

export function pagesForCompanyReview(discovery: DiscoveryResult) {
  return retainedPagesForCompanyReview(
    discovery.extractedText,
    discovery.pages
  );
}

function evidenceFor(
  sourcePageIds: string[],
  result: CompanyKnowledgeSynthesisResult
) {
  const byId = new Map(result.corpus.pages.map(page => [page.pageId, page]));
  return sourcePageIds.flatMap(pageId => {
    const page = byId.get(pageId);
    return page
      ? [
          {
            sourceUrl: page.url,
            pageTitle: page.title,
            fetchedAt: page.fetchedAt,
            evidenceText:
              page.description ||
              page.primaryHeading ||
              "First-party website evidence",
            materialFacts: [] as string[],
          },
        ]
      : [];
  });
}

function candidate(input: {
  title: string;
  content: string;
  category: string;
  sourcePageIds: string[];
  result: CompanyKnowledgeSynthesisResult;
  reviewState?: "review_required" | "conflict" | "ambiguous";
  trustEligible?: boolean;
  priceFacts?: CompanyKnowledgePack["offerings"][number]["prices"];
  offering?: CompanyKnowledgePack["offerings"][number];
}) {
  const evidence = evidenceFor(input.sourcePageIds, input.result);
  return {
    title: input.title,
    content: input.content,
    category: input.category,
    classification: input.category,
    reviewState: input.reviewState || "review_required",
    confidence: "high" as const,
    evidenceBasis: "whole_site_analysis_with_field_provenance" as const,
    evidenceText: evidence[0]?.evidenceText || "",
    pageTitle: evidence[0]?.pageTitle || null,
    sourceUrl: evidence[0]?.sourceUrl || "",
    sourceUrls: evidence.map(item => item.sourceUrl),
    fetchedAt: evidence[0]?.fetchedAt || input.result.reviewedAt,
    sourcePageIds: input.sourcePageIds,
    trustEligible: input.trustEligible ?? true,
    priceFacts: input.priceFacts || [],
    offering: input.offering,
    evidence,
  };
}

function factCandidates(
  facts: Array<{ title: string; details: string; sourcePageIds: string[] }>,
  category: string,
  result: CompanyKnowledgeSynthesisResult
) {
  return facts.map(fact =>
    candidate({
      title: fact.title,
      content: fact.details,
      category,
      sourcePageIds: fact.sourcePageIds,
      result,
    })
  );
}

export function companyKnowledgeReviewCandidates(
  result: CompanyKnowledgeSynthesisResult
) {
  const pack = result.pack;
  const offeringCandidates = pack.offerings.map(offering => {
    const lines = [
      offering.description,
      `Type: ${offering.type.replaceAll("_", " ")}`,
      offering.plans.length ? `Plans: ${offering.plans.join(" / ")}` : "",
      ...offering.prices.map(
        price =>
          `${price.semanticType.replaceAll("_", " ")}: ${price.value} (${price.label})`
      ),
      offering.duration.length
        ? `Duration: ${offering.duration.join(" / ")}`
        : "",
      offering.includedCourses.length
        ? `Included courses: ${offering.includedCourses.join(", ")}`
        : "",
      offering.includedExams.length
        ? `Included exams: ${offering.includedExams.join(", ")}`
        : "",
      offering.certifications.length
        ? `Certifications: ${offering.certifications.join(", ")}`
        : "",
      offering.financeOptions.length
        ? `Finance: ${offering.financeOptions.join("; ")}`
        : "",
      offering.support.length ? `Support: ${offering.support.join("; ")}` : "",
      offering.targetCustomer ? `Best fit: ${offering.targetCustomer}` : "",
      offering.entryRequirements.length
        ? `Entry requirements: ${offering.entryRequirements.join("; ")}`
        : "",
      offering.outcomes.length
        ? `Outcomes: ${offering.outcomes.join("; ")}`
        : "",
      offering.caveats.length ? `Caveats: ${offering.caveats.join("; ")}` : "",
    ].filter(Boolean);
    const conflicted = pack.conflicts.some(
      conflict =>
        conflict.sourcePageIds.some(id =>
          offering.sourcePageIds.includes(id)
        ) && /price/i.test(conflict.subject)
    );
    return candidate({
      title: offering.name,
      content: lines.join("\n\n"),
      category:
        offering.type === "career_programme"
          ? "career_programmes"
          : offering.type === "individual_course"
            ? "individual_courses"
            : "products_services",
      sourcePageIds: offering.sourcePageIds,
      result,
      reviewState: conflicted ? "conflict" : "review_required",
      trustEligible: !conflicted,
      priceFacts: offering.prices,
      offering,
    });
  });
  return [
    candidate({
      title: pack.company.name,
      content: [pack.company.legalName, pack.company.description]
        .filter(Boolean)
        .join("\n\n"),
      category: "company",
      sourcePageIds: pack.company.sourcePageIds,
      result,
    }),
    ...offeringCandidates,
    ...factCandidates(pack.finance, "finance", result),
    ...factCandidates(
      pack.certificationsAndAccreditation,
      "certifications",
      result
    ),
    ...factCandidates(pack.supportAndOutcomes, "support_outcomes", result),
    ...factCandidates(pack.policies, "policies", result),
    ...factCandidates(pack.refundCancellationTerms, "policies", result),
    ...factCandidates(pack.contactKnowledge, "contact", result),
    ...factCandidates(pack.faqs, "faqs", result),
    ...factCandidates(pack.salesUsefulFacts, "sales_facts", result),
    ...pack.contacts.map(item =>
      candidate({
        title: item.label || item.type,
        content: item.value,
        category: "contact",
        sourcePageIds: item.sourcePageIds,
        result,
      })
    ),
    ...pack.locations.map(item =>
      candidate({
        title: item.name,
        content: item.address,
        category: "contact",
        sourcePageIds: item.sourcePageIds,
        result,
      })
    ),
    ...pack.excludedContent.map(item =>
      candidate({
        title: `Ignored: ${item.classification.replaceAll("_", " ")}`,
        content: item.reason,
        category: "items_ignored",
        sourcePageIds: item.sourcePageIds,
        result,
        reviewState: "ambiguous",
        trustEligible: false,
      })
    ),
  ];
}

function clientConflicts(result: CompanyKnowledgeSynthesisResult) {
  const pages = new Map(result.corpus.pages.map(page => [page.pageId, page]));
  return result.pack.conflicts.map(conflict => ({
    type: /price/i.test(conflict.subject) ? "current_price" : "material_fact",
    displayNames: [conflict.subject],
    values: conflict.values,
    sources: conflict.sourcePageIds.flatMap(pageId => {
      const page = pages.get(pageId);
      return page
        ? [
            {
              sourceUrl: page.url,
              fetchedAt: page.fetchedAt,
              prices: conflict.values,
            },
          ]
        : [];
    }),
    explanation: conflict.explanation,
  }));
}

export function buildReviewedCompanyDiscovery(
  discovery: DiscoveryResult,
  review: CompanyKnowledgeSynthesisResult
) {
  const proposedKnowledge = companyKnowledgeReviewCandidates(review);
  const excludedById = new Map(
    review.pack.excludedContent.flatMap(item =>
      item.sourcePageIds.map(id => [id, item.reason] as const)
    )
  );
  const pageInventory = review.corpus.pages.map(page => ({
    pageId: page.pageId,
    url: page.url,
    primaryDisposition: excludedById.has(page.pageId)
      ? "excluded"
      : "retained_corpus",
    excludedReason: excludedById.get(page.pageId) || null,
    contentHash: page.contentHash,
  }));
  const safePages = discovery.pages.map(({ text: _text, ...page }) => page);
  return {
    discovery: {
      ...discovery,
      pages: safePages,
      proposedFacts: {
        ...discovery.proposedFacts,
        conflicts: clientConflicts(review),
        completeness: review.completeness,
        pageInventory,
        corpus: {
          pageCount: review.corpus.pageCount,
          byteSize: review.corpus.byteSize,
          corpusHash: review.corpus.corpusHash,
          sourceHashes: review.corpus.sourceHashes,
        },
        wholeSiteLearning: {
          status: "completed",
          analysisCalls: review.analysisCalls,
          auditCalls: review.auditCalls,
          normalizationEvents: review.normalizationEvents,
          repairCalls: review.repairCalls,
          totalAiCalls: review.totalAiCalls,
          fieldLevelSourceValidation: true,
          humanApprovalRequired: true,
        },
      },
    },
    proposedKnowledge,
    reviewState: "completed" as const,
    reviewUnavailable: undefined,
    aiReview: review,
  };
}

export async function discoverAndReviewCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  websiteUrl: string;
  reference: string;
  onCheckpoint?: (checkpoint: WholeSiteCheckpoint) => Promise<void> | void;
  onPhase?: Parameters<typeof synthesiseCompanyKnowledge>[0]["onPhase"];
}) {
  const discovery = await discoverPublicWebsite(input.websiteUrl);
  try {
    const review = await synthesiseCompanyKnowledge({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: pagesForCompanyReview(discovery),
      reference: input.reference,
      onCheckpoint: input.onCheckpoint,
      onPhase: input.onPhase,
    });
    return buildReviewedCompanyDiscovery(discovery, review);
  } catch (error) {
    throw new Error(
      `The public website was read, but Amarktai intelligence could not produce a verified company-knowledge document. Nothing is ready for approval. ${clientSafeIntelligenceError(error)}`
    );
  }
}

export async function reviewStoredCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  discoveryId: number;
  pages: ReviewPage[];
  onCheckpoint?: (checkpoint: WholeSiteCheckpoint) => Promise<void> | void;
}) {
  if (!input.pages.length)
    throw new Error(
      "Retained raw page evidence is unavailable; start a fresh discovery before retrying."
    );
  try {
    const review = await synthesiseCompanyKnowledge({
      userId: input.userId,
      organisationId: input.organisationId,
      pages: input.pages,
      reference: `website-review-retry:${input.discoveryId}:${Date.now()}`,
      onCheckpoint: input.onCheckpoint,
    });
    return {
      proposedKnowledge: companyKnowledgeReviewCandidates(review),
      aiReview: review,
    };
  } catch (error) {
    throw new Error(
      `Amarktai intelligence could not complete the website review retry. No unverified knowledge was promoted. ${clientSafeIntelligenceError(error)}`
    );
  }
}
