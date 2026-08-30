import type { CompanyCorpusPage } from "./companyKnowledgeCorpus";
import type {
  CompanyKnowledgeSynthesisResult,
  CompanyOffering,
} from "./companyKnowledgeSynthesis";

const MISSING_OFFERING_GAP = /^\d+ likely offering page\(s\) were not represented in the final pack\.$/;

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normaliseIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bprogram(?:me)?s?\b/g, "programme")
    .replace(/\bcourses\b/g, "course")
    .replace(/\s+/g, " ")
    .trim();
}

function pagePath(page: CompanyCorpusPage) {
  return new URL(page.url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
}

function pageLikelyOffering(page: CompanyCorpusPage) {
  const path = pagePath(page);
  const hint = normaliseIdentity(page.pageHint);
  const heading = normaliseIdentity(page.primaryHeading || "");
  const title = normaliseIdentity(page.title || "");
  const target = `${path} ${hint} ${heading}`;

  if (
    /blog|article|career-path|guide|category|testimonial|comparison/.test(
      target
    )
  )
    return false;

  if (/(?:^|[-/])vs(?:[-/]|$)|versus/.test(path)) return false;

  if (
    /^\/(?:finance(?:-terms)?|contact|about|faq|faqs|terms|privacy|refund|cancellation|policies?)(?:\/|$)/.test(
      path
    )
  )
    return false;

  const segments = path.split("/").filter(Boolean);
  if (
    segments[0] === "courses" &&
    segments.length === 2 &&
    /\bcourse and training\b/.test(title)
  )
    return false;

  if (
    !/course|programme|program|product|service|subscription|package/.test(
      target
    )
  )
    return false;

  return !/^\/(?:courses?|programmes?|products?|services?)$/i.test(path);
}

function pageIdentityLabels(page: CompanyCorpusPage) {
  const titleLead = String(page.title || "").split("|")[0];
  return unique([page.primaryHeading || "", titleLead])
    .map(normaliseIdentity)
    .filter(value => value.length >= 10);
}

function pageRepresentsOffering(
  page: CompanyCorpusPage,
  offering: CompanyOffering
) {
  const offeringName = normaliseIdentity(offering.name);
  if (offeringName.length < 10) return false;
  return pageIdentityLabels(page).some(label =>
    label.includes(offeringName) || offeringName.includes(label)
  );
}

function currencyCode(token: string) {
  const normalized = token.toUpperCase();
  if (token === "£" || normalized === "GBP") return "GBP";
  if (token === "$" || normalized === "USD") return "USD";
  if (token === "€" || normalized === "EUR") return "EUR";
  return undefined;
}

function canonicalMoneyValue(value: string) {
  const trimmed = value.trim();
  const prefix = trimmed.match(
    /^(£|\$|€|GBP|USD|EUR)\s*(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)$/i
  );
  const suffix = trimmed.match(
    /^(\d+(?:[,.]\d{3})*(?:[,.]\d{1,2})?)\s*(GBP|USD|EUR)$/i
  );
  const token = prefix?.[1] || suffix?.[2];
  const raw = prefix?.[2] || suffix?.[1];
  if (!token || !raw) return undefined;
  const currency = currencyCode(token);
  if (!currency) return undefined;

  let numeric = raw;
  if (numeric.includes(".") && numeric.includes(",")) numeric = numeric.replace(/,/g, "");
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(numeric))
    numeric = numeric.replace(/,/g, "");
  else numeric = numeric.replace(",", ".");

  const amount = Number(numeric);
  return Number.isFinite(amount) ? `${currency}:${amount.toFixed(2)}` : undefined;
}

function conflictValueKey(value: string) {
  return canonicalMoneyValue(value) || `text:${normaliseIdentity(value)}`;
}

function meaningfulConflicts(
  conflicts: CompanyKnowledgeSynthesisResult["pack"]["conflicts"]
) {
  return conflicts.filter(
    conflict => new Set(conflict.values.map(conflictValueKey)).size > 1
  );
}

export function finaliseCompanyKnowledgeRuntimeResult(
  result: CompanyKnowledgeSynthesisResult
): CompanyKnowledgeSynthesisResult {
  const conflicts = meaningfulConflicts(result.pack.conflicts);
  const pack = { ...result.pack, conflicts };
  const candidatePages = result.corpus.pages.filter(pageLikelyOffering);
  const offeringPages = new Set(
    pack.offerings.flatMap(offering => offering.sourcePageIds)
  );
  const missingLikely = candidatePages.filter(
    page =>
      !offeringPages.has(page.pageId) &&
      !pack.offerings.some(offering => pageRepresentsOffering(page, offering))
  );
  const threshold = Math.max(3, Math.ceil(result.corpus.pageCount * 0.05));
  const cleanupIncomplete = result.cleanupFailures.length > 0;
  const incomplete =
    cleanupIncomplete ||
    !pack.offerings.length ||
    missingLikely.length > threshold;
  const status = incomplete
    ? "incomplete"
    : conflicts.length
      ? "complete_with_conflicts"
      : "complete";

  const priorGaps = result.completeness.importantGaps.filter(
    gap => !MISSING_OFFERING_GAP.test(gap)
  );
  const importantGaps = unique([
    ...priorGaps,
    ...(missingLikely.length
      ? [
          `${missingLikely.length} likely offering page(s) were not represented in the final pack.`,
        ]
      : []),
  ]);

  return {
    ...result,
    pack,
    completeness: {
      ...result.completeness,
      status,
      candidateSellableOfferingsDiscovered: candidatePages.length,
      conflictsFound: conflicts.length,
      unresolvedConflicts: conflicts.length,
      importantGaps,
    },
  };
}
