import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  type BrowserSessionPackage,
} from "./browserSession";

function persistentPackage(): BrowserSessionPackage {
  return {
    kind: "amarktai.browser-session",
    version: 2,
    storageState: { cookies: [], origins: [] },
    sessionStorageByOrigin: {
      "https://genie.example.test": {},
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
  };
}

afterEach(() => {
  delete process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH;
});

describe("persistent browser session packages", () => {
  it("borrows the default CDP context and closes only pages created by the borrower", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");

    const baselinePage = { close: vi.fn(), isClosed: () => false };
    const createdPage = { close: vi.fn().mockResolvedValue(undefined), isClosed: () => false };
    const context = {
      pages: vi.fn().mockReturnValueOnce([baselinePage]).mockReturnValue([baselinePage, createdPage]),
      close: vi.fn(),
      newPage: vi.fn().mockResolvedValue(createdPage),
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([context]),
      newContext: vi.fn(),
    };

    const borrowed = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: persistentPackage(),
    });
    await borrowed.newPage();
    await borrowed.close();

    expect(browser.newContext).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
    expect(baselinePage.close).not.toHaveBeenCalled();
    expect(createdPage.close).toHaveBeenCalledTimes(1);
  });

  it("preserves persistent profile identity in the encrypted session package", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amarktai-profile-"));
    process.env.GENIE_PERSISTENT_PROFILE_BINDING_PATH = join(directory, "owner.json");
    const sessionPage = {
      close: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
      url: () => "https://genie.example.test/dashboard",
      evaluate: vi.fn().mockResolvedValue({}),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const storageState = vi.fn().mockResolvedValue({ cookies: [], origins: [] });
    const context = {
      pages: vi.fn().mockReturnValue([]),
      close: vi.fn(),
      newPage: vi.fn().mockResolvedValue(sessionPage),
      storageState,
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([context]),
      newContext: vi.fn(),
    };

    const borrowed = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: persistentPackage(),
    });
    await borrowed.newPage();
    const captured = await captureBrowserSessionPackage({
      context: borrowed,
      authenticatedUrl: "https://genie.example.test/dashboard",
      authorise: vi.fn().mockResolvedValue(undefined),
      pages: [sessionPage as never],
    });

    expect(captured.persistenceMode).toBe("persistent_cdp");
    expect(captured.persistentProfileBinding).toEqual({
      version: 1,
      organisationId: 11,
      connectedSystemId: 7,
    });
  });
});
