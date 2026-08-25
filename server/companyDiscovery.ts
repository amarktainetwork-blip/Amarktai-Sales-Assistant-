import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright-core";

const USER_AGENT = "AmarktaiSalesAssistant/3.0 (+professional-company-intelligence)";
const MAX_PAGES = 100;
const MAX_DEPTH = 4;
const MAX_PAGE_BYTES = 1_500_000;
const MAX_TOTAL_TEXT = 1_000_000;
const MAX_PAGE_TEXT = 45_000;
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const MAX_SITEMAPS = 32;
const MAX_SITEMAP_URLS = 600;
const MAX_KNOWLEDGE = 80;
const MAX_RENDERED_PAGES = 24;

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["pricing", /(?:pricing|price|fees?|cost)/i],
  ["finance", /(?:finance|financing|payment|deposit|funding)/i],
  ["courses", /(?:courses?|programmes?|programs?|training|career-path|academy)/i],
  ["evidence", /(?:evidence|results?|outcomes?|success|proof)/i],
  ["certifications", /(?:certification|certifications|accreditation|accredited)/i],
  ["faq", /(?:faq|frequently-asked|questions)/i],
  ["services", /(?:services?|solutions?)/i],
  ["products", /(?:products?)/i],
  ["testimonials", /(?:testimonials?|reviews?|stories|case-studies)/i],
  ["support", /(?:support|mentoring|coaching|tutor|recruitment|job-support)/i],
  ["about", /(?:about|our-story|who-we-are)/i],
  ["contact", /(?:contact|locations?)/i],
  ["policies", /(?:terms|privacy|refund|cancellation|policy|policies)/i],
];

const HIGH_VALUE_CATEGORIES = new Set([
  "pricing",
  "finance",
  "courses",
  "products",
  "services",
  "evidence",
  "certifications",
  "faq",
  "support",
  "testimonials",
  "contact",
]);

export type DiscoveryKnowledgeCandidate = {
  title: string;
  content: string;
  sourceUrl: string;
  fetchedAt: string;
  category: string;
};

export type DiscoveryResult = {
  sourceUrl: string;
  pageTitle: string | null;
  extractedText: string;
  proposedFacts: Record<string, unknown>;
  proposedKnowledge: DiscoveryKnowledgeCandidate[];
  pages: Array<{
    url: string;
    title: string | null;
    category: string;
    fetchedAt: string;
    rendered: boolean;
    textChars: number;
  }>;
};

type RobotsPolicy = { allowed(pathname: string): boolean; sitemapUrls: string[] };
type PageCandidate = { url: URL; depth: number; priority: number };
type Section = { heading: string; body: string };
type Offering = {
  name: string;
  prices: string[];
  durations: string[];
  certifications: string[];
  financeTerms: string[];
  support: string[];
  sourceUrl: string;
  fetchedAt: string;
};
type ParsedPage = {
  url: URL;
  title: string | null;
  description: string | null;
  headings: string[];
  sections: Section[];
  text: string;
  links: URL[];
  jsonLd: Record<string, unknown>[];
  category: string;
  fetchedAt: string;
  rendered: boolean;
  offerings: Offering[];
};

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertPublicUrl(raw: string, approvedHostname?: string) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol))
    throw new Error("Use a public http or https website URL.");
  if (url.username || url.password)
    throw new Error("Website discovery URLs may not contain embedded credentials.");
  const hostname = url.hostname.toLowerCase();
  if (approvedHostname && hostname !== approvedHostname)
    throw new Error("Website discovery remained outside the authorised hostname.");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  )
    throw new Error("Private-network and local URLs cannot be discovered.");
  if (net.isIP(hostname) && isPrivateAddress(hostname))
    throw new Error("Private-network and local URLs cannot be discovered.");
  let records: Awaited<ReturnType<typeof lookup>>[] | Awaited<ReturnType<typeof lookup>>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("The website hostname could not be resolved.");
  }
  const resolved = Array.isArray(records) ? records : [records];
  if (!resolved.length || resolved.some(record => isPrivateAddress(record.address)))
    throw new Error("The website hostname resolves to a private or unsafe network address.");
  return url;
}

function canonicalize(input: URL) {
  const url = new URL(input);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys()))
    if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

async function boundedFetch(initialUrl: URL, approvedHostname: string, accept: string) {
  let url = await assertPublicUrl(initialUrl.toString(), approvedHostname);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: accept },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website returned an incomplete redirect.");
      if (redirect === 5) throw new Error("The website redirected too many times.");
      url = await assertPublicUrl(new URL(location, url).toString(), approvedHostname);
      continue;
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_PAGE_BYTES)
      throw new Error("A discovered website page exceeded the safe size limit.");
    return { response, finalUrl: canonicalize(url) };
  }
  throw new Error("The website could not be fetched safely.");
}

async function readTextBounded(response: Response, maxBytes: number) {
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes)
        throw new Error("A discovered website response exceeded the safe size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function dedupe(values: string[], maximum = 20) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.map(clean).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maximum) break;
  }
  return result;
}

function pageCategory(url: URL) {
  const target = `${url.pathname} ${url.search}`;
  const match = CATEGORY_RULES.find(([, pattern]) => pattern.test(target));
  return match?.[0] || (url.pathname === "/" ? "home" : "business-page");
}

function priceMatches(text: string) {
  return dedupe(
    Array.from(text.matchAll(/(?:£|\$|€)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\b(?:GBP|USD|EUR)\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gi)).map(
      match => clean(match[0])
    ),
    12
  );
}

function durationMatches(text: string) {
  return dedupe(
    Array.from(text.matchAll(/\b\d{1,2}(?:\s*(?:-|or|to)\s*\d{1,2})?\s*(?:days?|weeks?|months?|years?)\b/gi)).map(
      match => clean(match[0])
    ),
    8
  );
}

function financeMatches(text: string) {
  return dedupe(
    text
      .split(/(?<=[.!?])\s+|\n+/)
      .filter(line => /(?:deposit|finance|financing|monthly|instalment|installment|payment plan|pay over|credit check)/i.test(line))
      .map(line => clean(line).slice(0, 320)),
    10
  );
}

function supportMatches(text: string) {
  return dedupe(
    text
      .split(/(?<=[.!?])\s+|\n+/)
      .filter(line => /(?:support|mentor|tutor|recruit|career coach|job support|exam voucher|materials included|1-to-1|one-to-one)/i.test(line))
      .map(line => clean(line).slice(0, 320)),
    10
  );
}

function certificationMatches(text: string) {
  const named = Array.from(
    text.matchAll(/\b(?:CompTIA|Cisco|Microsoft|AWS|Azure|PeopleCert|APMG|EC-Council|ISC\)?²|PRINCE2|AgilePM|ITIL|Google)\b/gi)
  ).map(match => clean(match[0]));
  return dedupe(named, 12);
}

function sectionsFromHtml(html: string) {
  const $ = load(html);
  const sections: Section[] = [];
  $("h1, h2, h3").each((_, element) => {
    const heading = clean($(element).text());
    if (!heading) return;
    const bodyParts: string[] = [];
    let cursor = $(element).next();
    let guard = 0;
    while (cursor.length && guard < 12) {
      if (/^h[1-3]$/i.test(cursor.get(0)?.tagName || "")) break;
      const value = clean(cursor.text());
      if (value) bodyParts.push(value);
      cursor = cursor.next();
      guard += 1;
    }
    const body = clean(bodyParts.join(" ")).slice(0, 2_500);
    if (body) sections.push({ heading: heading.slice(0, 300), body });
  });
  return sections.slice(0, 40);
}

function jsonLdObjects(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...jsonLdObjects(object["@graph"]), ...jsonLdObjects(object.itemListElement)];
}

function offeringNameFromPage(input: {
  title: string | null;
  headings: string[];
  category: string;
}) {
  const first = input.headings[0] || input.title || "";
  if (!first) return "";
  return clean(first.replace(/\s+[|–—-]\s+[^|–—]+$/, "")).slice(0, 220);
}

function offeringsFromPage(input: {
  url: URL;
  title: string | null;
  headings: string[];
  sections: Section[];
  text: string;
  jsonLd: Record<string, unknown>[];
  category: string;
  fetchedAt: string;
}) {
  const results: Offering[] = [];
  const highValue = ["courses", "products", "services", "pricing", "evidence"].includes(input.category);
  const pagePrices = priceMatches(input.text);
  const pageName = offeringNameFromPage(input);
  if (highValue && pageName && (pagePrices.length || input.category === "courses")) {
    results.push({
      name: pageName,
      prices: pagePrices,
      durations: durationMatches(input.text),
      certifications: certificationMatches(input.text),
      financeTerms: financeMatches(input.text),
      support: supportMatches(input.text),
      sourceUrl: input.url.toString(),
      fetchedAt: input.fetchedAt,
    });
  }

  for (const item of input.jsonLd.flatMap(jsonLdObjects)) {
    const type = String(item["@type"] || "");
    if (!/(?:course|product|service|offer)/i.test(type)) continue;
    const name = clean(String(item.name || item.headline || ""));
    if (!name) continue;
    const offers = jsonLdObjects(item.offers);
    const jsonPrices = offers.flatMap(offer => {
      const price = offer.price ?? offer.lowPrice ?? offer.highPrice;
      const currency = clean(String(offer.priceCurrency || ""));
      return price === undefined || price === null
        ? []
        : [`${currency ? `${currency} ` : ""}${String(price)}`];
    });
    results.push({
      name: name.slice(0, 220),
      prices: dedupe(jsonPrices.length ? jsonPrices : pagePrices),
      durations: durationMatches(input.text),
      certifications: certificationMatches(input.text),
      financeTerms: financeMatches(input.text),
      support: supportMatches(input.text),
      sourceUrl: input.url.toString(),
      fetchedAt: input.fetchedAt,
    });
  }

  const seen = new Set<string>();
  return results.filter(item => {
    const key = `${item.name.toLowerCase()}\0${item.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseHtml(html: string, url: URL, rendered: boolean): ParsedPage {
  const $ = load(html);
  const jsonLd = $("script[type='application/ld+json']")
    .map((_, element) => {
      try {
        const parsed = JSON.parse($(element).text()) as unknown;
        return jsonLdObjects(parsed);
      } catch {
        return [];
      }
    })
    .get()
    .flat()
    .slice(0, 30);
  const sections = sectionsFromHtml(html);
  $("script, style, noscript, svg, template, iframe").remove();
  const title = clean($("title").first().text()).slice(0, 500) || null;
  const description = clean(
    $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      ""
  ).slice(0, 2_000) || null;
  const headings = $("h1, h2, h3")
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 40);
  const links = $("a[href]")
    .map((_, element) => $(element).attr("href") || "")
    .get()
    .flatMap(href => {
      try {
        const candidate = canonicalize(new URL(href, url));
        return /^https?:$/.test(candidate.protocol) &&
          candidate.hostname.toLowerCase() === url.hostname.toLowerCase()
          ? [candidate]
          : [];
      } catch {
        return [];
      }
    });
  const text = clean($("body").text()).slice(0, MAX_PAGE_TEXT);
  const category = pageCategory(url);
  const fetchedAt = new Date().toISOString();
  const page = {
    url,
    title,
    description,
    headings,
    sections,
    text,
    links,
    jsonLd,
    category,
    fetchedAt,
    rendered,
    offerings: [] as Offering[],
  };
  page.offerings = offeringsFromPage(page);
  return page;
}

let discoveryBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
let discoveryBrowserConnecting: Promise<Awaited<ReturnType<typeof chromium.connectOverCDP>>> | undefined;

async function getDiscoveryBrowser(endpoint: string) {
  if (discoveryBrowser?.isConnected()) return discoveryBrowser;
  if (discoveryBrowserConnecting) return discoveryBrowserConnecting;
  discoveryBrowserConnecting = chromium
    .connectOverCDP(endpoint, { timeout: 12_000 })
    .then(browser => {
      discoveryBrowser = browser;
      browser.on("disconnected", () => {
        if (discoveryBrowser === browser) discoveryBrowser = undefined;
      });
      return browser;
    })
    .finally(() => {
      discoveryBrowserConnecting = undefined;
    });
  return discoveryBrowserConnecting;
}

async function renderPublicPage(url: URL, approvedHostname: string) {
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!endpoint) return null;
  const browser = await getDiscoveryBrowser(endpoint);
  const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: "block" });
  try {
    await context.route("**/*", async route => {
      const requestUrl = new URL(route.request().url());
      if (
        !/^https?:$/.test(requestUrl.protocol) ||
        requestUrl.hostname.toLowerCase() !== approvedHostname
      )
        return route.abort("blockedbyclient");
      if (["image", "media", "font"].includes(route.request().resourceType()))
        return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
    const finalUrl = await assertPublicUrl(page.url(), approvedHostname);
    await page.waitForTimeout(1_500);
    return {
      html: (await page.content()).slice(0, MAX_PAGE_BYTES),
      url: canonicalize(finalUrl),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function parseRobots(text: string, origin: URL): RobotsPolicy {
  const groups: Array<{
    agents: string[];
    rules: Array<{ allow: boolean; path: string }>;
  }> = [];
  const sitemapUrls: string[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "sitemap") {
      try {
        sitemapUrls.push(new URL(value, origin).toString());
      } catch {
        // Ignore malformed sitemap declarations.
      }
    } else if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current && value) {
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const applicable = groups.filter(group =>
    group.agents.some(agent => agent === "*" || USER_AGENT.toLowerCase().includes(agent))
  );
  return {
    sitemapUrls,
    allowed(pathname) {
      const rule = applicable
        .flatMap(group => group.rules)
        .filter(item => pathname.startsWith(item.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
      return rule?.allow ?? true;
    },
  };
}

async function loadRobots(origin: URL, approvedHostname: string) {
  try {
    const { response } = await boundedFetch(
      new URL("/robots.txt", origin),
      approvedHostname,
      "text/plain,*/*;q=0.2"
    );
    if (!response.ok) return parseRobots("", origin);
    return parseRobots(await readTextBounded(response, 250_000), origin);
  } catch {
    return parseRobots("", origin);
  }
}

async function loadSitemapUrls(
  origin: URL,
  approvedHostname: string,
  policy: RobotsPolicy
) {
  const sitemapQueue = Array.from(
    new Set([...policy.sitemapUrls, new URL("/sitemap.xml", origin).toString()])
  );
  const visitedSitemaps = new Set<string>();
  const urls: URL[] = [];
  const seenUrls = new Set<string>();

  while (
    sitemapQueue.length &&
    visitedSitemaps.size < MAX_SITEMAPS &&
    urls.length < MAX_SITEMAP_URLS
  ) {
    const raw = sitemapQueue.shift()!;
    if (visitedSitemaps.has(raw)) continue;
    visitedSitemaps.add(raw);
    try {
      const sitemapUrl = await assertPublicUrl(raw, approvedHostname);
      const { response } = await boundedFetch(
        sitemapUrl,
        approvedHostname,
        "application/xml,text/xml,*/*;q=0.2"
      );
      if (!response.ok) continue;
      const xml = await readTextBounded(response, MAX_PAGE_BYTES);
      const $ = load(xml, { xmlMode: true });
      for (const location of $("sitemap > loc")
        .map((_, element) => $(element).text().trim())
        .get()) {
        try {
          const nested = canonicalize(await assertPublicUrl(location, approvedHostname));
          if (!visitedSitemaps.has(nested.toString())) sitemapQueue.push(nested.toString());
        } catch {
          // Ignore unsafe nested sitemap entries.
        }
      }
      for (const location of $("url > loc")
        .map((_, element) => $(element).text().trim())
        .get()) {
        try {
          const url = canonicalize(await assertPublicUrl(location, approvedHostname));
          const key = url.toString();
          if (!policy.allowed(url.pathname) || seenUrls.has(key)) continue;
          seenUrls.add(key);
          urls.push(url);
          if (urls.length >= MAX_SITEMAP_URLS) break;
        } catch {
          // Ignore unsafe sitemap entries.
        }
      }
    } catch {
      // Sitemap discovery is best-effort; crawling can continue from links.
    }
  }

  return {
    urls,
    sitemapCount: visitedSitemaps.size,
  };
}

function linkPriority(url: URL) {
  const category = pageCategory(url);
  const order = [
    "pricing",
    "courses",
    "products",
    "services",
    "finance",
    "evidence",
    "certifications",
    "support",
    "faq",
    "testimonials",
    "about",
    "contact",
    "policies",
    "home",
    "business-page",
  ];
  return order.indexOf(category) < 0 ? 100 : order.indexOf(category);
}

function shouldRender(html: string, page: ParsedPage, renderedCount: number) {
  if (renderedCount >= MAX_RENDERED_PAGES || !process.env.BROWSERLESS_WS_ENDPOINT?.trim())
    return false;
  if (page.text.length < 900) return true;
  if (!HIGH_VALUE_CATEGORIES.has(page.category)) return false;
  return /(?:id=["']__next["']|__NEXT_DATA__|data-reactroot|data-hydration|ng-version|application\/ld\+json)/i.test(
    html
  );
}

async function fetchPage(
  candidate: PageCandidate,
  approvedHostname: string,
  renderedCount: number
) {
  const { response, finalUrl } = await boundedFetch(
    candidate.url,
    approvedHostname,
    "text/html,application/xhtml+xml"
  );
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml"))
    return null;
  const html = await readTextBounded(response, MAX_PAGE_BYTES);
  let page = parseHtml(html, finalUrl, false);
  if (shouldRender(html, page, renderedCount)) {
    const rendered = await renderPublicPage(finalUrl, approvedHostname).catch(() => null);
    if (rendered) page = parseHtml(rendered.html, rendered.url, true);
  }
  return page;
}

function normalizedOfferingName(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(?:course|programme|program|career|training|qualification|pathway)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function priceConflicts(offerings: Offering[]) {
  const groups = new Map<string, Offering[]>();
  for (const offering of offerings) {
    const key = normalizedOfferingName(offering.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), offering]);
  }
  return Array.from(groups.entries()).flatMap(([key, group]) => {
    const prices = dedupe(group.flatMap(item => item.prices), 20);
    if (prices.length <= 1) return [];
    return [
      {
        type: "price_conflict",
        offeringKey: key,
        displayNames: dedupe(group.map(item => item.name), 10),
        values: prices,
        sources: group.map(item => ({
          sourceUrl: item.sourceUrl,
          fetchedAt: item.fetchedAt,
          prices: item.prices,
        })),
        reviewRequired: true,
      },
    ];
  });
}

function bullets(values: string[]) {
  return values.map(value => `- ${value}`).join("\n");
}

function offeringKnowledge(offering: Offering): DiscoveryKnowledgeCandidate {
  const lines = [
    `Offering: ${offering.name}`,
    offering.prices.length ? `Price: ${offering.prices.join(" / ")}` : "Price: Not clearly stated on this page",
    offering.durations.length ? `Duration: ${offering.durations.join(" / ")}` : "",
    offering.certifications.length
      ? `Certifications: ${offering.certifications.join(", ")}`
      : "",
    offering.financeTerms.length
      ? `Payment / finance:\n${bullets(offering.financeTerms)}`
      : "",
    offering.support.length ? `Included support / outcomes:\n${bullets(offering.support)}` : "",
  ].filter(Boolean);
  return {
    title: `Offering · ${offering.name}`,
    content: lines.join("\n\n"),
    sourceUrl: offering.sourceUrl,
    fetchedAt: offering.fetchedAt,
    category: "offering",
  };
}

function pageKnowledge(page: ParsedPage): DiscoveryKnowledgeCandidate[] {
  const results: DiscoveryKnowledgeCandidate[] = [];
  const source = {
    sourceUrl: page.url.toString(),
    fetchedAt: page.fetchedAt,
  };
  if (page.category === "home" || page.category === "about") {
    const summary = [
      page.description ? `Summary: ${page.description}` : "",
      page.headings.length ? `Key messages:\n${bullets(page.headings.slice(0, 10))}` : "",
    ].filter(Boolean);
    if (summary.length)
      results.push({
        title: page.category === "home" ? "Company overview" : "About the company",
        content: summary.join("\n\n"),
        category: page.category,
        ...source,
      });
  }

  if (["finance", "pricing"].includes(page.category)) {
    const terms = financeMatches(page.text);
    const prices = priceMatches(page.text);
    const content = [
      prices.length ? `Published prices found:\n${bullets(prices)}` : "",
      terms.length ? `Payment and finance terms:\n${bullets(terms)}` : "",
      page.sections.length
        ? `Relevant sections:\n${bullets(page.sections.slice(0, 8).map(section => `${section.heading}: ${section.body.slice(0, 260)}`))}`
        : "",
    ].filter(Boolean);
    if (content.length)
      results.push({
        title: page.category === "finance" ? "Payment & finance" : "Pricing",
        content: content.join("\n\n"),
        category: page.category,
        ...source,
      });
  }

  if (["faq", "contact", "support", "evidence", "certifications", "testimonials", "policies"].includes(page.category)) {
    const label = page.category.replaceAll("-", " ");
    const details = page.sections.length
      ? page.sections.slice(0, 12).map(section => `${section.heading}\n${section.body}`)
      : page.headings.slice(0, 12);
    if (details.length)
      results.push({
        title: label.charAt(0).toUpperCase() + label.slice(1),
        content: details.map(detail => `• ${detail}`).join("\n\n"),
        category: page.category,
        ...source,
      });
  }
  return results;
}

function buildKnowledge(pages: ParsedPage[]) {
  const offerings = pages.flatMap(page => page.offerings);
  const candidates: DiscoveryKnowledgeCandidate[] = [
    ...offerings.map(offeringKnowledge),
    ...pages.flatMap(pageKnowledge),
  ];
  const seen = new Set<string>();
  return candidates
    .filter(item => {
      const key = `${item.title.toLowerCase()}\0${item.content.toLowerCase().slice(0, 700)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_KNOWLEDGE);
}

export async function discoverPublicWebsite(rawUrl: string): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const initial = canonicalize(await assertPublicUrl(rawUrl.trim()));
  const approvedHostname = initial.hostname.toLowerCase();
  const robots = await loadRobots(initial, approvedHostname);
  if (!robots.allowed(initial.pathname))
    throw new Error(
      "The website robots policy does not allow discovery of the supplied page."
    );
  const sitemap = await loadSitemapUrls(initial, approvedHostname, robots);
  const queue: PageCandidate[] = [
    { url: initial, depth: 0, priority: -1 },
    ...sitemap.urls.map(url => ({ url, depth: 1, priority: linkPriority(url) })),
  ];
  const queued = new Set(queue.map(item => item.url.toString()));
  const visited = new Set<string>();
  const pages: ParsedPage[] = [];
  let totalText = 0;
  let renderedCount = 0;

  while (queue.length && pages.length < MAX_PAGES && totalText < MAX_TOTAL_TEXT) {
    queue.sort(
      (a, b) =>
        a.priority - b.priority ||
        a.depth - b.depth ||
        a.url.pathname.localeCompare(b.url.pathname)
    );
    const batch = queue
      .splice(0, CONCURRENCY)
      .filter(candidate => !visited.has(candidate.url.toString()));
    batch.forEach(candidate => visited.add(candidate.url.toString()));
    const results = await Promise.all(
      batch.map(candidate =>
        fetchPage(candidate, approvedHostname, renderedCount).catch(() => null)
      )
    );
    for (let index = 0; index < results.length; index += 1) {
      if (pages.length >= MAX_PAGES || totalText >= MAX_TOTAL_TEXT) break;
      const page = results[index];
      const candidate = batch[index];
      if (!page) continue;
      if (page.rendered) renderedCount += 1;
      page.text = page.text.slice(0, MAX_TOTAL_TEXT - totalText);
      totalText += page.text.length;
      pages.push(page);
      if (candidate.depth >= MAX_DEPTH) continue;
      for (const link of page.links) {
        const key = link.toString();
        if (queued.has(key) || visited.has(key) || !robots.allowed(link.pathname))
          continue;
        if (/\.(?:pdf|zip|jpg|jpeg|png|gif|webp|svg|mp[34]|avi|mov|docx?|xlsx?)$/i.test(link.pathname))
          continue;
        queued.add(key);
        queue.push({
          url: link,
          depth: candidate.depth + 1,
          priority: linkPriority(link),
        });
      }
    }
  }

  if (!pages.length)
    throw new Error("The website did not return any readable public HTML pages.");

  const primary =
    pages.find(page => page.url.toString() === initial.toString()) || pages[0];
  const offerings = pages.flatMap(page => page.offerings);
  const conflicts = priceConflicts(offerings);
  const proposedKnowledge = buildKnowledge(pages);
  const categories = dedupe(pages.map(page => page.category), 40);
  const offeringsWithPrice = offerings.filter(item => item.prices.length > 0).length;
  const completeness = {
    pagesCrawled: pages.length,
    sitemapPagesDiscovered: sitemap.urls.length,
    sitemapFilesRead: sitemap.sitemapCount,
    categoriesCovered: categories,
    offeringsFound: offerings.length,
    offeringsWithPublishedPrice: offeringsWithPrice,
    pricingCoveragePercent: offerings.length
      ? Math.round((offeringsWithPrice / offerings.length) * 100)
      : 0,
    unresolvedConflicts: conflicts.length,
    reviewRequired: conflicts.length > 0,
  };

  return {
    sourceUrl: primary.url.toString(),
    pageTitle: primary.title,
    extractedText: pages
      .map(page => `[${page.url}]\n${page.text}`)
      .join("\n\n")
      .slice(0, MAX_TOTAL_TEXT),
    proposedFacts: {
      pageTitle: primary.title,
      description: primary.description,
      headings: primary.headings.slice(0, 16),
      jsonLd: pages.flatMap(page => page.jsonLd).slice(0, 40),
      approvedHostname,
      robotsChecked: true,
      sitemapDiscovered: sitemap.urls.length > 0,
      offerings,
      conflicts,
      completeness,
      pagesCrawled: pages.length,
      renderedPages: pages.filter(page => page.rendered).length,
      limits: {
        maxPages: MAX_PAGES,
        maxDepth: MAX_DEPTH,
        maxPageBytes: MAX_PAGE_BYTES,
        maxTotalText: MAX_TOTAL_TEXT,
        maxSitemaps: MAX_SITEMAPS,
        concurrency: CONCURRENCY,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    },
    proposedKnowledge,
    pages: pages.map(page => ({
      url: page.url.toString(),
      title: page.title,
      category: page.category,
      fetchedAt: page.fetchedAt,
      rendered: page.rendered,
      textChars: page.text.length,
    })),
  };
}
