import { describe, expect, it, vi } from "vitest";
import {
  createContextWithBrowserSession,
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

  it("recognises only the current scoped format", () => {
    expect(isBrowserSessionPackage(packageFor())).toBe(true);
    expect(isBrowserSessionPackage({ ...packageFor(), version: 2 })).toBe(
      false
    );
  });
});
