import { describe, expect, it, vi } from "vitest";
import {
  clearGenieBrowserOriginState,
  resetAndDeleteGenieConnection,
} from "./resetConnection";

function genieSystem(provider = "genie") {
  return {
    id: 7,
    organisationId: 11,
    provider,
    displayName: "Genie",
    baseUrl: "https://genie.entrepreneurscircle.org/",
    connectionMethod: "browser",
    status: "needs_attention",
    allowedReadCapabilities: [],
    allowedWriteCapabilities: [],
    verifiedCapabilities: [],
    accountExternalId: null,
    scopes: [],
    configuration: {},
    lastHealthCheckAt: null,
    lastHealthSummary: null,
    readyAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as const;
}

describe("fresh Genie browser reset", () => {
  it("clears only the Genie origin through a page CDP session and never closes the shared browser", async () => {
    let genieClosed = false;
    const geniePage = {
      isClosed: () => genieClosed,
      url: () => "https://genie.entrepreneurscircle.org/dashboard",
      close: vi.fn().mockImplementation(async () => {
        genieClosed = true;
      }),
    };
    const otherPage = {
      isClosed: () => false,
      url: () => "https://example.test/dashboard",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const clearCookies = vi.fn().mockResolvedValue(undefined);
    const browserDetach = vi.fn().mockResolvedValue(undefined);
    const browserSend = vi.fn().mockImplementation((method: string) =>
      method === "Target.getTargets"
        ? Promise.resolve({
            targetInfos: [
              {
                targetId: "genie-worker",
                type: "service_worker",
                url: "https://genie.entrepreneurscircle.org/sw.js",
              },
              {
                targetId: "other-worker",
                type: "service_worker",
                url: "https://example.test/sw.js",
              },
              {
                targetId: "genie-page-target",
                type: "page",
                url: "https://genie.entrepreneurscircle.org/dashboard",
              },
            ],
          })
        : Promise.resolve({ success: true })
    );
    const storageDetach = vi.fn().mockResolvedValue(undefined);
    const storageSend = vi.fn().mockResolvedValue({ success: true });
    const newCDPSession = vi.fn().mockResolvedValue({
      send: storageSend,
      detach: storageDetach,
    });
    const context = {
      pages: () => [geniePage, otherPage],
      clearCookies,
      newPage: vi.fn(),
      newCDPSession,
    };
    const closeBrowser = vi.fn();
    const browser = {
      contexts: () => [context],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send: browserSend,
        detach: browserDetach,
      }),
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
    expect(browserSend).toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "genie-worker",
    });
    expect(browserSend).not.toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "other-worker",
    });
    expect(browserSend).not.toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "genie-page-target",
    });
    expect(clearCookies).toHaveBeenNthCalledWith(1, {
      domain: "genie.entrepreneurscircle.org",
    });
    expect(clearCookies).toHaveBeenNthCalledWith(2, {
      domain: ".genie.entrepreneurscircle.org",
    });
    expect(newCDPSession).toHaveBeenCalledWith(otherPage);
    expect(storageSend).toHaveBeenCalledWith("Storage.clearDataForOrigin", {
      origin: "https://genie.entrepreneurscircle.org",
      storageTypes: "all",
    });
    expect(browserSend).not.toHaveBeenCalledWith(
      "Storage.clearDataForOrigin",
      expect.anything()
    );
    expect(browserDetach).toHaveBeenCalledTimes(1);
    expect(storageDetach).toHaveBeenCalledTimes(1);
    expect(context.newPage).not.toHaveBeenCalled();
    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it("creates and removes an about:blank page only when no live page exists for frame-scoped storage cleanup", async () => {
    const temporaryPage = {
      isClosed: () => false,
      url: () => "about:blank",
      close: vi.fn().mockResolvedValue(undefined),
    };
    const newCDPSession = vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
    });
    const context = {
      pages: () => [],
      clearCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(temporaryPage),
      newCDPSession,
    };
    const browser = {
      contexts: () => [context],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ targetInfos: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    await clearGenieBrowserOriginState({
      browser: browser as never,
      baseUrl: "https://genie.entrepreneurscircle.org/",
    });

    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(newCDPSession).toHaveBeenCalledWith(temporaryPage);
    expect(temporaryPage.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the shared Chromium runtime does not expose one persistent context", async () => {
    await expect(
      clearGenieBrowserOriginState({
        browser: { contexts: () => [] } as never,
        baseUrl: "https://genie.entrepreneurscircle.org/",
      })
    ).rejects.toThrow("GENIE_RESET_BROWSER_UNAVAILABLE");
  });

  it("refuses a missing connection and a non-Genie provider before browser access", async () => {
    const browser = vi.fn();
    const base = {
      browser,
      releaseProfile: vi.fn(),
      restoreProfile: vi.fn(),
      deleteConnectionAndAudit: vi.fn(),
    };
    await expect(
      resetAndDeleteGenieConnection(
        {
          connectedSystemId: 7,
          organisationId: 11,
          userId: 3,
          confirmDelete: true,
        },
        { ...base, loadSystem: vi.fn().mockResolvedValue(undefined) } as never
      )
    ).rejects.toThrow("GENIE_RESET_CONNECTION_NOT_FOUND");
    await expect(
      resetAndDeleteGenieConnection(
        {
          connectedSystemId: 7,
          organisationId: 11,
          userId: 3,
          confirmDelete: true,
        },
        {
          ...base,
          loadSystem: vi.fn().mockResolvedValue(genieSystem("hubspot")),
        } as never
      )
    ).rejects.toThrow("GENIE_RESET_REFUSED");
    expect(browser).not.toHaveBeenCalled();
  });

  it("supports a dry-run preview without touching browser or database state", async () => {
    const browser = vi.fn();
    const deleted = vi.fn();
    const result = await resetAndDeleteGenieConnection(
      {
        connectedSystemId: 7,
        organisationId: 11,
        userId: 3,
        confirmDelete: false,
      },
      {
        loadSystem: vi.fn().mockResolvedValue(genieSystem()),
        browser,
        releaseProfile: vi.fn(),
        restoreProfile: vi.fn(),
        deleteConnectionAndAudit: deleted,
      } as never
    );
    expect(result).toMatchObject({
      deleted: false,
      preview: { connectedSystemId: 7, organisationId: 11, provider: "genie" },
    });
    expect(browser).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });

  it("deletes only the selected organisation connection and records knowledge preservation", async () => {
    const clearCookies = vi.fn().mockResolvedValue(undefined);
    const browserSend = vi
      .fn()
      .mockImplementation((method: string) =>
        method === "Target.getTargets"
          ? Promise.resolve({ targetInfos: [] })
          : Promise.resolve({})
      );
    const storageSend = vi.fn().mockResolvedValue({});
    const otherPage = {
      isClosed: () => false,
      url: () => "https://example.test/",
      close: vi.fn(),
    };
    const context = {
      pages: () => [otherPage],
      clearCookies,
      newPage: vi.fn(),
      newCDPSession: vi.fn().mockResolvedValue({
        send: storageSend,
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const deleteConnectionAndAudit = vi.fn().mockResolvedValue(undefined);
    const releaseProfile = vi.fn().mockResolvedValue(false);
    const browser = {
      contexts: () => [context],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send: browserSend,
        detach: vi.fn().mockResolvedValue(undefined),
      }),
      close: vi.fn(),
    };
    const system = genieSystem();
    const result = await resetAndDeleteGenieConnection(
      {
        connectedSystemId: 7,
        organisationId: 11,
        userId: 3,
        confirmDelete: true,
      },
      {
        loadSystem: vi
          .fn()
          .mockImplementation((id, organisationId) =>
            Promise.resolve(
              id === 7 && organisationId === 11 ? system : undefined
            )
          ),
        browser: vi.fn().mockResolvedValue(browser),
        releaseProfile,
        restoreProfile: vi.fn(),
        deleteConnectionAndAudit,
      } as never
    );
    expect(result.deleted).toBe(true);
    expect(storageSend).toHaveBeenCalledWith("Storage.clearDataForOrigin", {
      origin: "https://genie.entrepreneurscircle.org",
      storageTypes: "all",
    });
    expect(releaseProfile).toHaveBeenCalledWith(system);
    expect(deleteConnectionAndAudit).toHaveBeenCalledWith({
      system,
      userId: 3,
      hostname: "genie.entrepreneurscircle.org",
    });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("fails closed if frame-scoped Genie origin storage cannot be cleared", async () => {
    const deleteConnectionAndAudit = vi.fn();
    const releaseProfile = vi.fn();
    const otherPage = {
      isClosed: () => false,
      url: () => "https://example.test/",
      close: vi.fn(),
    };
    const browser = {
      contexts: () => [
        {
          pages: () => [otherPage],
          clearCookies: vi.fn().mockResolvedValue(undefined),
          newPage: vi.fn(),
          newCDPSession: vi.fn().mockResolvedValue({
            send: vi.fn().mockRejectedValue(new Error("storage clear failed")),
            detach: vi.fn().mockResolvedValue(undefined),
          }),
        },
      ],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ targetInfos: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    await expect(
      resetAndDeleteGenieConnection(
        {
          connectedSystemId: 7,
          organisationId: 11,
          userId: 3,
          confirmDelete: true,
        },
        {
          loadSystem: vi.fn().mockResolvedValue(genieSystem()),
          browser: vi.fn().mockResolvedValue(browser),
          releaseProfile,
          restoreProfile: vi.fn(),
          deleteConnectionAndAudit,
        } as never
      )
    ).rejects.toThrow("storage clear failed");
    expect(releaseProfile).not.toHaveBeenCalled();
    expect(deleteConnectionAndAudit).not.toHaveBeenCalled();
  });

  it("fails closed on a different profile owner and never deletes the connection", async () => {
    const deleteConnectionAndAudit = vi.fn();
    const browser = vi.fn();
    await expect(
      resetAndDeleteGenieConnection(
        {
          connectedSystemId: 7,
          organisationId: 11,
          userId: 3,
          confirmDelete: true,
        },
        {
          loadSystem: vi.fn().mockResolvedValue(genieSystem()),
          browser,
          assertProfileOwnership: vi
            .fn()
            .mockRejectedValue(
              new Error("GENIE_PERSISTENT_PROFILE_RELEASE_BLOCKED")
            ),
          releaseProfile: vi.fn(),
          restoreProfile: vi.fn(),
          deleteConnectionAndAudit,
        } as never
      )
    ).rejects.toThrow("GENIE_PERSISTENT_PROFILE_RELEASE_BLOCKED");
    expect(browser).not.toHaveBeenCalled();
    expect(deleteConnectionAndAudit).not.toHaveBeenCalled();
  });
});
