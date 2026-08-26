import { z } from "zod";
import type { DiscoveryKnowledgeCandidate } from "./companyDiscovery";
import { runGenxAgent } from "./genx";

export const COMPANY_INTELLIGENCE_CLASSIFICATIONS = [
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

/**
 * A deliberately conservative deterministic guard that runs after the model.
 * The model may narrow trust, but obvious comparison/testimonial/history
 * language can never be promoted automatically by a model decision.
 */
export function deterministicRiskClassification(
  candidate: Pick<DiscoveryKnowledgeCandidate, "title" | "content" | "category">
): CompanyIntelligenceClassification | undefined {
  const text = `${candidate.title} ${candidate.content} ${candidate.category}`.toLowerCase();
  if (
    /\b(?:compare|comparison|compared with|versus|vs\.?|competitor|other provider|another provider|alternative provider)\b/.test(
      text
    )
  )
    return "comparison";
  if (
    /\b(?:testimonial|learner story|student story|customer story|what our learners say|case study)\b/.test(
      text
    )
  )
    return /case study/.test(text) ? "case_study" : "testimonial";
  if (
    /\b(?:historical|previously|formerly|used to cost|old price|was priced at|past price)\b/.test(
      text
    )
  )
    return "historical";
  return undefined;
}

function parseModelJson(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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
    const correctedContent = compact(
      decision.correctedContent || candidate.content,
      8_000
    );

    return {
      ...candidate,
      ...(correctedTitle !== candidate.title
        ? { originalTitle: candidate.title, title: correctedTitle }
        : {}),
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
    const chunk = input.candidates
      .slice(offset, offset + chunkSize)
      .map((candidate, localIndex) => ({
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
      messages: [
        {
          role: "user",
          content: promptForChunk({
            companyName: compact(input.companyName, 220) || "the company",
            candidates: chunk,
          }),
        },
      ],
    });
    if (response.provider === "not_configured")
      throw new Error("Amarktai intelligence is not configured for website interpretation.");
    const parsed = parseModelJson(response.content);
    const expected = new Set(chunk.map(item => item.index));
    if (
      parsed.items.length !== chunk.length ||
      parsed.items.some(item => !expected.has(item.index))
    )
      throw new Error("Company intelligence review did not cover the exact candidate set.");
    decisions.push(...parsed.items);
  }

  const candidates = applyCompanyIntelligenceDecisions(input.candidates, decisions);
  const classificationCounts = candidates.reduce<Record<string, number>>(
    (counts, candidate) => {
      counts[candidate.classification] = (counts[candidate.classification] || 0) + 1;
      return counts;
    },
    {}
  );
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
