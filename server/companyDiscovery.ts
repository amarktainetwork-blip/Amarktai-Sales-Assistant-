type DiscoveryResult = {
  sourceUrl: string;
  pageTitle: string | null;
  extractedText: string;
  proposedFacts: Record<string, unknown>;
  proposedKnowledge: Array<{ title: string; content: string }>;
};

const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|\[::1\]|\[fc|\[fd)/i;

function decode(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"');
}

function cleanText(html: string) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 40_000);
}

export async function discoverPublicWebsite(rawUrl: string): Promise<DiscoveryResult> {
  const url = new URL(rawUrl.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Use a public http or https website URL.");
  if (PRIVATE_HOST.test(url.hostname) || url.hostname.endsWith(".local")) throw new Error("Private-network and local URLs cannot be discovered.");
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "AmarktaiNetworkSalesAssistant/1.0 (+website-discovery)" } });
  if (!response.ok) throw new Error(`The website returned ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The supplied URL did not return an HTML page.");
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
  return { sourceUrl: url.toString(), pageTitle, extractedText, proposedFacts: { pageTitle, description: cleanDescription, headings, fetchedAt: new Date().toISOString() }, proposedKnowledge: knowledge };
}
