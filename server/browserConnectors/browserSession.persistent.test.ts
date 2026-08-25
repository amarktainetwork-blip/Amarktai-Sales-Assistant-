import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  type BrowserSessionPackage,
  type PersistentPageMode,
} from "./browserSession";

function persistentPackage(
  persistentPageMode: PersistentPageMode = "retain_live_page"
): BrowserSessionPackage {
  return {
    kind: "amarktai.browser-session",
    version: 2,
    storageState: { cookies: [], origins: [] },
    sessionStorageByOrigin: {
      "https://genie.example.test": { "mfa-approved": "yes" },
    },
    authorisedOrigins: ["https://genie.example.test"],
    capturedAt: "2026-08-25T15:00:00.000Z",
    authenticatedUrl: "https://genie.example.test/dashboard",
    persistenceMode: "persistent_cdp",
    persistentProfileBinding: {
      version: 1,
      organisationId: 11,
      connectedSystemId: 7,
    },
    persistentPageMode,
  };
}

afterEach(() => {
  delete process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH;
});

describe("persistent browser session packages", () => {
  it("promotes the exact MFA-approved page and reuses it without reopening Genie", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");

    let currentUrl = "https://genie.example.test/dashboard";
    let closeHandler: (() => void) | undefined;
    const livePage = {
      close: vi.fn().mockImplementation(async () => closeHandler?.()),
      isClosed: () => false,
      once: vi.fn().mockImplementation((event: string, handler: () => void) => {
        if (event === "close") closeHandler = handler;
      }),
      url: () => currentUrl,
      goto: vi.fn().mockImplementation(async (url: string) => {
        currentUrl = url;
        return null;
      }),
      evaluate: vi.fn().mockResolvedValue({ "mfa-approved": "yes" }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const storageState = vi.fn().mockResolvedValue({ cookies: [], origins: [] });
    const context = {
      pages: vi.fn().mockImplementation(() => [livePage]),
      close: vi.fn(),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(livePage),
      storageState,
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([context]),
      newContext: vi.fn(),
    };

    const commissioningContext = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: persistentPackage("promote_after_auth"),
    });
    const commissioningPage = await commissioningContext.newPage();
    expect(commissioningPage).toBe(livePage);
    expect(context.newPage).toHaveBeenCalledTimes(1);

    const captured = await captureBrowserSessionPackage({
      context: commissioningContext,
      authenticatedUrl: "https://genie.example.test/dashboard",
      authorise: vi.fn().mockResolvedValue(undefined),
      pages: [livePage as never],
    });
    expect(captured.persistentPageMode).toBe("retain_live_page");

    await commissioningContext.close();
    expect(livePage.close).not.toHaveBeenCalled();

    const replayContext = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: captured,
    });
    const replayPage = await replayContext.newPage();
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(replayPage).not.toBe(livePage);
    expect(replayPage.url()).toBe(livePage.url());

    await replayPage.goto("https://genie.example.test/dashboard");
    expect(livePage.goto).not.toHaveBeenCalled();

    await replayContext.close();
    expect(livePage.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
  });

  it("fails closed instead of creating a replacement page when the approved Genie tab is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");

    const context = {
      pages: vi.fn().mockReturnValue([]),
      close: vi.fn(),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn(),
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([context]),
      newContext: vi.fn(),
    };

    const borrowed = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: persistentPackage("retain_live_page"),
    });

    await expect(borrowed.newPage()).rejects.toThrow(
      "GENIE_AUTHENTICATED_PAGE_UNAVAILABLE"
    );
    expect(context.newPage).not.toHaveBeenCalled();
    expect(browser.newContext).not.toHaveBeenCalled();
  });

  it("preserves persistent profile identity and tab-scoped storage in the encrypted session package", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");
    const sessionPage = {
      close: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
      once: vi.fn(),
      url: () => "https://genie.example.test/dashboard",
      goto: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue({ "mfa-approved": "yes" }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const storageState = vi.fn().mockResolvedValue({ cookies: [], origins: [] });
    const context = {
      pages: vi.fn().mockReturnValue([sessionPage]),
      close: vi.fn(),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(sessionPage),
      storageState,
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([context]),
      newContext: vi.fn(),
    };

    const borrowed = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: persistentPackage("promote_after_auth"),
    });
    await borrowed.newPage();
    const captured = await captureBrowserSessionPackage({
      context: borrowed,
      authenticatedUrl: "https://genie.example.test/dashboard",
      authorise: vi.fn().mockResolvedValue(undefined),
      pages: [sessionPage as never],
    });

    expect(captured.persistenceMode).toBe("persistent_cdp");
    expect(captured.persistentPageMode).toBe("retain_live_page");
    expect(captured.persistentProfileBinding).toEqual({
      version: 1,
      organisationId: 11,
      connectedSystemId: 7,
    });
    expect(captured.sessionStorageByOrigin["https://genie.example.test"]).toEqual({
      "mfa-approved": "yes",
    });
  });
});
