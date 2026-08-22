import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPublicWebsite, fetchPublicWebsite, validatePublicWebsiteUrl } from "./companyDiscovery";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("public website discovery", () => {
  it("rejects local and private-network targets before a fetch is attempted", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    await expect(discoverPublicWebsite("http://127.0.0.1/private"))
      .rejects.toThrow("Private-network and local URLs cannot be discovered.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects private IPv4 and IPv6 address families, credentials, and custom ports", async () => {
    const lookup = vi.fn();
    const blockedUrls = ["http://10.0.0.7", "http://172.16.4.2", "http://192.168.1.1", "http://169.254.169.254", "http://[::1]", "http://[fd12::8]", "https://user:secret@example.co.za", "https://example.co.za:8443"];

    for (const url of blockedUrls) await expect(validatePublicWebsiteUrl(url, lookup)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("re-validates redirects and blocks a redirect to a private destination", async () => {
    const lookup = vi.fn(async (hostname: string) => hostname === "public.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://private.example/internal" } }));

    await expect(fetchPublicWebsite("https://public.example", { lookup, fetcher })).rejects.toThrow("Private-network and local URLs cannot be discovered.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a public response that is not HTML", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

    await expect(fetchPublicWebsite("https://public.example", { lookup, fetcher })).rejects.toThrow("did not return an HTML page");
  });

  it("extracts a bounded review proposal from a public HTML page", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const fetcher = vi.fn().mockResolvedValue(new Response("<html><head><title>Example Organisation</title><meta name=\"description\" content=\"Customer-focused services\"></head><body><h1>Build better customer relationships</h1><script>ignored()</script></body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    const result = await discoverPublicWebsite("https://example.co.za", { lookup, fetcher });
    expect(result.pageTitle).toBe("Example Organisation");
    expect(result.proposedFacts).toMatchObject({ description: "Customer-focused services", headings: ["Build better customer relationships"] });
    expect(result.extractedText).not.toContain("ignored()");
  });
});
