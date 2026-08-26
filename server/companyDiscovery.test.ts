import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi
    .fn()
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

import { discoverPublicWebsite } from "./companyDiscovery";

const originalFetch = globalThis.fetch;
const originalBrowserEndpoint = process.env.BROWSERLESS_WS_ENDPOINT;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBrowserEndpoint === undefined)
    delete process.env.BROWSERLESS_WS_ENDPOINT;
  else process.env.BROWSERLESS_WS_ENDPOINT = originalBrowserEndpoint;
});

function html(body: string, title = "Example Company") {
  return new Response(
    `<html><head><title>${title}</title><meta name="description" content="Trusted career training"></head><body>${body}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } }
  );
}

describe("professional public website discovery", () => {
  it("rejects local and private-network targets before a fetch is attempted", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(discoverPublicWebsite("http://127.0.0.1/private")).rejects.toThrow(
      "Private-network and local URLs cannot be discovered."
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("builds professional labelled knowledge instead of raw body-text dumps", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt")
        return Promise.resolve(new Response("User-agent: *"));
      if (url.pathname === "/sitemap.xml")
        return Promise.resolve(
          new Response(
            "<urlset><url><loc>https://example.co.za/courses/it-support</loc></url></urlset>",
            { headers: { "content-type": "application/xml" } }
          )
        );
      if (url.pathname === "/courses/it-support")
        return Promise.resolve(
          html(
            `<h1>IT Support Technician</h1>
             <h2>Price</h2><p>Full programme price £1,095 including exam vouchers.</p>
             <h2>Duration</h2><p>Complete in 12 months.</p>
             <h2>Certification</h2><p>Prepare for CompTIA certification.</p>
             <h2>Support</h2><p>1-to-1 tutor support and recruitment support are included.</p>`,
            "IT Support Technician"
          )
        );
      return Promise.resolve(
        html("<h1>Build a new career</h1><p>Flexible professional training.</p>")
      );
    });

    const result = await discoverPublicWebsite("https://example.co.za");
    const offering = result.proposedKnowledge.find(item =>
      item.title.includes("IT Support Technician")
    );
    expect(offering?.content).toContain("Offering: IT Support Technician");
    expect(offering?.content).toContain("Price: £1,095");
    expect(offering?.content).toContain("Duration: 12 months");
    expect(offering?.content).toContain("Certifications: CompTIA");
    expect(offering?.content).toContain("Included support / outcomes:");
    expect(offering?.content).not.toContain("<h1>");
    expect(result.extractedText).not.toContain("<h1>");
    expect(result.proposedFacts).toMatchObject({
      description: "Trusted career training",
      limits: { maxPages: 100, maxDepth: 4 },
    });
  });

  it("recursively reads sitemap indexes, honours robots and stays on the authorised host", async () => {
    const requested: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      if (url.pathname === "/robots.txt")
        return Promise.resolve(
          new Response(
            "User-agent: *\nDisallow: /private\nSitemap: https://example.co.za/sitemap.xml"
          )
        );
      if (url.pathname === "/sitemap.xml")
        return Promise.resolve(
          new Response(
            "<sitemapindex><sitemap><loc>https://example.co.za/course-sitemap.xml</loc></sitemap><sitemap><loc>https://other.example/unsafe.xml</loc></sitemap></sitemapindex>",
            { headers: { "content-type": "application/xml" } }
          )
        );
      if (url.pathname === "/course-sitemap.xml")
        return Promise.resolve(
          new Response(
            "<urlset><url><loc>https://example.co.za/courses/data-analytics</loc></url><url><loc>https://example.co.za/private</loc></url></urlset>",
            { headers: { "content-type": "application/xml" } }
          )
        );
      if (url.pathname === "/courses/data-analytics")
        return Promise.resolve(
          html("<h1>Data Analytics</h1><h2>Course price</h2><p>£1,799 for 12 months.</p>")
        );
      return Promise.resolve(
        html(
          "<h1>Welcome</h1><a href='/courses/data-analytics?utm_source=test'>Course</a><a href='/private'>Private</a>"
        )
      );
    });

    const result = await discoverPublicWebsite("https://example.co.za");
    expect(result.pages.map(page => page.category)).toContain("courses");
    expect(requested.some(url => url.includes("/private"))).toBe(false);
    expect(requested.some(url => url.startsWith("https://other.example"))).toBe(false);
    expect(result.proposedFacts).toMatchObject({
      sitemapDiscovered: true,
      completeness: { offeringsFound: 1, offeringsWithPublishedPrice: 1 },
    });
  });

  it("keeps provenance and flags conflicting published prices for review", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt")
        return Promise.resolve(new Response("User-agent: *"));
      if (url.pathname === "/sitemap.xml")
        return Promise.resolve(
          new Response(
            `<urlset>
              <url><loc>https://example.co.za/courses/ai-career</loc></url>
              <url><loc>https://example.co.za/pricing/ai-career</loc></url>
            </urlset>`,
            { headers: { "content-type": "application/xml" } }
          )
        );
      if (url.pathname === "/courses/ai-career")
        return Promise.resolve(
          html("<h1>AI Career Programme</h1><p>Full price £2,499. Study for 12 months.</p>")
        );
      if (url.pathname === "/pricing/ai-career")
        return Promise.resolve(
          html("<h1>AI Career Programme</h1><p>Current programme price £2,999.</p>")
        );
      return Promise.resolve(html("<h1>Career programmes</h1>"));
    });

    const result = await discoverPublicWebsite("https://example.co.za");
    const facts = result.proposedFacts as {
      conflicts: Array<{ type: string; values: string[]; sources: unknown[] }>;
      completeness: { unresolvedConflicts: number; reviewRequired: boolean };
    };
    expect(facts.conflicts).toHaveLength(1);
    expect(facts.conflicts[0]).toMatchObject({
      type: "price_conflict",
      values: expect.arrayContaining(["£2,499", "£2,999"]),
    });
    expect(facts.conflicts[0].sources).toHaveLength(2);
    expect(facts.completeness).toMatchObject({
      unresolvedConflicts: 1,
      reviewRequired: true,
    });
    const conflictedCandidates = result.proposedKnowledge.filter(item =>
      item.title.includes("AI Career Programme")
    );
    expect(conflictedCandidates.length).toBeGreaterThan(0);
    expect(conflictedCandidates.every(item =>
      item.reviewState === "conflict" &&
      item.confidence === "conflicting" &&
      item.trustEligible === false
    )).toBe(true);
  });

  it("does not mistake a price list on one source page for conflicting evidence", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname === "/robots.txt") return Promise.resolve(new Response("User-agent: *"));
      if (url.pathname === "/sitemap.xml") return Promise.resolve(new Response("<urlset></urlset>", { headers: { "content-type": "application/xml" } }));
      return Promise.resolve(html("<h1>Data Programme</h1><p>Pay £999 upfront or £99 per month.</p>"));
    });
    const result = await discoverPublicWebsite("https://example.co.za/courses/data");
    const facts = result.proposedFacts as { conflicts: unknown[] };
    expect(facts.conflicts).toEqual([]);
    expect(result.proposedKnowledge.find(item => item.title.includes("Data Programme"))?.trustEligible).toBe(true);
  });
});
