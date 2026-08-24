import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

import { discoverPublicWebsite } from "./companyDiscovery";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("public website discovery", () => {
  it("rejects local and private-network targets before a fetch is attempted", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(discoverPublicWebsite("http://127.0.0.1/private"))
      .rejects.toThrow("Private-network and local URLs cannot be discovered.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts a bounded review proposal from a public HTML page", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("<html><head><title>Example Company</title><meta name=\"description\" content=\"Trusted customer service\"></head><body><h1>Build better outcomes</h1><script>ignored()</script></body></html>", { status: 200, headers: { "content-type": "text/html" } })));
    const result = await discoverPublicWebsite("https://example.co.za");
    expect(result.pageTitle).toBe("Example Company");
    expect(result.proposedFacts).toMatchObject({ description: "Trusted customer service", headings: ["Build better outcomes"] });
    expect(result.extractedText).not.toContain("ignored()");
  });

  it("honours robots, discovers sitemap pages, canonicalises links, and stays on the authorised host", async () => {
    const requested: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname === "/robots.txt")
        return Promise.resolve(new Response("User-agent: *\nDisallow: /private\nSitemap: https://example.co.za/sitemap.xml", { headers: { "content-type": "text/plain" } }));
      if (url.pathname === "/sitemap.xml")
        return Promise.resolve(new Response("<urlset><url><loc>https://example.co.za/services</loc></url><url><loc>https://example.co.za/private</loc></url><url><loc>https://other.example/contact</loc></url></urlset>", { headers: { "content-type": "application/xml" } }));
      if (url.pathname === "/services")
        return Promise.resolve(new Response("<html><head><title>Services</title></head><body><h1>Advisory services</h1><p>Commercial sales enablement for growing teams.</p></body></html>", { headers: { "content-type": "text/html" } }));
      return Promise.resolve(new Response("<html><head><title>Home</title></head><body><h1>Welcome</h1><a href='/services?utm_source=test'>Services</a><a href='/private'>Private</a><a href='https://other.example/contact'>Elsewhere</a></body></html>", { headers: { "content-type": "text/html" } }));
    });
    const result = await discoverPublicWebsite("https://example.co.za");
    expect(result.pages.map(page => page.category)).toContain("services");
    expect(result.proposedKnowledge.some(item => item.sourceUrl === "https://example.co.za/services")).toBe(true);
    expect(requested.some(url => url.includes("/private"))).toBe(false);
    expect(requested.some(url => url.startsWith("https://other.example"))).toBe(false);
    expect(result.pages.length).toBeLessThanOrEqual(20);
  });
});
