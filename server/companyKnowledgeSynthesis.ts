import { z } from "zod";
import {
  COMPANY_INTELLIGENCE_CLASSIFICATIONS,
  protectCompanyIntelligenceItem,
  verifyPageReviewProvenance,
  type CompanyIntelligenceReview,
  type CompanyIntelligenceReviewItem,
} from "./companyIntelligenceReview";
import { applyDeterministicWebsiteConflicts } from "./companyWebsiteReasoner";
import { runGenxAgent } from "./genx";

type ReviewPage = {
  url: string;
  title: string | null;
  fetchedAt: string;
  text: string;
};

const MAX_SYNTHESIS_PAGES = 32;
const MAX_PAGE_CHARS = 4_500;
const MAX_CHUNK_CHARS = 7_000;
const MAX_CHUNKS = 18;
const MAX_ITEMS_PER_CHUNK = 2;
const MAX_EVIDENCE_CHARS = 480;

const synthesisItemSchema = z
  .object({
    classification: z.enum(COMPANY_INTELLIGENCE_CLASSIFICATIONS),
    title: z.string().trim().min(1).max(220),
    summary: z.string().trim().min(1).max(900),
    sourceUrls: z.array(z.string().url().max(1024)).min(1).max(2),
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
        currentPrices: z.array(z.string().trim().max(80)).max(4).optional(),
        duration: z.array(z.string().trim().max(120)).max(4).optional(),
        certifications: z.array(z.string().trim().max(160)).max(8).optional(),
        financeOptions: z.array(z.string().trim().max(320)).max(4).optional(),
        support: z.array(z.string().trim().max(320)).max(4).optional(),
        targetCustomer: z.string().trim().max(420).optional(),
        outcomes: z.array(z.string().trim().max(320)).max(4).optional(),
      })
      .optional(),
  })
  .strict();

const synthesisResponseSchema = z
  .array(synthesisItemSchema)
  .max(MAX_ITEMS_PER_CHUNK);

function compact(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function pageScore(page: ReviewPage) {
  const target = `${page.url} ${page.title || ""}`.toLowerCase();
  const pathname = new URL(page.url).pathname.toLowerCase();
  let score = 0;
  if (pathname === "/") score += 300;
  if (/\/(?:courses?|programmes?|programs?|training|products?|services?)\//.test(pathname))
    score += 230;
  if (/\/job-programmes?\//.test(pathname)) score += 245;
  if (/(?:price|pricing|fees?|cost|finance|payment|funding|deposit)/.test(target))
    score += 190;
  if (/(?:certif|accredit|support|outcome|career-support|job-support)/.test(target))
    score += 145;
  if (/(?:about|contact|faq|terms|refund|cancellation|policy)/.test(target))
    score += 125;
  if (/(?:blog|news|article|career-path|vs-|versus|comparison|compare)/.test(target))
    score -= 180;
  score += Math.min(60, Math.floor(page.text.trim().length / 250));
  return score;
}

export function selectCompanyKnowledgePages(pages: ReviewPage[]) {
  const seen = new Set<string>();
  return [...pages]
    .filter(page => {
      if (!page.url || page.text.trim().length < 80 || seen.has(page.url)) return false;
      seen.add(page.url);
      return true;
    })
    .sort((left, right) => pageScore(right) - pageScore(left))
    .slice(0, MAX_SYNTHESIS_PAGES)
    .map(page => ({ ...page, text: page.text.slice(0, MAX_PAGE_CHARS) }));
}

function synthesisChunks(pages: ReviewPage[]) {
  const chunks: ReviewPage[][] = [];
  let current: ReviewPage[] = [];
  let used = 0;
  for (const page of selectCompanyKnowledgePages(pages)) {
    if (chunks.length >= MAX_CHUNKS) break;
    const size = page.text.length + page.url.length + (page.title?.length || 0) + 80;
    if (current.length && (current.length >= 2 || used + size > MAX_CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(page);
    used += size;
  }
  if (current.length && chunks.length < MAX_CHUNKS) chunks.push(current);
  return chunks;
}

function promptForChunk(chunk: ReviewPage[], repair = false) {
  return `${repair ? "Your previous response was invalid. This is a strict JSON repair attempt. " : ""}Turn these authorised public website pages into CLIENT-READY company knowledge. Return ONLY a compact JSON array with at most ${MAX_ITEMS_PER_CHUNK} high-value items and no markdown.\n\nThis is synthesis, not a currency scraper. Understand what each number means before using it.\n\nRules:\n- Include only facts directly useful to a salesperson: the company's own offerings, current total/full prices, finance, certifications, support/outcomes, contact, FAQ and policies.\n- Do NOT turn page headings, navigation, blog/reference material, competitor comparisons, testimonials or examples into company offerings.\n- A currency amount belongs in offering.currentPrices ONLY when the cited evidence explicitly binds that amount to the CURRENT TOTAL/FULL price of that exact offering.\n- Deposits, monthly instalments, exam fees, component-course prices, discounts, finance examples and unrelated prices must NOT be put in currentPrices. Put a clearly labelled deposit/payment plan in financeOptions only when the exact evidence supports it.\n- A category/landing page containing several courses is not itself an offering unless the page explicitly sells that named bundle/programme.\n- Keep the offering name exactly as the first-party page names it. Do not merge distinct courses because they share a vendor such as EC-Council, Microsoft, CompTIA or Cisco.\n- If two first-party pages genuinely state different current total prices for the same offering, emit the evidence from each page as separate company_offering items; reconciliation will flag the conflict.\n- If ownership, recency or meaning is uncertain, omit the fact rather than guessing.\n- evidenceText must be one short VERBATIM quote from the cited page and must contain or directly support every structured offering claim in that item.\n- sourceUrls must contain only URLs supplied below. pageTitle and fetchedAt must match the supplied page.\n- trustEligible=true only for clear current first-party facts.\n- summary must be concise sales-ready prose grounded only in the evidence.\n\nAllowed classifications: ${COMPANY_INTELLIGENCE_CLASSIFICATIONS.join(", ")}.\n\nItem shape:\n{"classification":"company_offering","title":"...","summary":"...","sourceUrls":["https://..."],"pageTitle":"..."|null,"fetchedAt":"ISO","evidenceText":"exact quote","confidence":"high|medium|low","reviewState":"review_required|ambiguous|conflict","trustEligible":true,"offering":{"name":"...","type":"...","currentPrices":["..."],"duration":["..."],"certifications":["..."],"financeOptions":["..."],"support":["..."],"targetCustomer":"...","outcomes":["..."]}}\n\nPages:\n${JSON.stringify(
    chunk.map(page => ({
      url: page.url,
      pageTitle: page.title,
      fetchedAt: page.fetchedAt,
      text: page.text,
    }))
  )}`;
}

function parseResponse(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || content).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start)
    throw new Error("GenX synthesis returned no JSON array.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("GenX synthesis returned malformed JSON.");
  }
  const checked = synthesisResponseSchema.safeParse(parsed);
  if (!checked.success)
    throw new Error("GenX synthesis did not match the required evidence schema.");
  return checked.data;
}

async function runChunk(input: {
  userId: number;
  organisationId: number;
  reference: string;
  chunk: ReviewPage[];
  chunkIndex: number;
}) {
  let firstFailure: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await runGenxAgent({
        agentKey: "company_intelligence_review",
        modelTier: "reasoning",
        billing: {
          userId: input.userId,
          organisationId: input.organisationId,
          feature: "company_intelligence_review",
          reference: `${input.reference}:chunk-${input.chunkIndex}:attempt-${attempt + 1}`,
        },
        messages: [
          {
            role: "user",
            content: promptForChunk(input.chunk, attempt > 0),
          },
        ],
      });
      if (response.provider !== "genx")
        throw new Error("GenX is not configured for company knowledge synthesis.");
      return parseResponse(response.content);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  const detail =
    firstFailure instanceof Error ? firstFailure.message : String(firstFailure || "unknown failure");
  throw new Error(`GenX could not synthesise website evidence chunk ${input.chunkIndex + 1}: ${detail}`);
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeItems(items: CompanyIntelligenceReviewItem[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = [
      item.classification,
      normalise(item.offering?.name || item.title),
      item.sourceUrls[0] || "",
      compact(item.evidenceText, 180).toLowerCase(),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clientReadyKnowledgeItems(items: CompanyIntelligenceReviewItem[]) {
  return items.filter(item => {
    if (!item.classification.startsWith("company_")) return false;
    if (item.reviewState === "conflict") return true;
    return item.trustEligible && item.reviewState === "review_required";
  });
}

export function buildClientKnowledgeFacts(
  items: CompanyIntelligenceReviewItem[]
) {
  const clientItems = clientReadyKnowledgeItems(items);
  const sources = new Set(clientItems.flatMap(item => item.sourceUrls));
  const offerings = new Map<string, CompanyIntelligenceReviewItem[]>();
  for (const item of clientItems) {
    if (item.classification !== "company_offering" || !item.offering?.name) continue;
    const key = normalise(item.offering.name);
    const current = offerings.get(key) || [];
    current.push(item);
    offerings.set(key, current);
  }
  const pricedOfferings = Array.from(offerings.values()).filter(group =>
    group.some(item => (item.offering?.currentPrices?.length || 0) > 0)
  ).length;
  const conflictGroups = Array.from(offerings.values()).filter(group =>
    group.some(item => item.reviewState === "conflict")
  );
  const conflicts = conflictGroups.map(group => {
    const names = Array.from(
      new Set(group.map(item => item.offering?.name || item.title))
    );
    const values = Array.from(
      new Set(group.flatMap(item => item.offering?.currentPrices || []))
    );
    return {
      type: "current_price",
      displayNames: names,
      values,
      sources: group.map(item => ({
        sourceUrl: item.sourceUrls[0] || "",
        fetchedAt: item.fetchedAt,
        prices: item.offering?.currentPrices || [],
      })),
    };
  });
  const financeInformationFound = clientItems.some(
    item =>
      item.classification === "company_finance" ||
      Boolean(item.offering?.financeOptions?.length)
  );
  const certificationInformationFound = clientItems.some(
    item =>
      item.classification === "company_certification" ||
      Boolean(item.offering?.certifications?.length)
  );
  const supportAndOutcomeInformationFound = clientItems.some(
    item =>
      item.classification === "company_support" ||
      item.classification === "company_evidence" ||
      Boolean(item.offering?.support?.length) ||
      Boolean(item.offering?.outcomes?.length)
  );
  const importantGaps: string[] = [];
  const withoutClearPrice = Math.max(0, offerings.size - pricedOfferings);
  if (withoutClearPrice)
    importantGaps.push(
      `${withoutClearPrice} synthesised offering(s) have no clearly evidenced current total price.`
    );
  if (conflicts.length)
    importantGaps.push(
      `${conflicts.length} genuine first-party price conflict(s) need a human decision.`
    );
  if (!clientItems.some(item => item.classification === "company_contact"))
    importantGaps.push("No client-ready contact fact was synthesised from the retained evidence.");
  if (!clientItems.some(item => item.classification === "company_policy"))
    importantGaps.push("No client-ready refund, cancellation or terms fact was synthesised.");

  return {
    conflicts,
    completeness: {
      pagesCrawled: sources.size,
      offeringsFound: offerings.size,
      offeringsWithPublishedPrice: pricedOfferings,
      unresolvedConflicts: conflicts.length,
      financeInformationFound,
      certificationInformationFound,
      supportAndOutcomeInformationFound,
      importantGaps,
    },
    synthesis: {
      status: "completed",
      clientReadyItems: clientItems.length,
      evidenceSourcesUsed: sources.size,
      excludedOrDiagnosticItems: Math.max(0, items.length - clientItems.length),
    },
  };
}

export async function synthesiseCompanyKnowledge(input: {
  userId: number;
  organisationId: number;
  pages: ReviewPage[];
  reference: string;
}): Promise<CompanyIntelligenceReview> {
  const chunks = synthesisChunks(input.pages);
  if (!chunks.length)
    throw new Error("No readable first-party website evidence is available for GenX synthesis.");

  const extracted: CompanyIntelligenceReviewItem[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const parsed = await runChunk({
      userId: input.userId,
      organisationId: input.organisationId,
      reference: input.reference,
      chunk,
      chunkIndex,
    });
    for (const item of parsed) {
      const grounded = verifyPageReviewProvenance(item, chunk);
      extracted.push(protectCompanyIntelligenceItem(grounded));
    }
  }

  const reconciled = applyDeterministicWebsiteConflicts(dedupeItems(extracted));
  const usable = clientReadyKnowledgeItems(reconciled);
  if (!usable.length)
    throw new Error(
      "GenX completed but produced no provenance-verified first-party knowledge suitable for human review."
    );

  return {
    agentKey: "company_intelligence_review",
    available: true,
    items: reconciled,
    reviewedAt: new Date().toISOString(),
  };
}
