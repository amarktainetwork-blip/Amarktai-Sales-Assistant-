import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

import { discoverPublicWebsite } from "./companyDiscovery";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function page() {
  return new Response(
    "<html><head><title>Example</title></head><body><h1>Example company</h1><p>Public company information for customers.</p></body></html>",
    { status: 200, headers: { "content-type": "text/html" } }
  );
}

function redirect(location: string) {
  return new Response(null, { status: 308, headers: { location } });
}

describe("canonical apex/www website authorisation", () => {
  it.each([
    ["https://example.com/", "example.com", "www.example.com"],
    ["https://www.example.com/", "www.example.com", "example.com"],
  ])(
    "allows a canonical redirect from %s",
    async (input, sourceHost, canonicalHost) => {
      globalThis.fetch = vi.fn().mockImplementation((raw: URL | string) => {
        const url = new URL(String(raw));
        if (url.hostname === sourceHost)
          return Promise.resolve(
            redirect(`https://${canonicalHost}${url.pathname}${url.search}`)
          );
        if (url.pathname === "/robots.txt")
          return Promise.resolve(new Response("User-agent: *"));
        if (url.pathname === "/sitemap.xml")
          return Promise.resolve(new Response("", { status: 404 }));
        return Promise.resolve(page());
      });

      const result = await discoverPublicWebsite(input, {
        limits: { maxPages: 1 },
      });

      expect(result.sourceUrl).toBe(`https://${canonicalHost}/`);
      expect(result.pages).toHaveLength(1);
    }
  );

  it("still blocks redirects to arbitrary sibling subdomains", async () => {
    globalThis.fetch = vi.fn().mockImplementation((raw: URL | string) => {
      const url = new URL(String(raw));
      if (url.pathname === "/robots.txt")
        return Promise.resolve(new Response("User-agent: *"));
      if (url.pathname === "/sitemap.xml")
        return Promise.resolve(new Response("", { status: 404 }));
      if (url.hostname === "example.com")
        return Promise.resolve(redirect("https://shop.example.com/"));
      return Promise.resolve(page());
    });

    await expect(
      discoverPublicWebsite("https://example.com/", {
        limits: { maxPages: 1 },
      })
    ).rejects.toThrow("Website discovery remained outside the authorised hostname.");
  });
});
