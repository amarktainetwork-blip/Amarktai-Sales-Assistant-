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
    const clearCookies = vi.fn().mockResolvedValue(undefined);
    const context = {
      pages: () => [geniePage, otherPage],
      clearCookies,
    };
    const detach = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockImplementation((method: string) =>
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
    expect(send).toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "genie-worker",
    });
    expect(send).not.toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "other-worker",
    });
    expect(send).not.toHaveBeenCalledWith("Target.closeTarget", {
      targetId: "genie-page-target",
    });
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
    const send = vi
      .fn()
      .mockImplementation((method: string) =>
        method === "Target.getTargets"
          ? Promise.resolve({ targetInfos: [] })
          : Promise.resolve({})
      );
    const deleteConnectionAndAudit = vi.fn().mockResolvedValue(undefined);
    const releaseProfile = vi.fn().mockResolvedValue(false);
    const browser = {
      contexts: () => [{ pages: () => [], clearCookies }],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send,
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
    expect(releaseProfile).toHaveBeenCalledWith(system);
    expect(deleteConnectionAndAudit).toHaveBeenCalledWith({
      system,
      userId: 3,
      hostname: "genie.entrepreneurscircle.org",
    });
    expect(browser.close).not.toHaveBeenCalled();
  });

  it("fails closed on a different profile owner and never deletes the connection", async () => {
    const deleteConnectionAndAudit = vi.fn();
    const browser = vi.fn().mockResolvedValue({
      contexts: () => [
        { pages: () => [], clearCookies: vi.fn().mockResolvedValue(undefined) },
      ],
      newBrowserCDPSession: vi.fn().mockResolvedValue({
        send: vi
          .fn()
          .mockImplementation((method: string) =>
            Promise.resolve(
              method === "Target.getTargets" ? { targetInfos: [] } : {}
            )
          ),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    });
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
