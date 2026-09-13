import { describe, expect, it, vi } from "vitest";
import type { BrowserContext } from "playwright-core";
import {
  captureBrowserSessionPackage,
  createContextWithBrowserSession,
  findBrowserSessionPage,
  isBrowserSessionPackage,
  validateBrowserSessionPackage,
  type BrowserSessionPackage,
} from "./browserSession";

function packageFor(
  organisationId = 7,
  connectedSystemId = 11
): BrowserSessionPackage {
  return {
    kind: "amarktai.crm-browser-session",
    version: 3,
    organisationId,
    connectedSystemId,
    storageState: { cookies: [{ name: "sid", value: "encrypted-at-rest" }] },
    sessionStorageByOrigin: { "https://crm.example.test": { app: "ready" } },
    authorisedOrigins: ["https://crm.example.test"],
    capturedAt: new Date().toISOString(),
    authenticatedUrl: "https://crm.example.test/app",
    pageTargetId: "target_abc123",
  };
}

describe("connection-scoped browser session packages", () => {
  it("captures the exact authenticated Chromium target in the current v3 package", async () => {
    const detach = vi.fn(async () => undefined);
    const page = {
      isClosed: () => false,
      url: () => "https://crm.example.test/app",
      evaluate: vi.fn(async () => ({ app: "ready" })),
      context: (): BrowserContext => context as never,
    };
    const context = {
      pages: () => [page],
      storageState: vi.fn(async () => ({ cookies: [] })),
      newCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({
          targetInfo: { targetId: "target_abc123" },
        })),
        detach,
      })),
    };
    const captured = await captureBrowserSessionPackage({
      context: context as never,
      organisationId: 7,
      connectedSystemId: 11,
      authenticatedUrl: "https://crm.example.test/app",
      authorise: vi.fn(async () => undefined),
      pages: [page as never],
    });
    expect(captured.pageTargetId).toBe("target_abc123");
    expect(captured.version).toBe(3);
    expect(detach).toHaveBeenCalledOnce();
  });

  it("accepts the correct organisation and connection owner", () => {
    expect(
      validateBrowserSessionPackage(packageFor(), {
        organisationId: 7,
        connectedSystemId: 11,
      }).connectedSystemId
    ).toBe(11);
  });

  it("rejects organisation and connection crossover", () => {
    expect(() =>
      validateBrowserSessionPackage(packageFor(), {
        organisationId: 8,
        connectedSystemId: 11,
      })
    ).toThrow("OWNERSHIP_MISMATCH");
    expect(() =>
      validateBrowserSessionPackage(packageFor(), {
        organisationId: 7,
        connectedSystemId: 12,
      })
    ).toThrow("OWNERSHIP_MISMATCH");
  });

  it("rejects a malformed persisted browser target identity", () => {
    expect(
      isBrowserSessionPackage({
        ...packageFor(),
        pageTargetId: "bad target/id",
      })
    ).toBe(false);
  });

  it("reattaches only to the exact persisted Chromium target", async () => {
    const detach = vi.fn(async () => undefined);
    const matchingContext = {
      pages: () => [
        {
          isClosed: () => false,
          url: () => "https://crm.example.test/app",
          context: () => matchingContext,
        },
      ],
      newCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({
          targetInfo: { targetId: "target_abc123" },
        })),
        detach,
      })),
    };
    const browser = { contexts: () => [matchingContext] };
    const authorise = vi.fn(async () => undefined);
    const result = await findBrowserSessionPage({
      browser: browser as never,
      browserSession: packageFor(),
      organisationId: 7,
      connectedSystemId: 11,
      authorise,
    });
    expect(result?.targetId).toBe("target_abc123");
    expect(authorise).toHaveBeenCalledWith("https://crm.example.test/app");
    expect(detach).toHaveBeenCalled();
  });

  it("does not substitute another live page when the exact target is gone", async () => {
    const context = {
      pages: () => [
        {
          isClosed: () => false,
          url: () => "https://crm.example.test/app",
          context: (): BrowserContext => context as never,
        },
      ],
      newCDPSession: vi.fn(async () => ({
        send: vi.fn(async () => ({ targetInfo: { targetId: "other-target" } })),
        detach: vi.fn(async () => undefined),
      })),
    };
    await expect(
      findBrowserSessionPage({
        browser: { contexts: () => [context] } as never,
        browserSession: packageFor(),
        organisationId: 7,
        connectedSystemId: 11,
      })
    ).resolves.toBeUndefined();
  });


  it("recovers exactly one authorised Genie page in the same location scope when the saved target is stale", async () => {
    const pages = [
      {
        isClosed: () => false,
        url: () =>
          "https://genie.entrepreneurscircle.org/v2/location/location-a/contacts/detail/contact-1",
        context: () => context as never,
      },
      {
        isClosed: () => false,
        url: () =>
          "https://genie.entrepreneurscircle.org/?url=%252Fv2%252Flocation%252Flocation-a%252Ftasks",
        context: () => context as never,
      },
    ];
    const context = {
      pages: () => pages,
      newCDPSession: vi.fn(async (page: unknown) => ({
        send: vi.fn(async () => ({
          targetInfo: {
            targetId:
              page === pages[0] ? "authenticated-live-target" : "login-target",
          },
        })),
        detach: vi.fn(async () => undefined),
      })),
    };
    const session = {
      ...packageFor(),
      authenticatedUrl:
        "https://genie.entrepreneurscircle.org/v2/location/location-a/tasks",
      authorisedOrigins: ["https://genie.entrepreneurscircle.org"],
      sessionStorageByOrigin: {
        "https://genie.entrepreneurscircle.org": { app: "ready" },
      },
      pageTargetId: "stale-target",
    };
    const authorise = vi.fn(async () => undefined);
    const result = await findBrowserSessionPage({
      browser: { contexts: () => [context] } as never,
      browserSession: session,
      organisationId: 7,
      connectedSystemId: 11,
      authorise,
      allowSameScopedPageRecovery: true,
    });
    expect(result?.page).toBe(pages[0]);
    expect(result?.targetId).toBe("authenticated-live-target");
    expect(authorise).toHaveBeenCalledWith(
      "https://genie.entrepreneurscircle.org/v2/location/location-a/contacts/detail/contact-1"
    );
  });

  it("refuses same-scope recovery when more than one authenticated workspace page matches", async () => {
    const pages = [
      "https://genie.entrepreneurscircle.org/v2/location/location-a/contacts",
      "https://genie.entrepreneurscircle.org/v2/location/location-a/tasks",
    ].map((url, index) => ({
      isClosed: () => false,
      url: () => url,
      context: () => context as never,
      index,
    }));
    const context = {
      pages: () => pages,
      newCDPSession: vi.fn(async (page: any) => ({
        send: vi.fn(async () => ({
          targetInfo: { targetId: "candidate-" + page.index },
        })),
        detach: vi.fn(async () => undefined),
      })),
    };
    const session = {
      ...packageFor(),
      authenticatedUrl:
        "https://genie.entrepreneurscircle.org/v2/location/location-a/tasks",
      authorisedOrigins: ["https://genie.entrepreneurscircle.org"],
      sessionStorageByOrigin: {
        "https://genie.entrepreneurscircle.org": { app: "ready" },
      },
      pageTargetId: "stale-target",
    };
    await expect(
      findBrowserSessionPage({
        browser: { contexts: () => [context] } as never,
        browserSession: session,
        organisationId: 7,
        connectedSystemId: 11,
        allowSameScopedPageRecovery: true,
      })
    ).resolves.toBeUndefined();
  });

  it("does not restore a legacy or unscoped package", async () => {
    const newContext = vi.fn(async () => ({ addInitScript: vi.fn() }));
    await createContextWithBrowserSession({
      browser: { newContext } as never,
      browserSession: {
        kind: "legacy",
        storageState: { cookies: [{ name: "sid", value: "wrong" }] },
      },
      organisationId: 7,
      connectedSystemId: 11,
    });
    expect(newContext).toHaveBeenCalledWith(undefined);
  });

  it("recognises current scoped packages with or without a target for backward compatibility", () => {
    expect(isBrowserSessionPackage(packageFor())).toBe(true);
    const { pageTargetId: _target, ...oldV3 } = packageFor();
    expect(isBrowserSessionPackage(oldV3)).toBe(true);
    expect(isBrowserSessionPackage({ ...packageFor(), version: 2 })).toBe(
      false
    );
  });
});
