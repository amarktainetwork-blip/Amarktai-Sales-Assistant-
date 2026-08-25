import { describe, expect, it, vi } from "vitest";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  isBrowserSessionPackage,
  validateBrowserSessionPackage,
  type BrowserSessionPackage,
} from "./browserSession";

function sessionPackage(): BrowserSessionPackage {
  return {
    kind: "amarktai.browser-session",
    version: 2,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "https://crm.example.test",
          localStorage: [{ name: "local-auth", value: "approved" }],
          indexedDB: [{ name: "auth", version: 1, stores: [] }],
        },
      ],
    },
    sessionStorageByOrigin: {
      "https://crm.example.test": { "session-auth": "approved" },
    },
    authorisedOrigins: ["https://crm.example.test"],
    capturedAt: "2026-08-25T10:00:00.000Z",
    authenticatedUrl: "https://crm.example.test/dashboard",
  };
}

describe("complete browser session packages", () => {
  it("captures IndexedDB and authorised sessionStorage without exposing values", async () => {
    const storageState = vi
      .fn()
      .mockResolvedValue(sessionPackage().storageState);
    const page = {
      isClosed: () => false,
      url: () => "https://crm.example.test/dashboard",
      evaluate: vi.fn().mockResolvedValue({ "session-auth": "approved" }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const authorise = vi.fn().mockResolvedValue(undefined);
    const captured = await captureBrowserSessionPackage({
      context: { storageState, pages: () => [page] } as never,
      authenticatedUrl: "https://crm.example.test/dashboard",
      authorise,
    });

    expect(storageState).toHaveBeenCalledWith({ indexedDB: true });
    expect(captured.sessionStorageByOrigin["https://crm.example.test"]).toEqual(
      {
        "session-auth": "approved",
      }
    );
    expect(authorise).toHaveBeenCalledWith(
      "https://crm.example.test/dashboard"
    );
  });

  it("captures the settled authenticated URL after a post-MFA SPA transition", async () => {
    let currentUrl = "https://crm.example.test/verification";
    let waitCount = 0;
    const storageState = vi
      .fn()
      .mockResolvedValueOnce({ cookies: [], origins: [] })
      .mockResolvedValue({
        cookies: [{ name: "session", value: "approved" }],
        origins: [],
      });
    const page = {
      isClosed: () => false,
      url: () => currentUrl,
      evaluate: vi.fn().mockResolvedValue({ "session-auth": "approved" }),
      waitForTimeout: vi.fn().mockImplementation(async () => {
        waitCount += 1;
        if (waitCount === 1)
          currentUrl = "https://crm.example.test/dashboard";
      }),
    };
    const authorise = vi.fn().mockResolvedValue(undefined);

    const captured = await captureBrowserSessionPackage({
      context: { storageState, pages: () => [page] } as never,
      authenticatedUrl: "https://crm.example.test/verification",
      authorise,
    });

    expect(captured.authenticatedUrl).toBe(
      "https://crm.example.test/dashboard"
    );
    expect(captured.storageState).toEqual({
      cookies: [{ name: "session", value: "approved" }],
      origins: [],
    });
    expect(authorise).toHaveBeenCalledWith(
      "https://crm.example.test/dashboard"
    );
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it("installs sessionStorage restoration before the first page is created", async () => {
    const order: string[] = [];
    const context = {
      addInitScript: vi.fn().mockImplementation(async () => {
        order.push("init-script");
      }),
      newPage: vi.fn().mockImplementation(async () => {
        order.push("page");
      }),
    };
    const browser = {
      newContext: vi.fn().mockImplementation(async options => {
        order.push("context");
        expect(options.storageState).toEqual(sessionPackage().storageState);
        return context;
      }),
    };
    const restored = await createContextWithBrowserSession({
      browser: browser as never,
      browserSession: sessionPackage(),
    });
    await (restored as never as typeof context).newPage();

    expect(order).toEqual(["context", "init-script", "page"]);
    expect(context.addInitScript).toHaveBeenCalledTimes(1);
  });

  it("rejects sessionStorage for an origin outside the encrypted allowlist", () => {
    const invalid = sessionPackage();
    invalid.sessionStorageByOrigin["https://attacker.example"] = { auth: "x" };
    expect(() => validateBrowserSessionPackage(invalid)).toThrow(
      "BROWSER_SESSION_ORIGIN_NOT_AUTHORISED"
    );
  });

  it("recognises only the complete versioned replay format", () => {
    expect(isBrowserSessionPackage(sessionPackage())).toBe(true);
    expect(isBrowserSessionPackage({ cookies: [], origins: [] })).toBe(false);
  });
});
