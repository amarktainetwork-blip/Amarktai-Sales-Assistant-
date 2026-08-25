import { describe, expect, it, vi } from "vitest";
import { clearGenieBrowserOriginState } from "./resetConnection";

describe("fresh Genie browser reset", () => {
  it("clears only the Genie origin and never closes the shared browser", async () => {
    const geniePage = {
      isClosed: () => false,
      url: () => "https://genie.entrepreneurscircle.org/dashboard",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const otherPage = {
      isClosed: () => false,
      url: () => "https://example.test/dashboard",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const genieWorker = {
      url: () => "https://genie.entrepreneurscircle.org/sw.js",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const otherWorker = {
      url: () => "https://example.test/sw.js",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const clearCookies = vi.fn().mockResolvedValue(undefined);
    const context = {
      pages: () => [geniePage, otherPage],
      serviceWorkers: () => [genieWorker, otherWorker],
      clearCookies,
    };
    const detach = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn();
    const browser = {
      contexts: () => [context],
      newBrowserCDPSession: vi.fn().mockResolvedValue({ send, detach }),
      close: closeBrowser,
    };

    const result = await clearGenieBrowserOriginState({
      browser: browser as never,
      baseUrl: "https://genie.entrepreneurscircle.org/",
    });

    expect(result).toEqual({
      origin: "https://genie.entrepreneurscircle.org",
      hostname: "genie.entrepreneurscircle.org",
    });
    expect(geniePage.close).toHaveBeenCalledTimes(1);
    expect(otherPage.close).not.toHaveBeenCalled();
    expect(genieWorker.close).toHaveBeenCalledTimes(1);
    expect(otherWorker.close).not.toHaveBeenCalled();
    expect(clearCookies).toHaveBeenNthCalledWith(1, {
      domain: "genie.entrepreneurscircle.org",
    });
    expect(clearCookies).toHaveBeenNthCalledWith(2, {
      domain: ".genie.entrepreneurscircle.org",
    });
    expect(send).toHaveBeenCalledWith("Storage.clearDataForOrigin", {
      origin: "https://genie.entrepreneurscircle.org",
      storageTypes: "all",
    });
    expect(detach).toHaveBeenCalledTimes(1);
    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it("fails closed when the shared Chromium runtime does not expose one persistent context", async () => {
    await expect(
      clearGenieBrowserOriginState({
        browser: { contexts: () => [] } as never,
        baseUrl: "https://genie.entrepreneurscircle.org/",
      })
    ).rejects.toThrow("GENIE_RESET_BROWSER_UNAVAILABLE");
  });
});
