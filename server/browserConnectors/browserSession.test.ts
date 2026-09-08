import { describe, expect, it, vi } from "vitest";
import {
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
      isBrowserSessionPackage({ ...packageFor(), pageTargetId: "bad target/id" })
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
