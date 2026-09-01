export type WebsiteKnowledgeApprovalCandidate = {
  title: string;
  content: string;
  category?: string;
  sourceUrl?: string;
  reviewState?: string;
  trustEligible?: boolean;
  offering?: {
    name?: string;
    type?: string;
    planName?: string;
  };
  priceFacts?: Array<unknown>;
};

export type WebsiteKnowledgeCorrection = {
  index: number;
  title: string;
  content: string;
};

export type BusinessBasicsApprovalItem = WebsiteKnowledgeCorrection & {
  group: "company" | "offerings" | "credentials" | "contact";
  sourceUrl?: string;
};

const permanentlyCommercialCategories = new Set([
  "pricing",
  "finance",
  "company_price",
  "company_finance",
]);

const companyCategories = new Set([
  "company",
  "home",
  "about",
  "overview",
  "company_overview",
]);

const offeringCategories = new Set([
  "career_programmes",
  "individual_courses",
  "products_services",
  "offering",
  "company_offering",
]);

const credentialCategories = new Set([
  "certifications",
  "company_certification",
]);

const commercialTextPattern =
  /(?:[£$€]\s?\d|\b(?:GBP|USD|EUR)\b|\b(?:price|pricing|cost|costs|fee|fees|deposit|finance|financing|apr|interest\s+rate|payment\s+plan|pay\s+monthly|monthly\s+payment|salary|salaries|earnings?|guarantee|guaranteed|refund|money[- ]back)\b)/i;

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedKey(value: string) {
  return compactText(value).toLowerCase();
}

export function containsCommercialKnowledge(value: string) {
  return commercialTextPattern.test(value);
}

export function isPermanentlyCommercialKnowledgeCategory(category?: string) {
  return permanentlyCommercialCategories.has(category || "");
}

export function websiteKnowledgeNeedsCommercialReview(
  candidate: WebsiteKnowledgeApprovalCandidate
) {
  return (
    isPermanentlyCommercialKnowledgeCategory(candidate.category) ||
    Boolean(candidate.priceFacts?.length) ||
    containsCommercialKnowledge(`${candidate.title}\n${candidate.content}`)
  );
}

export function websiteKnowledgePassesCommercialApprovalPolicy(
  candidate: WebsiteKnowledgeApprovalCandidate,
  correction?: Pick<WebsiteKnowledgeCorrection, "title" | "content">
) {
  if (isPermanentlyCommercialKnowledgeCategory(candidate.category)) return false;
  if (!websiteKnowledgeNeedsCommercialReview(candidate)) return true;
  if (!correction) return false;
  return !containsCommercialKnowledge(`${correction.title}\n${correction.content}`);
}

function safeIdentityTitle(value: string) {
  const title = compactText(value);
  if (!title || containsCommercialKnowledge(title)) return null;
  return title.slice(0, 220);
}

/**
 * Keep useful descriptive website content while dropping sentences that contain
 * prices, finance, guarantees or other commercial claims. The client can still
 * deliberately confirm commercial details elsewhere; this review never trusts
 * them silently.
 */
function safeDescriptiveContent(value: string) {
  const segments = value
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(compactText)
    .filter(Boolean)
    .filter(segment => !containsCommercialKnowledge(segment));
  const content = compactText(segments.join(" "));
  return content ? content.slice(0, 40_000) : null;
}

function offeringFallback(candidate: WebsiteKnowledgeApprovalCandidate, name: string) {
  const rawType = compactText(candidate.offering?.type || "");
  const type = rawType && !containsCommercialKnowledge(rawType) ? rawType : "offering";
  const readableType = type.replaceAll("_", " ");
  const article = /^[aeiou]/i.test(readableType) ? "an" : "a";
  return `${name} is ${article} ${readableType} offered by the business.`;
}

function safeOfferingIdentity(candidate: WebsiteKnowledgeApprovalCandidate) {
  const name = safeIdentityTitle(candidate.offering?.name || candidate.title);
  if (!name) return null;
  return {
    title: name,
    content:
      safeDescriptiveContent(candidate.content) || offeringFallback(candidate, name),
    sourceUrl: candidate.sourceUrl,
  };
}

function safeCompanyIdentity(candidate: WebsiteKnowledgeApprovalCandidate) {
  const name = safeIdentityTitle(candidate.title);
  if (!name) return null;
  return {
    title: name,
    content:
      safeDescriptiveContent(candidate.content) ||
      `${name} is part of the organisation identity confirmed during company setup.`,
    sourceUrl: candidate.sourceUrl,
  };
}

function safeKnowledgeFact(candidate: WebsiteKnowledgeApprovalCandidate) {
  const title = safeIdentityTitle(candidate.title);
  const content = safeDescriptiveContent(candidate.content);
  if (!title || !content) return null;
  return { title, content, sourceUrl: candidate.sourceUrl };
}

export function buildBusinessBasicsApproval(
  candidates: WebsiteKnowledgeApprovalCandidate[]
): BusinessBasicsApprovalItem[] {
  const result: BusinessBasicsApprovalItem[] = [];
  const seen = new Set<string>();

  candidates.forEach((candidate, index) => {
    if (candidate.trustEligible === false) return;
    if (["conflict", "ambiguous"].includes(candidate.reviewState || "")) return;

    const category = candidate.category || "";
    let item: Omit<BusinessBasicsApprovalItem, "index"> | null = null;

    if (offeringCategories.has(category)) {
      const identity = safeOfferingIdentity(candidate);
      if (!identity) return;
      item = { ...identity, group: "offerings" };
    } else if (companyCategories.has(category)) {
      const identity = safeCompanyIdentity(candidate);
      if (!identity) return;
      item = { ...identity, group: "company" };
    } else if (credentialCategories.has(category)) {
      const fact = safeKnowledgeFact(candidate);
      if (!fact) return;
      item = { ...fact, group: "credentials" };
    } else if (category === "contact") {
      const fact = safeKnowledgeFact(candidate);
      if (!fact) return;
      item = { ...fact, group: "contact" };
    }

    if (!item?.title || !item.content) return;
    const key = `${item.group}:${normalizedKey(item.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ index, ...item });
  });

  return result;
}

export function businessBasicsCounts(items: BusinessBasicsApprovalItem[]) {
  return items.reduce(
    (counts, item) => {
      counts[item.group] += 1;
      return counts;
    },
    { company: 0, offerings: 0, credentials: 0, contact: 0 }
  );
}
