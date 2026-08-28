import { z } from "zod";
import type { DiscoveryKnowledgeCandidate } from "./companyDiscovery";
import { runGenxAgent } from "./genx";

export const COMPANY_INTELLIGENCE_CLASSIFICATIONS = [
  "company_overview",
  "company_offering",
  "company_price",
  "company_finance",
  "company_certification",
  "company_support",
  "company_policy",
  "company_contact",
  "company_faq",
  "company_evidence",
  "testimonial",
  "case_study",
  "comparison",
  "competitor",
  "example",
  "historical",
  "navigation",
  "marketing_copy",
  "ambiguous",
  "exclude",
] as const;

export type CompanyIntelligenceClassification =
  (typeof COMPANY_INTELLIGENCE_CLASSIFICATIONS)[number];

export type CompanyIntelligenceCandidate = DiscoveryKnowledgeCandidate & {
  classification: CompanyIntelligenceClassification;
  reviewReason: string;
  originalTitle?: string;
};

const classificationSchema = z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS);
const decisionSchema = z
  .object({
    index: z.number().int().min(0).max(79),
    classification: classificationSchema,
    confidence: z.enum(["high", "medium", "low"]),
    trustEligible: z.boolean(),
    reason: z.string().trim().min(3).max(700),
    correctedTitle: z.string().trim().min(1).max(220).optional(),
    correctedContent: z.string().trim().min(1).max(8_000).optional(),
  })
  .strict();

const responseSchema = z
  .object({
    items: z.array(decisionSchema).min(1).max(12),
  })
  .strict();

type Decision = z.infer<typeof decisionSchema>;

const NEVER_AUTO_TRUST = new Set<CompanyIntelligenceClassification>([
  "testimonial",
  "case_study",
  "comparison",
  "competitor",
  "example",
  "historical",
  "navigation",
  "marketing_copy",
  "ambiguous",
  "exclude",
]);

function compact(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function deterministicRiskClassification(
  candidate: Pick<DiscoveryKnowledgeCandidate, "title" | "content" | "category">
): CompanyIntelligenceClassification | undefined {
  const text = `${candidate.title} ${candidate.content} ${candidate.category}`.toLowerCase();
  if (/\b(?:compare|comparison|compared with|versus|vs\.?|competitor|other provider|another provider|alternative provider)\b/.test(text))
    return "comparison";
  if (/\b(?:testimonial|learner story|student story|customer story|what our learners say|case study)\b/.test(text))
    return /case study/.test(text) ? "case_study" : "testimonial";
  if (/\b(?:historical|previously|formerly|used to cost|old price|was priced at|past price)\b/.test(text))
    return "historical";
  return undefined;
}

function parseModelJson(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first < 0 || last <= first)
    throw new Error("Company intelligence review returned no JSON object.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(first, last + 1));
  } catch {
    throw new Error("Company intelligence review returned malformed JSON.");
  }
  return responseSchema.parse(parsed);
}

export function applyCompanyIntelligenceDecisions(
  candidates: DiscoveryKnowledgeCandidate[],
  decisions: Decision[]
): CompanyIntelligenceCandidate[] {
  const byIndex = new Map<number, Decision>();
  for (const decision of decisions) {
    if (byIndex.has(decision.index))
      throw new Error("Company intelligence review returned a duplicate candidate decision.");
    byIndex.set(decision.index, decision);
  }

  return candidates.map((candidate, index) => {
    const decision = byIndex.get(index);
    if (!decision)
      return {
        ...candidate,
        classification: "ambiguous" as const,
        confidence: "conflicting" as const,
        trustEligible: false,
        reviewState: "review_required" as const,
        reviewReason: "AI review did not return a decision for this extracted item.",
      };

    const deterministicRisk = deterministicRiskClassification(candidate);
    const classification = deterministicRisk ?? decision.classification;
    const conflict = candidate.reviewState === "conflict";
    const disallowed = conflict || NEVER_AUTO_TRUST.has(classification);
    const correctedTitle = compact(decision.correctedTitle || candidate.title, 220);
    const correctedContent = compact(decision.correctedContent || candidate.content, 8_000);

    return {
      ...candidate,
      ...(correctedTitle !== candidate.title ? { originalTitle: candidate.title, title: correctedTitle } : {}),
      content: correctedContent || candidate.content,
      classification,
      confidence:
        conflict || classification === "ambiguous"
          ? "conflicting"
          : decision.confidence === "low"
            ? "medium"
            : decision.confidence,
      trustEligible: Boolean(decision.trustEligible) && !disallowed,
      reviewState: conflict ? "conflict" : "review_required",
      reviewReason: deterministicRisk
        ? `Conservative safety classification: ${deterministicRisk.replaceAll("_", " ")}. ${decision.reason}`
        : decision.reason,
    };
  });
}

export function failClosedCompanyIntelligenceCandidates(
  candidates: DiscoveryKnowledgeCandidate[],
  reason: string
): CompanyIntelligenceCandidate[] {
  return candidates.map(candidate => ({
    ...candidate,
    classification: deterministicRiskClassification(candidate) ?? "ambiguous",
    confidence: "conflicting",
    trustEligible: false,
    reviewState: candidate.reviewState === "conflict" ? "conflict" : "review_required",
    reviewReason: `AI interpretation unavailable. ${compact(reason, 500)}`,
  }));
}

function promptForChunk(input: {
  companyName: string;
  candidates: Array<{ index: number; candidate: DiscoveryKnowledgeCandidate }>;
}) {
  return `Review these PUBLIC-WEBSITE extraction candidates for ${input.companyName} before a human approves company knowledge.

Your job is semantic interpretation, not extraction. A technically scraped statement may still be about a competitor, comparison, testimonial, example, historical price, navigation text, or marketing copy.

Rules:
- Never invent a product, price, duration, certification, finance term, policy or company claim.
- A competitor/comparison/example/testimonial/historical statement is never trustEligible.
- A price is only company_price when the evidence clearly attaches it to this company's offering.
- If ownership or context is uncertain, use ambiguous and trustEligible=false.
- correctedTitle/correctedContent may only clarify or shorten information already supported by the supplied evidence. Do not add facts.
- Every supplied index must appear exactly once.
- Return JSON only in the shape {"items":[{"index":0,"classification":"company_offering","confidence":"high","trustEligible":true,"reason":"...","correctedTitle":"...","correctedContent":"..."}]}.

Allowed classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Candidates:
${JSON.stringify(
    input.candidates.map(({ index, candidate }) => ({
      index,
      title: compact(candidate.title, 500),
      content: compact(candidate.content, 5_000),
      sourceUrl: candidate.sourceUrl,
      fetchedAt: candidate.fetchedAt,
      extractionCategory: candidate.category,
      extractionReviewState: candidate.reviewState,
      extractionConfidence: candidate.confidence,
      evidenceBasis: candidate.evidenceBasis,
    }))
  )}`;
}

export async function reviewCompanyDiscovery(input: {
  userId: number;
  organisationId: number;
  companyName: string;
  candidates: DiscoveryKnowledgeCandidate[];
}) {
  if (!input.candidates.length)
    return {
      candidates: [] as CompanyIntelligenceCandidate[],
      review: {
        status: "reviewed" as const,
        reviewedAt: new Date().toISOString(),
        candidateCount: 0,
        classificationCounts: {} as Record<string, number>,
      },
    };

  const decisions: Decision[] = [];
  const chunkSize = 10;
  for (let offset = 0; offset < input.candidates.length; offset += chunkSize) {
    const chunk = input.candidates.slice(offset, offset + chunkSize).map((candidate, localIndex) => ({
      index: offset + localIndex,
      candidate,
    }));
    const response = await runGenxAgent({
      agentKey: "company_intelligence_review",
      modelTier: "reasoning",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "company_intelligence_review",
        reference: `website-review:${offset}`,
      },
      messages: [{
        role: "user",
        content: promptForChunk({
          companyName: compact(input.companyName, 220) || "the company",
          candidates: chunk,
        }),
      }],
    });
    if (response.provider === "not_configured")
      throw new Error("Amarktai intelligence is not configured for website interpretation.");
    const parsed = parseModelJson(response.content);
    const expected = new Set(chunk.map(item => item.index));
    if (parsed.items.length !== chunk.length || parsed.items.some(item => !expected.has(item.index)))
      throw new Error("Company intelligence review did not cover the exact candidate set.");
    decisions.push(...parsed.items);
  }

  const candidates = applyCompanyIntelligenceDecisions(input.candidates, decisions);
  const classificationCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.classification] = (counts[candidate.classification] || 0) + 1;
    return counts;
  }, {});
  return {
    candidates,
    review: {
      status: "reviewed" as const,
      reviewedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      classificationCounts,
    },
  };
}

const PAGE_REVIEW_MAX_CHUNKS = 8;
const PAGE_REVIEW_MAX_CHARS = 9_000;
const PAGE_REVIEW_MAX_ITEMS = 40;
const PAGE_REVIEW_EVIDENCE_CHARS = 600;

const pageReviewItemSchema = z.object({
  classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
  title: z.string().trim().min(1).max(220),
  summary: z.string().trim().min(1).max(2_000),
  sourceUrls: z.array(z.string().url().max(1024)).min(1).max(8),
  pageTitle: z.string().trim().max(500).nullable(),
  fetchedAt: z.string().datetime(),
  evidenceText: z.string().trim().min(1).max(PAGE_REVIEW_EVIDENCE_CHARS),
  confidence: z.enum(["high", "medium", "low"]),
  reviewState: z.enum(["review_required", "ambiguous", "conflict"]),
  trustEligible: z.boolean(),
  evidence: z.array(z.object({
    sourceUrl: z.string().url().max(1024),
    pageTitle: z.string().trim().max(500).nullable(),
    fetchedAt: z.string().datetime(),
    evidenceText: z.string().trim().min(1).max(PAGE_REVIEW_EVIDENCE_CHARS),
    materialFacts: z.array(z.string().trim().min(1).max(500)).max(24),
  })).max(24).optional(),
  offering: z.object({
    name: z.string().trim().min(1).max(220),
    type: z.string().trim().max(100).optional(),
    description: z.string().trim().max(1_200).optional(),
    planName: z.string().trim().max(160).optional(),
    prices: z.array(z.object({
      value: z.string().trim().min(1).max(80),
      semanticType: z.enum([
        "full_current_price",
        "deposit",
        "finance_payment_plan",
        "alternative_plan",
        "other_fee",
      ]),
      label: z.string().trim().min(1).max(240),
      sourceUrl: z.string().url().max(1024),
      evidenceText: z.string().trim().min(1).max(PAGE_REVIEW_EVIDENCE_CHARS),
    })).max(16).optional(),
    currentPrices: z.array(z.string().trim().max(80)).max(12).optional(),
    duration: z.array(z.string().trim().max(120)).max(12).optional(),
    includedCourses: z.array(z.string().trim().max(220)).max(40).optional(),
    includedExams: z.array(z.string().trim().max(220)).max(24).optional(),
    certifications: z.array(z.string().trim().max(160)).max(20).optional(),
    awardingBodies: z.array(z.string().trim().max(160)).max(20).optional(),
    financeOptions: z.array(z.string().trim().max(500)).max(12).optional(),
    support: z.array(z.string().trim().max(500)).max(12).optional(),
    targetCustomer: z.string().trim().max(600).optional(),
    entryRequirements: z.array(z.string().trim().max(500)).max(12).optional(),
    outcomes: z.array(z.string().trim().max(500)).max(12).optional(),
    importantCaveats: z.array(z.string().trim().max(500)).max(12).optional(),
  }).optional(),
});

export type CompanyIntelligenceReviewItem = z.infer<typeof pageReviewItemSchema>;
export type CompanyIntelligenceReview = {
  agentKey: "company_intelligence_review";
  available: boolean;
  items: CompanyIntelligenceReviewItem[];
  reviewedAt: string;
  failure?: string;
};
type ReviewPage = { url: string; title: string | null; fetchedAt: string; text: string };
type PriceSemanticType =
  | "full_current_price"
  | "deposit"
  | "finance_payment_plan"
  | "alternative_plan"
  | "other_fee";

function parseReviewArray(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || value).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("The review service returned no JSON array.");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function pageReviewChunks(pages: ReviewPage[]) {
  const chunks: ReviewPage[][] = [];
  let current: ReviewPage[] = [];
  let used = 0;
  for (const page of pages) {
    if (chunks.length >= PAGE_REVIEW_MAX_CHUNKS) break;
    const bounded = { ...page, text: page.text.slice(0, PAGE_REVIEW_MAX_CHARS) };
    const size = bounded.text.length + bounded.url.length + (bounded.title?.length || 0);
    if (current.length && used + size > PAGE_REVIEW_MAX_CHARS) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(bounded);
    used += size;
  }
  if (current.length && chunks.length < PAGE_REVIEW_MAX_CHUNKS) chunks.push(current);
  return chunks;
}

function normaliseEvidence(value: string) {
  return value
    .normalize("NFKC")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function claimIsGrounded(value: string | undefined, pageText: string) {
  if (!value) return true;
  const normalisedClaim = normaliseEvidence(value);
  return normalisedClaim.length >= 2 && pageText.includes(normalisedClaim);
}

function groundedArray(values: string[] | undefined, citedText: string) {
  return (values || []).filter(value => claimIsGrounded(value, citedText));
}

function groundedScalar(value: string | undefined, citedText: string) {
  return value && claimIsGrounded(value, citedText) ? value : undefined;
}

function priceLabelFallback(semanticType: PriceSemanticType, value: string) {
  return `${semanticType.replaceAll("_", " ")}: ${value}`;
}

function sanitisedOfferingMaterialFacts(
  offering: NonNullable<CompanyIntelligenceReviewItem["offering"]>
) {
  return Array.from(new Set([
    offering.name,
    offering.type,
    offering.description,
    offering.planName,
    ...(offering.prices || []).flatMap(price => [price.value, price.evidenceText]),
    ...(offering.currentPrices || []),
    ...(offering.duration || []),
    ...(offering.includedCourses || []),
    ...(offering.includedExams || []),
    ...(offering.certifications || []),
    ...(offering.awardingBodies || []),
    ...(offering.financeOptions || []),
    ...(offering.support || []),
    offering.targetCustomer,
    ...(offering.entryRequirements || []),
    ...(offering.outcomes || []),
    ...(offering.importantCaveats || []),
  ].filter((value): value is string => Boolean(value)))).slice(0, 24);
}

export function verifyPageReviewProvenance(
  item: CompanyIntelligenceReviewItem,
  pages: ReviewPage[]
) {
  const pagesByUrl = new Map(pages.map(page => [page.url, page]));
  const sourceUrls = Array.from(new Set(item.sourceUrls)).filter(url => pagesByUrl.has(url));
  const citedPages = sourceUrls.map(url => pagesByUrl.get(url)!).filter(Boolean);
  const pageTitleMatches = item.pageTitle == null
    ? citedPages.every(page => page.title == null)
    : citedPages.some(page =>
        page.title != null && normaliseEvidence(page.title) === normaliseEvidence(item.pageTitle!)
      );
  const fetchedAtMatches = citedPages.some(page => page.fetchedAt === item.fetchedAt);
  const citedText = citedPages.map(page => normaliseEvidence(page.text)).join("\n");
  const evidenceGrounded = Boolean(
    normaliseEvidence(item.evidenceText) && citedText.includes(normaliseEvidence(item.evidenceText))
  );

  let offering = item.offering;
  let offeringNameGrounded = true;
  if (offering) {
    offeringNameGrounded = claimIsGrounded(offering.name, citedText);
    const prices = (offering.prices || []).flatMap(price => {
      const sourcePage = pagesByUrl.get(price.sourceUrl);
      if (!sourcePage || !sourceUrls.includes(price.sourceUrl)) return [];
      const sourceText = normaliseEvidence(sourcePage.text);
      if (!claimIsGrounded(price.value, sourceText) || !claimIsGrounded(price.evidenceText, sourceText))
        return [];
      return [{
        ...price,
        label: claimIsGrounded(price.label, sourceText)
          ? price.label
          : priceLabelFallback(price.semanticType, price.value),
      }];
    });
    const currentPrices = Array.from(new Set(
      prices.filter(price => price.semanticType === "full_current_price").map(price => price.value)
    ));
    offering = {
      ...offering,
      description: groundedScalar(offering.description, citedText),
      planName: groundedScalar(offering.planName, citedText),
      prices,
      currentPrices,
      duration: groundedArray(offering.duration, citedText),
      includedCourses: groundedArray(offering.includedCourses, citedText),
      includedExams: groundedArray(offering.includedExams, citedText),
      certifications: groundedArray(offering.certifications, citedText),
      awardingBodies: groundedArray(offering.awardingBodies, citedText),
      financeOptions: groundedArray(offering.financeOptions, citedText),
      support: groundedArray(offering.support, citedText),
      targetCustomer: groundedScalar(offering.targetCustomer, citedText),
      entryRequirements: groundedArray(offering.entryRequirements, citedText),
      outcomes: groundedArray(offering.outcomes, citedText),
      importantCaveats: groundedArray(offering.importantCaveats, citedText),
    };
  }

  const safeSummary = claimIsGrounded(item.summary, citedText) ? item.summary : item.evidenceText;
  const safeTitle = offering && offeringNameGrounded
    ? offering.name
    : claimIsGrounded(item.title, citedText)
      ? item.title
      : item.pageTitle || compact(item.evidenceText, 220);

  const supported =
    sourceUrls.length === item.sourceUrls.length &&
    sourceUrls.length > 0 &&
    pageTitleMatches &&
    fetchedAtMatches &&
    evidenceGrounded &&
    offeringNameGrounded;

  const evidence = supported && citedPages.length
    ? citedPages.map(page => ({
        sourceUrl: page.url,
        pageTitle: page.title,
        fetchedAt: page.fetchedAt,
        evidenceText: item.evidenceText,
        materialFacts: offering ? sanitisedOfferingMaterialFacts(offering) : [item.evidenceText],
      })).slice(0, 24)
    : [];

  const sanitised: CompanyIntelligenceReviewItem = {
    ...item,
    title: safeTitle,
    summary: safeSummary,
    sourceUrls,
    pageTitle: pageTitleMatches ? item.pageTitle : null,
    ...(offering ? { offering } : {}),
    evidence,
  };

  return supported
    ? sanitised
    : { ...sanitised, trustEligible: false, reviewState: "ambiguous" as const };
}

function guardPageReviewItem(item: CompanyIntelligenceReviewItem) {
  const candidate = {
    title: item.title,
    content: `${item.summary} ${item.evidenceText}`,
    category: item.classification,
  };
  const risk = deterministicRiskClassification(candidate);
  if (risk || NEVER_AUTO_TRUST.has(item.classification))
    return {
      ...item,
      classification: risk || item.classification,
      trustEligible: false,
      reviewState: "ambiguous" as const,
    };
  return item;
}

function reconcilePageReview(items: CompanyIntelligenceReviewItem[]) {
  const guarded = items.map(guardPageReviewItem).slice(0, PAGE_REVIEW_MAX_CHUNKS * PAGE_REVIEW_MAX_ITEMS);
  const pricesByOffering = new Map<string, Set<string>>();
  guarded.forEach(item => {
    if (!item.trustEligible || !item.offering?.name || !item.offering.currentPrices?.length) return;
    const key = item.offering.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const current = pricesByOffering.get(key) || new Set<string>();
    item.offering.currentPrices.forEach(value => current.add(value.toLowerCase()));
    pricesByOffering.set(key, current);
  });
  return guarded.map(item => {
    const key = item.offering?.name?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return key && (pricesByOffering.get(key)?.size || 0) > 1 && item.trustEligible
      ? { ...item, trustEligible: false, reviewState: "conflict" as const }
      : item;
  });
}

function pageReviewPrompt(chunk: ReviewPage[]) {
  return `Interpret these public website pages as a cautious company-intelligence reviewer. Return ONLY a JSON array. Each item must include classification, title, summary, sourceUrls, pageTitle, fetchedAt, evidenceText, confidence, reviewState, trustEligible, and optional offering details. Classifications are: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Do not infer facts. Preserve short evidence quotations. Comparisons, competitors, testimonials, examples, historical statements, navigation, and marketing claims can never become trusted offerings or current prices. If ownership, price recency, or context is uncertain, classify ambiguous and set trustEligible=false. Output remains a human-review draft only.

Pages:\n${JSON.stringify(chunk.map(page => ({ url: page.url, pageTitle: page.title, fetchedAt: page.fetchedAt, text: page.text })))}`;
}

export async function reviewCompanyIntelligence(input: {
  userId: number;
  organisationId: number;
  pages: ReviewPage[];
  reference: string;
}): Promise<CompanyIntelligenceReview> {
  const chunks = pageReviewChunks(input.pages.filter(page => page.url && page.text.trim()));
  if (!chunks.length) throw new Error("No readable website material is available for review.");
  const items: CompanyIntelligenceReviewItem[] = [];
  for (const chunk of chunks) {
    const response = await runGenxAgent({
      agentKey: "company_intelligence_review",
      modelTier: "reasoning",
      messages: [{ role: "user", content: pageReviewPrompt(chunk) }],
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "company_intelligence_review",
        reference: input.reference,
      },
    });
    if (response.provider !== "genx")
      throw new Error("AI review is unavailable because GenX is not configured.");
    const parsed = z.array(pageReviewItemSchema).max(PAGE_REVIEW_MAX_ITEMS).safeParse(parseReviewArray(response.content));
    if (!parsed.success)
      throw new Error("The AI review response did not pass the required evidence schema.");
    items.push(...parsed.data.map(item =>
      verifyPageReviewProvenance(
        {
          ...item,
          title: compact(item.title, 220),
          summary: compact(item.summary, 2_000),
          evidenceText: compact(item.evidenceText, PAGE_REVIEW_EVIDENCE_CHARS),
        },
        chunk
      )
    ));
  }
  return {
    agentKey: "company_intelligence_review",
    available: true,
    items: reconcilePageReview(items),
    reviewedAt: new Date().toISOString(),
  };
}

export function protectCompanyIntelligenceItem(item: CompanyIntelligenceReviewItem) {
  return guardPageReviewItem(item);
}
