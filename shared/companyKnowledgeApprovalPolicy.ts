export type WebsiteKnowledgeApprovalCandidate = {
  title: string;
  content: string;
  category?: string;
  reviewState?: string;
  trustEligible?: boolean;
  sourcePageIds?: string[];
  offering?: {
    name?: string;
    type?: string;
    planName?: string;
    description?: string;
    targetCustomer?: string;
    outcomes?: string[];
    support?: string[];
    includedCourses?: string[];
    includedExams?: string[];
    certifications?: string[];
    sourcePageIds?: string[];
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

export type SalesFocusSuggestion = BusinessBasicsApprovalItem & {
  score: number;
  reason: string;
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

function safeDescriptiveText(value?: string, maximum = 40_000) {
  const content = compactText(value || "");
  if (!content || containsCommercialKnowledge(content)) return "";
  return content.slice(0, maximum);
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

function safeOfferingIdentity(candidate: WebsiteKnowledgeApprovalCandidate) {
  const name = safeIdentityTitle(candidate.offering?.name || candidate.title);
  if (!name) return null;

  const rawType = compactText(candidate.offering?.type || "");
  const type = rawType && !containsCommercialKnowledge(rawType) ? rawType : "offering";
  const details = [
    safeDescriptiveText(candidate.offering?.description, 8_000),
    safeDescriptiveText(candidate.offering?.targetCustomer)
      ? `Best suited to: ${safeDescriptiveText(candidate.offering?.targetCustomer, 4_000)}`
      : "",
    candidate.offering?.outcomes?.length
      ? safeDescriptiveText(`Outcomes: ${candidate.offering.outcomes.join("; ")}`, 8_000)
      : "",
    candidate.offering?.support?.length
      ? safeDescriptiveText(`Support: ${candidate.offering.support.join("; ")}`, 8_000)
      : "",
  ].filter(Boolean);

  // Prefer the model's field-level sourced, non-commercial description. If the
  // only available content is commercial, retain identity without silently
  // trusting price/finance/guarantee claims.
  const content = details.length
    ? details.join("\n\n")
    : `${name} is a ${type.replaceAll("_", " ")} offered by the business.`;
  return { title: name, content: content.slice(0, 40_000) };
}

function safeCompanyIdentity(candidate: WebsiteKnowledgeApprovalCandidate) {
  const name = safeIdentityTitle(candidate.title);
  if (!name) return null;
  const description = safeDescriptiveText(candidate.content, 40_000);
  return {
    title: name,
    content:
      description ||
      `${name} is the organisation identified during company setup.`,
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
      const identity = safeCompanyIdentity(candidate);
      if (!identity) return;
      item = { ...identity, group: "company" };
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

function offeringRichness(candidate: WebsiteKnowledgeApprovalCandidate) {
  const offering = candidate.offering;
  if (!offering) return 0;
  const sourceCount = new Set([
    ...(candidate.sourcePageIds || []),
    ...(offering.sourcePageIds || []),
  ]).size;
  const detailSignals = [
    offering.description,
    offering.targetCustomer,
    ...(offering.outcomes || []),
    ...(offering.support || []),
    ...(offering.includedCourses || []),
    ...(offering.includedExams || []),
    ...(offering.certifications || []),
  ].filter(value => compactText(value || "").length > 0).length;
  return sourceCount * 10 + Math.min(detailSignals, 12);
}

/**
 * Suggests the most strongly evidenced offering groups without assuming that
 * website prominence proves actual sales volume. A manager still confirms the
 * focus, and CRM performance can later provide stronger evidence.
 */
export function buildSalesFocusSuggestions(
  candidates: WebsiteKnowledgeApprovalCandidate[],
  maximum = 3
): SalesFocusSuggestion[] {
  const basics = buildBusinessBasicsApproval(candidates);
  const byIndex = new Map(basics.map(item => [item.index, item]));
  return candidates
    .map((candidate, index) => ({ candidate, index, item: byIndex.get(index) }))
    .filter(
      (entry): entry is typeof entry & { item: BusinessBasicsApprovalItem } =>
        Boolean(entry.item && entry.item.group === "offerings")
    )
    .map(({ candidate, item }) => {
      const score = offeringRichness(candidate);
      const sourceCount = new Set([
        ...(candidate.sourcePageIds || []),
        ...(candidate.offering?.sourcePageIds || []),
      ]).size;
      return {
        ...item,
        score,
        reason:
          sourceCount > 1
            ? `Strongly represented across ${sourceCount} website sources`
            : "A clearly described company offering",
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, Math.min(5, maximum)));
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
