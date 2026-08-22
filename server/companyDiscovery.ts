import { lookup } from "node:dns/promises";
import net from "node:net";

type DiscoveryResult = {
  sourceUrl: string;
  pageTitle: string | null;
  extractedText: string;
  proposedFacts: Record<string, unknown>;
  proposedKnowledge: Array<{ title: string; content: string }>;
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
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  }
  return true;
}

async function assertPublicUrl(raw: string) {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Use a public http or https website URL.");
  if (url.username || url.password) throw new Error("Website discovery URLs may not contain embedded credentials.");
  const hostname = url.hostname.toLowerCase();
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

async function fetchPublicHtml(initialUrl: string) {
  let url = await assertPublicUrl(initialUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "AmarktaiNetworkSalesAssistant/1.0 (+website-discovery)" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The website returned an incomplete redirect.");
      if (redirect === 5) throw new Error("The website redirected too many times.");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    return { response, finalUrl: url };
  }
  throw new Error("The website could not be fetched safely.");
}

function decode(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
}

function cleanText(html: string) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 40_000);
}

export async function discoverPublicWebsite(rawUrl: string): Promise<DiscoveryResult> {
  const { response, finalUrl } = await fetchPublicHtml(rawUrl.trim());
  if (!response.ok) throw new Error(`The website returned ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) throw new Error("The supplied URL did not return an HTML page.");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) throw new Error("The website page is too large for safe discovery.");
  const html = (await response.text()).slice(0, 500_000);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description/i)?.[1] ?? null;
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)).map(match => cleanText(match[1])).filter(Boolean).slice(0, 12);
  const extractedText = cleanText(html);
  const pageTitle = title ? cleanText(title).slice(0, 500) : null;
  const cleanDescription = description ? cleanText(description).slice(0, 2_000) : null;
  const knowledge = [
    pageTitle && cleanDescription ? { title: "Website overview", content: `${pageTitle}. ${cleanDescription}` } : null,
    headings.length ? { title: "Website headings", content: headings.join("\n") } : null,
  ].filter((item): item is { title: string; content: string } => Boolean(item));
  return { sourceUrl: finalUrl.toString(), pageTitle, extractedText, proposedFacts: { pageTitle, description: cleanDescription, headings, fetchedAt: new Date().toISOString() }, proposedKnowledge: knowledge };
}
