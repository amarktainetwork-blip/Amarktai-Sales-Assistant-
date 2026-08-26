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

const MAX_SITE_CONTEXT_CHARS = 16_000;
const MAX_PAGE_CHARS = 6_000;
const EXTRACTION_CHUNK_CHARS = 12_000;
const MAX_EXTRACTION_CHUNKS = 18;
const MAX_EXTRACTION_ITEMS = 64;
const MAX_ITEMS_PER_EXTRACTION = 8;
const RECONCILE_CHUNK_SIZE = 10;
const MAX_EVIDENCE_CHARS = 600;
const MAX_CONTEXT_EVIDENCE_CHARS = 220;

const siteEvidenceSchema = z.object({
  sourceUrl: z.string().url().max(1024),
  evidenceText: z
    .string()
    .trim()
    .min(2)
    .max(MAX_CONTEXT_EVIDENCE_CHARS),
});

const siteContextSchema = z
  .object({
    companyName: z.string().trim().min(1).max(220).nullable(),
    companySummary: z.string().trim().min(1).max(600).nullable(),
    firstPartySignals: z.array(siteEvidenceSchema).max(4),
    ownOfferings: z
      .array(
        siteEvidenceSchema.extend({
          name: z.string().trim().min(1).max(220),
        })
      )
      .max(8),
    comparisonOrCompetitorSignals: z
      .array(
        siteEvidenceSchema.extend({
          label: z.string().trim().min(1).max(220),
        })
      )
      .max(6),
    currentPriceSignals: z
      .array(
        siteEvidenceSchema.extend({
          offeringName: z.string().trim().min(1).max(220).nullable(),
        })
      )
      .max(8),
    warnings: z.array(z.string().trim().min(2).max(240)).max(6),
  })
  .strict();

type SiteContext = z.infer<typeof siteContextSchema>;

const itemSchema = z
  .object({
    classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
    title: z.string().trim().min(1).max(220),
    summary: z.string().trim().min(1).max(1200),
    sourceUrls: z.array(z.string().url().max(1024)).min(1).max(4),
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
        currentPrices: z.array(z.string().trim().max(80)).max(6).optional(),
        duration: z.array(z.string().trim().max(120)).max(6).optional(),
        certifications: z.array(z.string().trim().max(160)).max(10).optional(),
        financeOptions: z.array(z.string().trim().max(360)).max(6).optional(),
        support: z.array(z.string().trim().max(360)).max(6).optional(),
        targetCustomer: z.string().trim().max(420).optional(),
        outcomes: z.array(z.string().trim().max(360)).max(6).optional(),
      })
      .optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    index: z.number().int().min(0).max(MAX_EXTRACTION_ITEMS - 1),
    classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
    trustEligible: z.boolean(),
    reviewState: z.enum(["review_required", "ambiguous", "conflict"]),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

const reconciliationSchema = z
  .object({
    decisions: z.array(decisionSchema).max(RECONCILE_CHUNK_SIZE),
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
  if (new URL(page.url).pathname === "/") score += 110;
  if (/price|pricing|fee|cost/.test(target)) score += 100;
  if (/course|programme|program|training|service|product/.test(target)) score += 92;
  if (/finance|payment|deposit|funding/.test(target)) score += 84;
  if (/certif|accredit/.test(target)) score += 76;
  if (/support|career|outcome|job/.test(target)) score += 70;
  if (/about|contact|faq/.test(target)) score += 56;
  if (/blog|news|privacy|terms|cookie/.test(target)) score -= 40;
  return score;
}

function siteContextPages(pages: ReviewPage[]) {
  const ordered = [...pages]
    .filter(page => page.url && page.text.trim())
    .sort((a, b) => pageWeight(b) - pageWeight(a));
  const selected: ReviewPage[] = [];
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
  return (
    evidence.length >= 2 && normaliseEvidence(page.text).includes(evidence)
  );
}

function verifiedSiteContext(value: SiteContext, pages: ReviewPage[]): SiteContext {
  const byUrl = new Map(pages.map(page => [page.url, page]));
  const keep = <T extends { sourceUrl: string; evidenceText: string }>(item: T) =>
    Boolean(
      byUrl.has(item.sourceUrl) &&
        evidenceExists(byUrl.get(item.sourceUrl), item.evidenceText)
    );
  return {
    ...value,
    firstPartySignals: value.firstPartySignals.filter(keep),
    ownOfferings: value.ownOfferings.filter(keep),
    comparisonOrCompetitorSignals:
      value.comparisonOrCompetitorSignals.filter(keep),
    currentPriceSignals: value.currentPriceSignals.filter(keep),
  };
}

function contextPrompt(pages: ReviewPage[]) {
  return `Read this authorised public website as one coherent business site. Build a concise context map for later evidence extraction. Return JSON only.

Distinguish the website owner's own offerings from competitor comparisons, examples, testimonials, historical claims, blog commentary and navigation. Never infer a fact. Every evidenceText must be a short verbatim quote from its sourceUrl.

Keep the response compact: at most 4 firstPartySignals, 8 ownOfferings, 6 comparisonOrCompetitorSignals, 8 currentPriceSignals and 6 warnings.

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
    const size =
      bounded.text.length + bounded.url.length + (bounded.title?.length || 0);
    if (current.length && used + size > EXTRACTION_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(bounded);
    used += size;
  }
  if (current.length && chunks.length < MAX_EXTRACTION_CHUNKS)
    chunks.push(current);
  return chunks;
}

function extractionPrompt(context: SiteContext, pages: ReviewPage[]) {
  return `Extract only the highest-value human-review company intelligence from these pages, using the evidence-checked site context below. Return ONLY a JSON array with at most ${MAX_ITEMS_PER_EXTRACTION} items.

Understand context before classification. A competitor price on a comparison page is not this company's price. A testimonial is not a company promise. A historical price is not a current price.

Rules:
- Use only facts present in these pages.
- evidenceText must be a short verbatim quote from one cited source URL.
- sourceUrls must be supplied URLs.
- pageTitle must exactly match the supplied title for the evidence page, or null.
- Offering values must copy wording/value from the cited page; do not rewrite prices or durations.
- trustEligible=true only for clearly current first-party facts.
- comparison, competitor, example, testimonial, historical, navigation, marketing-only or uncertain ownership => trustEligible=false and ambiguous.
- Prefer useful selling knowledge: offerings, current published prices, finance, certifications, support/outcomes, policies, FAQ and contact facts. Skip duplicate/navigation filler.

Classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Site context:\n${JSON.stringify(context)}

Item shape:
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

function reconciliationPrompt(
  context: SiteContext,
  items: Array<{ index: number; item: CompanyIntelligenceReviewItem }>
) {
  return `Reconcile these provenance-checked items using the site-wide context. Do not create, rewrite or add facts. Return JSON only with exactly one decision per index.

Keep clearly current first-party facts eligible for human approval. Comparisons, competitors, examples, testimonials, historical, navigation and marketing-only claims cannot be trusted. Uncertainty narrows trust.

Return {"decisions":[{"index":0,"classification":"...","trustEligible":true,"reviewState":"review_required","confidence":"high"}]}.
Classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.

Site context:\n${JSON.stringify(context)}

Items:\n${JSON.stringify(
    items.map(({ index, item }) => ({
      index,
      classification: item.classification,
      title: item.title,
      summary: compact(item.summary, 500),
      sourceUrls: item.sourceUrls,
      evidenceText: compact(item.evidenceText, 260),
      offering: item.offering
        ? {
            name: item.offering.name,
            currentPrices: item.offering.currentPrices,
          }
        : undefined,
      trustEligible: item.trustEligible,
      reviewState: item.reviewState,
      confidence: item.confidence,
    }))
  )}`;
}

function normaliseOffering(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalisePrice(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/,/g, "")
    .replace(/\.00\b/g, "");
}

export function applyDeterministicWebsiteConflicts(
  items: CompanyIntelligenceReviewItem[]
) {
  const prices = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.trustEligible || !item.offering?.name) continue;
    const values = item.offering.currentPrices || [];
    if (!values.length) continue;
    const key = normaliseOffering(item.offering.name);
    const set = prices.get(key) || new Set<string>();
    values.forEach(value => set.add(normalisePrice(value)));
    prices.set(key, set);
  }
  return items.map(item => {
    const key = item.offering?.name
      ? normaliseOffering(item.offering.name)
      : undefined;
    if (key && (prices.get(key)?.size || 0) > 1 && item.trustEligible)
      return {
        ...item,
        trustEligible: false,
        reviewState: "conflict" as const,
      };
    return item;
  });
}

function dedupeItems(items: CompanyIntelligenceReviewItem[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = [
      item.classification,
      normaliseOffering(item.offering?.name || item.title),
      normaliseEvidence(item.evidenceText),
      item.sourceUrls[0] || "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function reasonAboutCompanyWebsite(input: {
  userId: number;
  organisationId: number;
  pages: ReviewPage[];
  reference: string;
}): Promise<
  CompanyIntelligenceReview & { model?: string; siteContext: SiteContext }
> {
  const readable = input.pages.filter(page => page.url && page.text.trim());
  if (!readable.length)
    throw new Error(
      "No readable website material is available for AI interpretation."
    );

  const contextResponse = await runGenxAgent({
    agentKey: "company_intelligence_review",
    modelTier: "reasoning",
    billing: {
      userId: input.userId,
      organisationId: input.organisationId,
      feature: "company_website_context",
      reference: `${input.reference}:context`,
    },
    messages: [
      { role: "user", content: contextPrompt(siteContextPages(readable)) },
    ],
  });
  if (contextResponse.provider !== "genx")
    throw new Error("GenX reasoning is required for website interpretation.");
  const parsedContext = siteContextSchema.safeParse(
    parseObject(contextResponse.content)
  );
  if (!parsedContext.success)
    throw new Error(
      "GenX site-context reasoning did not pass the required schema."
    );
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
      messages: [
        { role: "user", content: extractionPrompt(siteContext, chunk) },
      ],
    });
    if (response.provider !== "genx")
      throw new Error(
        "GenX reasoning became unavailable during website extraction."
      );
    model = response.model || model;
    const parsed = z
      .array(itemSchema)
      .max(MAX_ITEMS_PER_EXTRACTION)
      .safeParse(parseArray(response.content));
    if (!parsed.success)
      throw new Error(
        `GenX website extraction chunk ${index + 1} failed the evidence schema.`
      );
    for (const item of parsed.data) {
      extracted.push(
        protectCompanyIntelligenceItem(
          verifyPageReviewProvenance(item, chunk)
        )
      );
      if (extracted.length >= MAX_EXTRACTION_ITEMS) break;
    }
    if (extracted.length >= MAX_EXTRACTION_ITEMS) break;
  }

  const unique = dedupeItems(extracted);
  if (!unique.length)
    throw new Error(
      "GenX did not produce any evidence-grounded company intelligence."
    );

  const decisions = new Map<number, z.infer<typeof decisionSchema>>();
  for (let offset = 0; offset < unique.length; offset += RECONCILE_CHUNK_SIZE) {
    const slice = unique
      .slice(offset, offset + RECONCILE_CHUNK_SIZE)
      .map((item, localIndex) => ({ index: offset + localIndex, item }));
    const response = await runGenxAgent({
      agentKey: "company_intelligence_review",
      modelTier: "reasoning",
      billing: {
        userId: input.userId,
        organisationId: input.organisationId,
        feature: "company_website_reconcile",
        reference: `${input.reference}:reconcile:${offset}`,
      },
      messages: [
        {
          role: "user",
          content: reconciliationPrompt(siteContext, slice),
        },
      ],
    });
    if (response.provider !== "genx")
      throw new Error(
        "GenX reasoning became unavailable during website reconciliation."
      );
    model = response.model || model;
    const parsed = reconciliationSchema.safeParse(parseObject(response.content));
    if (!parsed.success)
      throw new Error(
        "GenX website reconciliation did not pass the required schema."
      );
    const expected = new Set(slice.map(item => item.index));
    if (
      parsed.data.decisions.length !== slice.length ||
      parsed.data.decisions.some(item => !expected.has(item.index))
    )
      throw new Error(
        "GenX website reconciliation did not cover the exact item set."
      );
    parsed.data.decisions.forEach(item => decisions.set(item.index, item));
  }

  const reconciled = unique.map((item, index) => {
    const decision = decisions.get(index);
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
      trustEligible:
        decision.trustEligible && item.reviewState !== "ambiguous",
      reviewState: decision.reviewState,
      confidence: decision.confidence,
    });
  });

  return {
    agentKey: "company_intelligence_review",
    available: true,
    items: applyDeterministicWebsiteConflicts(reconciled),
    reviewedAt: new Date().toISOString(),
    model,
    siteContext,
  };
}
