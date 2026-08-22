import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

type DiscoveryResult = {
  sourceUrl: string;
  pageTitle: string | null;
  extractedText: string;
  proposedFacts: Record<string, unknown>;
  proposedKnowledge: Array<{ title: string; content: string }>;
};

type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;
type Fetcher = typeof fetch;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 500_000;
const SAFE_PORTS = new Set(["", "80", "443"]);

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isBlockedNetworkAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);
  if (family === 0) return false;
  if (family === 4) return blockedIpv4(normalized);
  if (family !== 6) return true;
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mappedV4 = normalized.match(/^::ffff:(.+)$/i)?.[1];
  return mappedV4 ? blockedIpv4(mappedV4) : false;
}

export async function validatePublicWebsiteUrl(rawUrl: string, lookup: Lookup = dnsLookup) {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error("Use a valid public http or https website URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use a public http or https website URL.");
  if (url.username || url.password || !SAFE_PORTS.has(url.port)) throw new Error("Use a standard public website URL without embedded credentials or custom ports.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || isBlockedNetworkAddress(hostname)) throw new Error("Private-network and local URLs cannot be discovered.");
  let records: Array<{ address: string; family: number }>;
  try { records = await lookup(hostname, { all: true, verbatim: true }); } catch { throw new Error("The website host could not be resolved safely."); }
  if (!records.length || records.some(record => isBlockedNetworkAddress(record.address))) throw new Error("Private-network and local URLs cannot be discovered.");
  return url;
}

function decode(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
}

function cleanText(html: string) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 40_000);
}

async function readLimitedHtml(response: Response) {
  if (!response.body) return (await response.text()).slice(0, MAX_BYTES);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("The website response exceeded the safe discovery limit.");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(content);
}

export async function fetchPublicWebsite(rawUrl: string, dependencies: { lookup?: Lookup; fetcher?: Fetcher } = {}) {
  const lookup = dependencies.lookup ?? dnsLookup;
  const fetcher = dependencies.fetcher ?? fetch;
  let url = await validatePublicWebsiteUrl(rawUrl, lookup);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response: Response;
    try { response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "AmarktaiSalesAssistant/1.0" } }); }
    catch { throw new Error("The public website could not be fetched safely."); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("The website redirected too many times.");
      url = await validatePublicWebsiteUrl(new URL(location, url).toString(), lookup);
      continue;
    }
    if (!response.ok) throw new Error("The website could not be retrieved.");
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) throw new Error("The supplied URL did not return an HTML page.");
    return { url, html: await readLimitedHtml(response) };
  }
  throw new Error("The public website could not be fetched safely.");
}

export async function discoverPublicWebsite(rawUrl: string, dependencies: { lookup?: Lookup; fetcher?: Fetcher } = {}): Promise<DiscoveryResult> {
  const { url, html } = await fetchPublicWebsite(rawUrl, dependencies);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description/i)?.[1] ?? null;
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)).map(match => cleanText(match[1])).filter(Boolean).slice(0, 12);
  const extractedText = cleanText(html);
  const pageTitle = title ? cleanText(title).slice(0, 500) : null;
  const cleanDescription = description ? cleanText(description).slice(0, 2_000) : null;
  const proposedKnowledge = [pageTitle && cleanDescription ? { title: "Website overview", content: `${pageTitle}. ${cleanDescription}` } : null, headings.length ? { title: "Website headings", content: headings.join("\n") } : null].filter((item): item is { title: string; content: string } => Boolean(item));
  return { sourceUrl: url.toString(), pageTitle, extractedText, proposedFacts: { pageTitle, description: cleanDescription, headings, fetchedAt: new Date().toISOString() }, proposedKnowledge };
}
