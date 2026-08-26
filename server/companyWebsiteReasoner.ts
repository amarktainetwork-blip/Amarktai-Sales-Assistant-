import { z } from "zod";
import { runGenxAgent } from "./genx";
import {
  COMPANY_INTELLIGENCE_CLASSIFICATIONS,
  protectCompanyIntelligenceItem,
  verifyPageReviewProvenance,
  type CompanyIntelligenceReview,
  type CompanyIntelligenceReviewItem,
} from "./companyIntelligenceReview";

type ReviewPage = {
  url: string;
  title: string | null;
  fetchedAt: string;
  text: string;
};

const MAX_SITE_CONTEXT_CHARS = 52_000;
const MAX_PAGE_CHARS = 14_000;
const MAX_EXTRACTION_CHUNKS = 12;
const MAX_EXTRACTION_ITEMS = 80;
const MAX_EVIDENCE_CHARS = 600;

const siteEvidenceSchema = z.object({
  sourceUrl: z.string().url().max(1024),
  evidenceText: z.string().trim().min(2).max(MAX_EVIDENCE_CHARS),
});

const siteContextSchema = z
  .object({
    companyName: z.string().trim().min(1).max(220).nullable(),
    companySummary: z.string().trim().min(1).max(1200).nullable(),
    firstPartySignals: z.array(siteEvidenceSchema).max(16),
    ownOfferings: z
      .array(
        siteEvidenceSchema.extend({
          name: z.string().trim().min(1).max(220),
        })
      )
      .max(40),
    comparisonOrCompetitorSignals: z
      .array(
        siteEvidenceSchema.extend({
          label: z.string().trim().min(1).max(220),
        })
      )
      .max(40),
    currentPriceSignals: z
      .array(
        siteEvidenceSchema.extend({
          offeringName: z.string().trim().min(1).max(220).nullable(),
        })
      )
      .max(40),
    warnings: z.array(z.string().trim().min(2).max(500)).max(30),
  })
  .strict();

type SiteContext = z.infer<typeof siteContextSchema>;

const itemSchema = z
  .object({
    classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
    title: z.string().trim().min(1).max(220),
    summary: z.string().trim().min(1).max(2000),
    sourceUrls: z.array(z.string().url().max(1024)).min(1).max(8),
    pageTitle: z.string().trim().max(500).nullable(),
    fetchedAt: z.string().datetime(),
    evidenceText: z.string().trim().min(2).max(MAX_EVIDENCE_CHARS),
    confidence: z.enum(["high", "medium", "low"]),
    reviewState: z.enum(["review_required", "ambiguous", "conflict"]),
    trustEligible: z.boolean(),
    offering: z
      .object({
        name: z.string().trim().min(1).max(220),
        type: z.string().trim().max(100).optional(),
        currentPrices: z.array(z.string().trim().max(80)).max(12).optional(),
        duration: z.array(z.string().trim().max(120)).max(12).optional(),
        certifications: z.array(z.string().trim().max(160)).max(20).optional(),
        financeOptions: z.array(z.string().trim().max(500)).max(12).optional(),
        support: z.array(z.string().trim().max(500)).max(12).optional(),
        targetCustomer: z.string().trim().max(600).optional(),
        outcomes: z.array(z.string().trim().max(500)).max(12).optional(),
      })
      .optional(),
  })
  .strict();

const reconciliationSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(MAX_EXTRACTION_ITEMS - 1),
            classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
            trustEligible: z.boolean(),
            reviewState: z.enum(["review_required", "ambiguous", "conflict"]),
            confidence: z.enum(["high", "medium", "low"]),
          })
          .strict()
      )
      .max(MAX_EXTRACTION_ITEMS),
  })
  .strict();

function compact(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
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

function parseObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start)
    throw new Error("Website intelligence returned no JSON object.");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function parseArray(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start)
    throw new Error("Website intelligence returned no JSON array.");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function pageWeight(page: ReviewPage) {
  const target = `${page.url} ${page.title || ""}`.toLowerCase();
  let score = 0;
  if (/\/\s*$/.test(new URL(page.url).pathname)) score += 100;
  if (/price|pricing|fee|cost/.test(target)) score += 95;
  if (/course|programme|program|training|service|product/.test(target)) score += 90;
  if (/finance|payment|deposit|funding/.test(target)) score += 82;
  if (/certif|accredit/.test(target)) score += 74;
  if (/support|career|outcome|job/.test(target)) score += 68;
  if (/about|contact|faq/.test(target)) score += 55;
  if (/blog|news|privacy|terms|cookie/.test(target)) score -= 35;
  return score;
}

function siteContextPages(pages: ReviewPage[]) {
  const ordered = [...pages]
    .filter(page => page.url && page.text.trim())
    .sort((a, b) => pageWeight(b) - pageWeight(a));
  const selected: Array<ReviewPage & { text: string }> = [];
  let used = 0;
  for (const page of ordered) {
    if (used >= MAX_SITE_CONTEXT_CHARS) break;
    const remaining = MAX_SITE_CONTEXT_CHARS - used;
    const text = page.text.slice(0, Math.min(MAX_PAGE_CHARS, remaining));
    if (text.trim().length < 80) continue;
    selected.push({ ...page, text });
    used += text.length + page.url.length + (page.title?.length || 0) + 40;
  }
  return selected;
}

function evidenceExists(page: ReviewPage | undefined, evidenceText: string) {
  if (!page) return false;
  const evidence = normaliseEvidence(evidenceText);
  return evidence.length >= 2 && normaliseEvidence(page.text).includes(evidence);
}

function verifiedSiteContext(value: SiteContext, pages: ReviewPage[]): SiteContext {
  const byUrl = new Map(pages.map(page => [page.url, page]));
  const keep = <T extends { sourceUrl: string; evidenceText: string }>(item: T) =>
    Boolean(byUrl.has(item.sourceUrl) && evidenceExists(byUrl.get(item.sourceUrl), item.evidenceText));
  return {
    ...value,
    firstPartySignals: value.firstPartySignals.filter(keep),
    ownOfferings: value.ownOfferings.filter(keep),
    comparisonOrCompetitorSignals: value.comparisonOrCompetitorSignals.filter(keep),
    currentPriceSignals: value.currentPriceSignals.filter(keep),
  };
}

function contextPrompt(pages: ReviewPage[]) {
  return `Read this authorised public website as one coherent site, not as isolated snippets. Build a site-level context map for a later evidence extraction pass. Return JSON only.

You must distinguish the website owner's own products/services/courses from competitor comparisons, examples, testimonials, historical claims, blog commentary and navigation. Never infer a fact that is not in the supplied pages. Every firstPartySignal, ownOffering, comparisonOrCompetitorSignal and currentPriceSignal must contain a short evidenceText copied verbatim from the cited sourceUrl.

Return exactly:
{"companyName":string|null,"companySummary":string|null,"firstPartySignals":[{"sourceUrl":"https://...","evidenceText":"exact quote"}],"ownOfferings":[{"name":"...","sourceUrl":"https://...","evidenceText":"exact quote"}],"comparisonOrCompetitorSignals":[{"label":"...","sourceUrl":"https://...","evidenceText":"exact quote"}],"currentPriceSignals":[{"offeringName":"..."|null,"sourceUrl":"https://...","evidenceText":"exact quote"}],"warnings":["..."]}

Pages:\n${JSON.stringify(
    pages.map(page => ({
      url: page.url,
      pageTitle: page.title,
      fetchedAt: page.fetchedAt,
      text: page.text,
    }))
  )}`;
}

function extractionChunks(pages: ReviewPage[]) {
  const ordered = [...pages]
    .filter(page => page.url && page.text.trim())
    .sort((a, b) => pageWeight(b) - pageWeight(a));
  const chunks: ReviewPage[][] = [];
  let current: ReviewPage[] = [];
  let used = 0;
  for (const page of ordered) {
    if (chunks.length >= MAX_EXTRACTION_CHUNKS) break;
    const bounded = { ...page, text: page.text.slice(0, MAX_PAGE_CHARS) };
    const size = bounded.text.length + bounded.url.length + (bounded.title?.length || 0);
    if (current.length && used + size > 34_000) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(bounded);
    used += size;
  }
  if (current.length && chunks.length < MAX_EXTRACTION_CHUNKS) chunks.push(current);
  return chunks;
}

function extractionPrompt(context: SiteContext, pages: ReviewPage[]) {
  return `Extract human-review company intelligence from these pages using the site-wide context map below. Return ONLY a JSON array.

This is a first-party knowledge build. Understand the surrounding website context before classifying a statement. A competitor price on a comparison page must not become this company's price. A testimonial must not become a company promise. Historical prices must not become current prices.

Rules:
- Use only facts present in the supplied pages.
- evidenceText must be a short verbatim quote from one cited source URL.
- sourceUrls must be URLs supplied in this request.
- pageTitle must exactly match the supplied title for the evidence page, or null when that page title is null.
- Offering fields must copy the wording/value from the cited page; do not normalise a price into a different string.
- Set trustEligible=true only for clearly current, first-party business facts.
- Any comparison, competitor, example, testimonial, historical, navigation or uncertain ownership must be false and ambiguous.
- Output remains a human-review draft; reviewState is review_required for a clear first-party fact, ambiguous for uncertainty, conflict for contradictory current first-party facts.

Classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Site-wide context map (already evidence-checked):\n${JSON.stringify(context)}

Required item shape:
{"classification":"company_offering","title":"...","summary":"...","sourceUrls":["https://..."],"pageTitle":"..."|null,"fetchedAt":"ISO timestamp","evidenceText":"verbatim quote","confidence":"high|medium|low","reviewState":"review_required|ambiguous|conflict","trustEligible":true,"offering":{"name":"...","type":"...","currentPrices":["..."],"duration":["..."],"certifications":["..."],"financeOptions":["..."],"support":["..."],"targetCustomer":"...","outcomes":["..."]}}

Pages:\n${JSON.stringify(
    pages.map(page => ({
      url: page.url,
      pageTitle: page.title,
      fetchedAt: page.fetchedAt,
      text: page.text,
    }))
  )}`;
}

function reconciliationPrompt(context: SiteContext, items: CompanyIntelligenceReviewItem[]) {
  return `Reconcile these already provenance-checked company-intelligence items using the site-wide context. Do not create, rewrite or add facts. Return JSON only with one decision per index.

Your task is ownership/currentness reconciliation across the whole website:
- keep clearly first-party current facts eligible for human approval;
- comparison, competitor, example, testimonial, historical, navigation and marketing-only claims must not be trusted;
- if the same first-party offering has contradictory current prices, mark the affected price/offering items conflict and trustEligible=false;
- uncertainty must narrow trust, never invent certainty.

Return {"decisions":[{"index":0,"classification":"...","trustEligible":true,"reviewState":"review_required","confidence":"high"}]}.
Classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Site context:\n${JSON.stringify(context)}

Items:\n${JSON.stringify(
    items.map((item, index) => ({
      index,
      classification: item.classification,
      title: item.title,
      summary: item.summary,
      sourceUrls: item.sourceUrls,
      pageTitle: item.pageTitle,
      evidenceText: item.evidenceText,
      offering: item.offering,
      trustEligible: item.trustEligible,
      reviewState: item.reviewState,
      confidence: item.confidence,
    }))
  )}`;
}

export async function reasonAboutCompanyWebsite(input: {
  userId: number;
  organisationId: number;
  pages: ReviewPage[];
  reference: string;
}): Promise<CompanyIntelligenceReview & { model?: string; siteContext: SiteContext }> {
  const readable = input.pages.filter(page => page.url && page.text.trim());
  if (!readable.length)
    throw new Error("No readable website material is available for AI interpretation.");

  const contextPages = siteContextPages(readable);
  const contextResponse = await runGenxAgent({
    agentKey: "company_intelligence_review",
    modelTier: "reasoning",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "company_website_context",
      reference: `${input.reference}:context`,
    },
    messages: [{ role: "user", content: contextPrompt(contextPages) }],
  });
  if (contextResponse.provider !== "genx")
    throw new Error("GenX reasoning is required for website interpretation.");
  const parsedContext = siteContextSchema.safeParse(parseObject(contextResponse.content));
  if (!parsedContext.success)
    throw new Error("GenX site-context reasoning did not pass the required schema.");
  const siteContext = verifiedSiteContext(parsedContext.data, readable);

  const extracted: CompanyIntelligenceReviewItem[] = [];
  let model = contextResponse.model;
  const chunks = extractionChunks(readable);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const response = await runGenxAgent({
      agentKey: "company_intelligence_review",
      modelTier: "reasoning",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "company_website_extract",
        reference: `${input.reference}:extract:${index}`,
      },
      messages: [{ role: "user", content: extractionPrompt(siteContext, chunk) }],
    });
    if (response.provider !== "genx")
      throw new Error("GenX reasoning became unavailable during website extraction.");
    model = response.model || model;
    const parsed = z.array(itemSchema).max(24).safeParse(parseArray(response.content));
    if (!parsed.success)
      throw new Error(`GenX website extraction chunk ${index + 1} failed the evidence schema.`);
    for (const item of parsed.data) {
      const checked = verifyPageReviewProvenance(item, chunk);
      extracted.push(protectCompanyIntelligenceItem(checked));
      if (extracted.length >= MAX_EXTRACTION_ITEMS) break;
    }
    if (extracted.length >= MAX_EXTRACTION_ITEMS) break;
  }

  if (!extracted.length)
    throw new Error("GenX did not produce any evidence-grounded company intelligence.");

  const reconcileResponse = await runGenxAgent({
    agentKey: "company_intelligence_review",
    modelTier: "reasoning",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "company_website_reconcile",
      reference: `${input.reference}:reconcile`,
    },
    messages: [
      {
        role: "user",
        content: reconciliationPrompt(siteContext, extracted),
      },
    ],
  });
  if (reconcileResponse.provider !== "genx")
    throw new Error("GenX reasoning became unavailable during website reconciliation.");
  model = reconcileResponse.model || model;
  const reconciliation = reconciliationSchema.safeParse(parseObject(reconcileResponse.content));
  if (!reconciliation.success)
    throw new Error("GenX website reconciliation did not pass the required schema.");

  const byIndex = new Map(reconciliation.data.decisions.map(item => [item.index, item]));
  const reconciled = extracted.map((item, index) => {
    const decision = byIndex.get(index);
    if (!decision)
      return protectCompanyIntelligenceItem({
        ...item,
        trustEligible: false,
        reviewState: "ambiguous",
        confidence: "low",
      });
    return protectCompanyIntelligenceItem({
      ...item,
      classification: decision.classification,
      trustEligible: decision.trustEligible && item.reviewState !== "ambiguous",
      reviewState: decision.reviewState,
      confidence: decision.confidence,
    });
  });

  return {
    agentKey: "company_intelligence_review",
    available: true,
    items: reconciled,
    reviewedAt: new Date().toISOString(),
    model,
    siteContext,
  };
}
