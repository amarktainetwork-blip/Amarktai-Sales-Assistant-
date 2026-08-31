export type WebsiteKnowledgeApprovalCandidate = {
  title: string;
  content: string;
  category?: string;
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

function safeOfferingIdentity(candidate: WebsiteKnowledgeApprovalCandidate) {
  const name = compactText(candidate.offering?.name || candidate.title);
  if (!name || containsCommercialKnowledge(name)) return null;
  const rawType = compactText(candidate.offering?.type || "");
  const type = rawType && !containsCommercialKnowledge(rawType) ? rawType : "offering";
  return {
    title: name.slice(0, 220),
    content: `${name} is a ${type.replaceAll("_", " ")} offered by the business.`.slice(
      0,
      40_000
    ),
  };
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
    let item:
      | Omit<BusinessBasicsApprovalItem, "index">
      | null = null;

    if (offeringCategories.has(category)) {
      const identity = safeOfferingIdentity(candidate);
      if (!identity) return;
      item = { ...identity, group: "offerings" };
    } else if (companyCategories.has(category)) {
      if (containsCommercialKnowledge(`${candidate.title}\n${candidate.content}`)) return;
      item = {
        title: compactText(candidate.title).slice(0, 220),
        content: compactText(candidate.content).slice(0, 40_000),
        group: "company",
      };
    } else if (credentialCategories.has(category)) {
      if (containsCommercialKnowledge(`${candidate.title}\n${candidate.content}`)) return;
      item = {
        title: compactText(candidate.title).slice(0, 220),
        content: compactText(candidate.content).slice(0, 40_000),
        group: "credentials",
      };
    } else if (category === "contact") {
      if (containsCommercialKnowledge(`${candidate.title}\n${candidate.content}`)) return;
      item = {
        title: compactText(candidate.title).slice(0, 220),
        content: compactText(candidate.content).slice(0, 40_000),
        group: "contact",
      };
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
