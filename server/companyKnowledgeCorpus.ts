import { createHash } from "node:crypto";

export type CompanyCorpusInputPage = {
  url: string;
  title: string | null;
  fetchedAt: string;
  text: string;
  category?: string;
  description?: string | null;
  headings?: string[];
  links?: string[];
  jsonLd?: Record<string, unknown>[];
};

export type CompanyCorpusPage = {
  pageId: string;
  url: string;
  title: string | null;
  primaryHeading: string | null;
  headings: string[];
  description: string | null;
  fetchedAt: string;
  text: string;
  jsonLd: Record<string, unknown>[];
  internalLinks: string[];
  pageHint: string;
  contentHash: string;
  duplicateUrls: string[];
};

export type CompanyCorpus = {
  version: "company-corpus-v1";
  createdAt: string;
  pages: CompanyCorpusPage[];
  pageCount: number;
  byteSize: number;
  corpusHash: string;
  sourceHashes: Array<{
    pageId: string;
    url: string;
    contentHash: string;
    duplicateUrls: string[];
  }>;
  jsonl: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function compact(value: string | null | undefined, maximum: number) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

function unique(values: Array<string | null | undefined>, maximum: number) {
  return Array.from(
    new Set(values.map(value => compact(value, 2_000)).filter(Boolean))
  ).slice(0, maximum);
}

function canonicalUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function safeJsonLd(value: Record<string, unknown>[]) {
  return value
    .filter(item => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 100)
    .map(item => JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
}

function stableContent(input: CompanyCorpusInputPage) {
  return JSON.stringify({
    title: compact(input.title, 500) || null,
    description: compact(input.description, 2_000) || null,
    headings: unique(input.headings || [], 200),
    text: compact(input.text, 200_000),
    jsonLd: safeJsonLd(input.jsonLd || []),
  });
}

/**
 * Builds the only canonical whole-site corpus. Exact duplicate suppression is
 * based on the complete normalized retained content, never template similarity.
 */
export function buildCompanyCorpus(
  inputPages: CompanyCorpusInputPage[],
  createdAt = new Date().toISOString()
): CompanyCorpus {
  const readable = inputPages
    .map(page => ({
      ...page,
      url: canonicalUrl(page.url),
      text: compact(page.text, 200_000),
    }))
    .filter(page => page.text.length > 0)
    .sort((left, right) => left.url.localeCompare(right.url));
  const byUrl = new Map<string, (typeof readable)[number]>();
  for (const page of readable) byUrl.set(page.url, page);

  const uniqueByHash = new Map<
    string,
    { page: (typeof readable)[number]; duplicateUrls: string[] }
  >();
  for (const page of Array.from(byUrl.values())) {
    const hash = sha256(stableContent(page));
    const existing = uniqueByHash.get(hash);
    if (existing) {
      existing.duplicateUrls.push(page.url);
      continue;
    }
    uniqueByHash.set(hash, { page, duplicateUrls: [] });
  }

  const pages = Array.from(uniqueByHash.entries())
    .sort((left, right) => left[1].page.url.localeCompare(right[1].page.url))
    .map(([contentHash, record], index): CompanyCorpusPage => {
      const pageId = `PAGE_${String(index + 1).padStart(4, "0")}`;
      return {
        pageId,
        url: record.page.url,
        title: compact(record.page.title, 500) || null,
        primaryHeading: compact(record.page.headings?.[0], 500) || null,
        headings: unique(record.page.headings || [], 200),
        description: compact(record.page.description, 2_000) || null,
        fetchedAt: record.page.fetchedAt,
        text: record.page.text,
        jsonLd: safeJsonLd(record.page.jsonLd || []),
        internalLinks: unique(record.page.links || [], 1_000),
        pageHint: compact(record.page.category, 120) || "unclassified",
        contentHash,
        duplicateUrls: record.duplicateUrls.sort(),
      };
    });
  if (!pages.length)
    throw new Error(
      "No retained readable first-party pages are available for company learning."
    );

  const jsonl = pages.map(page => JSON.stringify(page)).join("\n");
  return {
    version: "company-corpus-v1",
    createdAt,
    pages,
    pageCount: pages.length,
    byteSize: Buffer.byteLength(jsonl, "utf8"),
    corpusHash: sha256(jsonl),
    sourceHashes: pages.map(page => ({
      pageId: page.pageId,
      url: page.url,
      contentHash: page.contentHash,
      duplicateUrls: page.duplicateUrls,
    })),
    jsonl,
  };
}

export function diffCompanyCorpus(
  previous: Pick<CompanyCorpus, "sourceHashes">,
  current: Pick<CompanyCorpus, "sourceHashes">
) {
  const oldByUrl = new Map(previous.sourceHashes.map(item => [item.url, item]));
  const newByUrl = new Map(current.sourceHashes.map(item => [item.url, item]));
  return {
    unchanged: current.sourceHashes.filter(
      item => oldByUrl.get(item.url)?.contentHash === item.contentHash
    ),
    changed: current.sourceHashes.filter(item => {
      const old = oldByUrl.get(item.url);
      return Boolean(old && old.contentHash !== item.contentHash);
    }),
    added: current.sourceHashes.filter(item => !oldByUrl.has(item.url)),
    removed: previous.sourceHashes.filter(item => !newByUrl.has(item.url)),
  };
}

export function corpusPageMap(corpus: CompanyCorpus) {
  return new Map(corpus.pages.map(page => [page.pageId, page]));
}
