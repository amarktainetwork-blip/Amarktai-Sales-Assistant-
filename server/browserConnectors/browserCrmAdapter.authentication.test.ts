import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectOverCDP: vi.fn(),
  assertAuthorisedConnectionUrl: vi.fn(),
  loadConnectionSecret: vi.fn(),
  browserOperationReadinessForSystem: vi.fn(),
  browserShadowMode: vi.fn(),
  recordBrowserOperationResult: vi.fn(),
  requireRuntimeBrowserOperation: vi.fn(),
  recordLearnedRuntimeFailure: vi.fn(),
}));

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}));
vi.mock("../connectedSystems", () => ({
  assertAuthorisedConnectionUrl: mocks.assertAuthorisedConnectionUrl,
  loadConnectionSecret: mocks.loadConnectionSecret,
}));
vi.mock("./learnedOperations", () => ({
  browserOperationReadinessForSystem:
    mocks.browserOperationReadinessForSystem,
  browserShadowMode: mocks.browserShadowMode,
  recordBrowserOperationResult: mocks.recordBrowserOperationResult,
  requireRuntimeBrowserOperation: mocks.requireRuntimeBrowserOperation,
}));
vi.mock("./runtimeFailure", () => ({
  recordLearnedRuntimeFailure: mocks.recordLearnedRuntimeFailure,
}));

import { browserCrmAdapter } from "./browserCrmAdapter";
import type { AdapterConnection } from "../crm/types";

function connection(
  provider: "genie" | "custom_browser",
  browserProfile: Record<string, unknown>
): AdapterConnection {
  return {
    id: 41,
    organisationId: 17,
    provider,
    displayName: provider === "genie" ? "Genie" : "Other CRM",
    baseUrl: null,
    connectionMethod: "browser",
    allowedReadCapabilities: [],
    allowedWriteCapabilities: [],
    verifiedCapabilities: [],
    scopes: [],
    configuration: {
      browserProfile: {
        browserEndpoint: "http://browser.example.test:9222",
        ...browserProfile,
      },
    },
  };
}

function fakeBrowser() {
  let currentUrl = "about:blank";
  const page = {
    route: vi.fn(),
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  return { page, context, browser };
}

describe("browser connector authentication policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GENIE_LOGIN_URL;
    delete process.env.GENIE_USERNAME;
    delete process.env.GENIE_PASSWORD;
    mocks.assertAuthorisedConnectionUrl.mockResolvedValue(
      new URL("https://crm.example.test/")
    );
    mocks.loadConnectionSecret.mockResolvedValue(undefined);
    mocks.browserOperationReadinessForSystem.mockResolvedValue({
      capabilities: [],
      operations: [],
    });
    const runtime = fakeBrowser();
    mocks.connectOverCDP.mockResolvedValue(runtime.browser);
  });

  it("fails closed when Genie has no authorised login configuration", async () => {
    const result = await browserCrmAdapter("genie").testConnection({
      connection: connection("genie", { scripts: {} }),
      secret: { credentials: {} },
      correlationId: "genie-no-login",
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("GENIE_LOGIN_CALIBRATION_REQUIRED");
  });

  it("requires Genie per-connection authentication truth", async () => {
    const result = await browserCrmAdapter("genie").testConnection({
      connection: connection("genie", {
        login: { url: "https://crm.example.test/login" },
        scripts: {},
      }),
      secret: { credentials: {} },
      correlationId: "genie-no-secret",
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("GENIE_CREDENTIALS_REQUIRED");
  });

  it("uses hardened authentication for custom_browser when login exists", async () => {
    const result = await browserCrmAdapter("custom_browser").testConnection({
      connection: connection("custom_browser", {
        login: { url: "https://crm.example.test/login" },
        scripts: {},
      }),
      secret: { credentials: {} },
      correlationId: "custom-login-no-secret",
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("GENIE_CREDENTIALS_REQUIRED");
  });

  it("keeps credentialless custom_browser without login usable", async () => {
    const runtime = fakeBrowser();
    mocks.connectOverCDP.mockResolvedValue(runtime.browser);

    const result = await browserCrmAdapter("custom_browser").testConnection({
      connection: connection("custom_browser", { scripts: {} }),
      secret: { credentials: {} },
      correlationId: "custom-no-login",
    });

    expect(result.status).toBe("limited");
    expect(result.summary).toContain("credentialless browser runtime");
    expect(result.summary).not.toContain("GENIE_CREDENTIALS_REQUIRED");
    expect(runtime.page.route).toHaveBeenCalledWith(
      "**/*",
      expect.any(Function)
    );
    expect(mocks.assertAuthorisedConnectionUrl).not.toHaveBeenCalled();
  });

  it("retains authorised-domain protection for no-login custom_browser operations", async () => {
    const runtime = fakeBrowser();
    mocks.connectOverCDP.mockResolvedValue(runtime.browser);
    mocks.requireRuntimeBrowserOperation.mockResolvedValue({
      status: "LIVE_PROVEN",
      version: 3,
      definition: {
        mode: "read",
        execute: {
          steps: [{ action: "goto", value: "https://evil.example.test/contacts" }],
        },
      },
    });
    mocks.assertAuthorisedConnectionUrl.mockRejectedValue(
      new Error(
        "Browser navigation is outside this connected system's authorised business domain/path."
      )
    );

    await expect(
      browserCrmAdapter("custom_browser").searchContacts({
        connection: connection("custom_browser", { scripts: {} }),
        secret: { credentials: {} },
        query: "Example",
      })
    ).rejects.toThrow("outside this connected system's authorised");
    expect(runtime.page.goto).not.toHaveBeenCalled();
  });

  it("still requires the correct runtime operation state", async () => {
    mocks.requireRuntimeBrowserOperation.mockRejectedValue(
      new Error(
        "OPERATION_NOT_LIVE_PROVEN: 'contact.search' is TEST_READY; production execution requires LIVE_PROVEN."
      )
    );

    await expect(
      browserCrmAdapter("custom_browser").searchContacts({
        connection: connection("custom_browser", { scripts: {} }),
        secret: { credentials: {} },
        query: "Example",
      })
    ).rejects.toThrow("OPERATION_NOT_LIVE_PROVEN");
    expect(mocks.connectOverCDP).not.toHaveBeenCalled();
  });
});
