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
});
