import { load } from "cheerio";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { chromium } from "playwright-core";

const USER_AGENT = "AmarktaiSalesAssistant/2.0 (+bounded-business-discovery)";
const MAX_PAGES = 20;
const MAX_DEPTH = 2;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_TOTAL_TEXT = 200_000;
const MAX_PAGE_TEXT = 30_000;
const FETCH_TIMEOUT_MS = 12_000;
const CONCURRENCY = 3;
const PRIORITY_TERMS = ["about", "services", "products", "solutions", "pricing", "faq", "contact", "industries", "case-studies", "testimonials"];

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
  pages: Array<{ url: string; title: string | null; category: string; fetchedAt: string; rendered: boolean; textChars: number }>;
};

type RobotsPolicy = { allowed(pathname: string): boolean; sitemapUrls: string[] };
type PageCandidate = { url: URL; depth: number; priority: number };
type ParsedPage = {
  url: URL;
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
  links: URL[];
  jsonLd: Record<string, unknown>[];
  category: string;
  fetchedAt: string;
  rendered: boolean;
};

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function isPrivateAddress(address: string) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function assertPublicUrl(raw: string, approvedHostname?: string) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Use a public http or https website URL.");
  if (url.username || url.password) throw new Error("Website discovery URLs may not contain embedded credentials.");
  const hostname = url.hostname.toLowerCase();
  if (approvedHostname && hostname !== approvedHostname) throw new Error("Website discovery remained outside the authorised hostname.");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Private-network and local URLs cannot be discovered.");
  if (net.isIP(hostname) && isPrivateAddress(hostname)) throw new Error("Private-network and local URLs cannot be discovered.");
  let records: Awaited<ReturnType<typeof lookup>>[] | Awaited<ReturnType<typeof lookup>>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("The website hostname could not be resolved.");
  }
  const resolved = Array.isArray(records) ? records : [records];
  if (!resolved.length || resolved.some(record => isPrivateAddress(record.address))) throw new Error("The website hostname resolves to a private or unsafe network address.");
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
    if (declaredLength > MAX_PAGE_BYTES) throw new Error("A discovered website page exceeded the safe size limit.");
    return { response, finalUrl: canonicalize(url) };
  }
  throw new Error("The website could not be fetched safely.");
}

function clean(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function pageCategory(url: URL) {
  const path = url.pathname.toLowerCase();
  return PRIORITY_TERMS.find(term => path.includes(term)) || (path === "/" ? "home" : "business-page");
}

function parseHtml(html: string, url: URL, rendered: boolean): ParsedPage {
  const $ = load(html);
  const jsonLd = $("script[type='application/ld+json']").map((_, element) => {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }).get().filter((item): item is Record<string, unknown> => Boolean(item)).slice(0, 10);
  $("script, style, noscript, svg, template, iframe").remove();
  const title = clean($("title").first().text()).slice(0, 500) || null;
  const description = clean($("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content") || "").slice(0, 2_000) || null;
  const headings = $("h1, h2, h3").map((_, element) => clean($(element).text())).get().filter(Boolean).slice(0, 24);
  const links = $("a[href]").map((_, element) => $(element).attr("href") || "").get().flatMap(href => {
    try {
      const candidate = canonicalize(new URL(href, url));
      return /^https?:$/.test(candidate.protocol) && candidate.hostname.toLowerCase() === url.hostname.toLowerCase() ? [candidate] : [];
    } catch {
      return [];
    }
  });
  const text = clean($("body").text()).slice(0, MAX_PAGE_TEXT);
  return { url, title, description, headings, text, links, jsonLd, category: pageCategory(url), fetchedAt: new Date().toISOString(), rendered };
}

async function renderPublicPage(url: URL, approvedHostname: string) {
  const endpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!endpoint) return null;
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 12_000 });
  const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: "block" });
  try {
    await context.route("**/*", async route => {
      const requestUrl = new URL(route.request().url());
      if (!/^https?:$/.test(requestUrl.protocol) || requestUrl.hostname.toLowerCase() !== approvedHostname) return route.abort("blockedbyclient");
      if (["image", "media", "font"].includes(route.request().resourceType())) return route.abort("blockedbyclient");
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    const finalUrl = await assertPublicUrl(page.url(), approvedHostname);
    await page.waitForTimeout(750);
    return { html: (await page.content()).slice(0, MAX_PAGE_BYTES), url: canonicalize(finalUrl) };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function parseRobots(text: string, origin: URL): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
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
      try { sitemapUrls.push(new URL(value, origin).toString()); } catch { /* ignore malformed sitemap */ }
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
  const applicable = groups.filter(group => group.agents.some(agent => agent === "*" || USER_AGENT.toLowerCase().includes(agent)));
  return {
    sitemapUrls,
    allowed(pathname) {
      const rule = applicable.flatMap(group => group.rules).filter(item => pathname.startsWith(item.path)).sort((a, b) => b.path.length - a.path.length)[0];
      return rule?.allow ?? true;
    },
  };
}

async function loadRobots(origin: URL, approvedHostname: string) {
  try {
    const { response } = await boundedFetch(new URL("/robots.txt", origin), approvedHostname, "text/plain,*/*;q=0.2");
    if (!response.ok) return parseRobots("", origin);
    return parseRobots((await response.text()).slice(0, 250_000), origin);
  } catch {
    return parseRobots("", origin);
  }
}

async function loadSitemapUrls(origin: URL, approvedHostname: string, policy: RobotsPolicy) {
  const candidates = Array.from(new Set([...policy.sitemapUrls, new URL("/sitemap.xml", origin).toString()])).slice(0, 4);
  const urls: URL[] = [];
  for (const sitemap of candidates) {
    try {
      const sitemapUrl = await assertPublicUrl(sitemap, approvedHostname);
      const { response } = await boundedFetch(sitemapUrl, approvedHostname, "application/xml,text/xml,*/*;q=0.2");
      if (!response.ok) continue;
      const xml = (await response.text()).slice(0, MAX_PAGE_BYTES);
      const $ = load(xml, { xmlMode: true });
      for (const location of $("url > loc").map((_, element) => $(element).text().trim()).get()) {
        try {
          const url = canonicalize(await assertPublicUrl(location, approvedHostname));
          if (policy.allowed(url.pathname)) urls.push(url);
        } catch { /* ignore unsafe sitemap entry */ }
        if (urls.length >= MAX_PAGES * 3) break;
      }
    } catch { /* sitemap discovery is best effort */ }
  }
  return urls;
}

function linkPriority(url: URL) {
  const index = PRIORITY_TERMS.findIndex(term => url.pathname.toLowerCase().includes(term));
  return index < 0 ? 100 : index;
}

async function fetchPage(candidate: PageCandidate, approvedHostname: string) {
  const { response, finalUrl } = await boundedFetch(candidate.url, approvedHostname, "text/html,application/xhtml+xml");
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
  let page = parseHtml((await response.text()).slice(0, MAX_PAGE_BYTES), finalUrl, false);
  if (page.text.length < 500 && process.env.BROWSERLESS_WS_ENDPOINT?.trim()) {
    const rendered = await renderPublicPage(finalUrl, approvedHostname).catch(() => null);
    if (rendered) page = parseHtml(rendered.html, rendered.url, true);
  }
  return page;
}

function buildKnowledge(pages: ParsedPage[]) {
  const candidates: DiscoveryKnowledgeCandidate[] = [];
  for (const page of pages) {
    const overview = [page.title, page.description].filter(Boolean).join(". ");
    if (overview) candidates.push({ title: `${page.category.replaceAll("-", " ")} overview`, content: overview, sourceUrl: page.url.toString(), fetchedAt: page.fetchedAt, category: page.category });
    if (page.headings.length) candidates.push({ title: `${page.category.replaceAll("-", " ")} topics`, content: page.headings.join("\n"), sourceUrl: page.url.toString(), fetchedAt: page.fetchedAt, category: page.category });
    if (["services", "products", "solutions", "pricing", "faq", "industries", "case-studies", "testimonials", "contact"].includes(page.category) && page.text)
      candidates.push({ title: `${page.category.replaceAll("-", " ")} details`, content: page.text.slice(0, 8_000), sourceUrl: page.url.toString(), fetchedAt: page.fetchedAt, category: page.category });
  }
  const seen = new Set<string>();
  return candidates.filter(item => {
    const key = `${item.title.toLowerCase()}\0${item.content.toLowerCase().slice(0, 500)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
}

export async function discoverPublicWebsite(rawUrl: string): Promise<DiscoveryResult> {
  const startedAt = new Date().toISOString();
  const initial = canonicalize(await assertPublicUrl(rawUrl.trim()));
  const approvedHostname = initial.hostname.toLowerCase();
  const robots = await loadRobots(initial, approvedHostname);
  if (!robots.allowed(initial.pathname)) throw new Error("The website robots policy does not allow discovery of the supplied page.");
  const sitemapUrls = await loadSitemapUrls(initial, approvedHostname, robots);
  const queue: PageCandidate[] = [
    { url: initial, depth: 0, priority: -1 },
    ...sitemapUrls.map(url => ({ url, depth: 1, priority: linkPriority(url) })),
  ];
  const queued = new Set(queue.map(item => item.url.toString()));
  const visited = new Set<string>();
  const pages: ParsedPage[] = [];
  let totalText = 0;
  while (queue.length && pages.length < MAX_PAGES && totalText < MAX_TOTAL_TEXT) {
    queue.sort((a, b) => a.depth - b.depth || a.priority - b.priority || a.url.pathname.localeCompare(b.url.pathname));
    const batch = queue.splice(0, CONCURRENCY).filter(candidate => !visited.has(candidate.url.toString()));
    batch.forEach(candidate => visited.add(candidate.url.toString()));
    const results = await Promise.all(batch.map(candidate => fetchPage(candidate, approvedHostname).catch(() => null)));
    for (let index = 0; index < results.length; index += 1) {
      const page = results[index];
      const candidate = batch[index];
      if (!page) continue;
      page.text = page.text.slice(0, MAX_TOTAL_TEXT - totalText);
      totalText += page.text.length;
      pages.push(page);
      if (candidate.depth >= MAX_DEPTH) continue;
      for (const link of page.links) {
        const key = link.toString();
        if (queued.has(key) || visited.has(key) || !robots.allowed(link.pathname)) continue;
        if (/\.(?:pdf|zip|jpg|jpeg|png|gif|webp|svg|mp[34]|avi|mov|docx?|xlsx?)$/i.test(link.pathname)) continue;
        queued.add(key);
        queue.push({ url: link, depth: candidate.depth + 1, priority: linkPriority(link) });
      }
    }
  }
  if (!pages.length) throw new Error("The website did not return any readable public HTML pages.");
  const primary = pages.find(page => page.url.toString() === initial.toString()) || pages[0];
  const proposedKnowledge = buildKnowledge(pages);
  return {
    sourceUrl: primary.url.toString(),
    pageTitle: primary.title,
    extractedText: pages.map(page => `[${page.url}]\n${page.text}`).join("\n\n").slice(0, MAX_TOTAL_TEXT),
    proposedFacts: {
      pageTitle: primary.title,
      description: primary.description,
      headings: primary.headings.slice(0, 12),
      jsonLd: pages.flatMap(page => page.jsonLd).slice(0, 20),
      approvedHostname,
      robotsChecked: true,
      sitemapDiscovered: sitemapUrls.length > 0,
      pagesCrawled: pages.length,
      renderedPages: pages.filter(page => page.rendered).length,
      limits: { maxPages: MAX_PAGES, maxDepth: MAX_DEPTH, maxPageBytes: MAX_PAGE_BYTES, maxTotalText: MAX_TOTAL_TEXT, concurrency: CONCURRENCY },
      startedAt,
      completedAt: new Date().toISOString(),
    },
    proposedKnowledge,
    pages: pages.map(page => ({ url: page.url.toString(), title: page.title, category: page.category, fetchedAt: page.fetchedAt, rendered: page.rendered, textChars: page.text.length })),
  };
}
