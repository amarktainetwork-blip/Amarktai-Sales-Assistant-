import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  connect: vi.fn(),
  failure: vi.fn(),
  record: vi.fn(),
  page: {
    route: vi.fn(),
    unroute: vi.fn(),
    url: () => "https://crm.example.invalid/",
  },
}));
vi.mock("./managedCrmBrowserSessionManager", () => ({
  connectManagedCrmBrowser: mocks.connect,
}));
vi.mock("../connectedSystems", () => ({
  assertAuthorisedConnectionUrl: vi.fn(),
}));
vi.mock("./browserSession", () => ({
  isBrowserSessionPackage: () => true,
  findBrowserSessionPage: async () => ({ page: mocks.page, context: {} }),
  createContextWithBrowserSession: vi.fn(),
}));
vi.mock("./learnedOperations", () => ({
  requireRuntimeBrowserOperation: async () => ({
    version: 2,
    status: "TEST_READY",
    definition: {
      mode: "read",
      execute: { steps: [{ action: "expect_visible", selector: "body" }] },
      resultKey: "records",
    },
  }),
  latestBrowserOperation: vi.fn(),
  recordBrowserOperationResult: mocks.record,
  browserShadowMode: vi.fn(),
  browserOperationReadinessForSystem: vi.fn(),
}));
vi.mock("./runtimeFailure", () => ({
  recordLearnedRuntimeFailure: mocks.failure,
}));
vi.mock("./scriptEngine", () => ({
  executeSavedBrowserScript: mocks.execute,
  validateSavedBrowserScript: vi.fn(),
}));
import {
  browserCrmAdapter,
  testLearnedBrowserOperation,
} from "./browserCrmAdapter";
import {
  browserControlState,
  acquireHumanBrowserControl,
  resetBrowserControlArbitrationForTests,
} from "./browserControlArbitration";
const scope = { organisationId: 7, connectedSystemId: 8, userId: 9 };
const input = {
  connection: {
    id: 8,
    organisationId: 7,
    provider: "genie" as const,
    displayName: "Genie",
    baseUrl: "https://crm.example.invalid/",
    connectionMethod: "browser" as const,
    allowedReadCapabilities: [],
    allowedWriteCapabilities: [],
    verifiedCapabilities: [],
    scopes: [],
    configuration: {},
  },
  provider: "genie" as const,
  operationKey: "contact.search",
  correlationId: "ownership-test",
  secret: { browserUserId: 9, browserSession: {} as never },
};
const result = {
  success: true,
  detail: "read complete",
  data: { records: "[]" },
  completedAt: new Date().toISOString(),
};
beforeEach(() => {
  vi.stubEnv("BROWSERLESS_WS_ENDPOINT", "http://browser.invalid:9222");
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({});
  mocks.page.unroute.mockResolvedValue(undefined);
  mocks.execute.mockImplementation(async args => {
    args.assertControl();
    return result;
  });
});
afterEach(() => {
  resetBrowserControlArbitrationForTests();
  vi.unstubAllEnvs();
});
describe("canonical deterministic execution ownership", () => {
  it("returns no fabricated contact when the CRM returns no matches", async () => {
    const adapter = browserCrmAdapter("genie");
    expect(await adapter.searchContacts({ ...input, query: "Nobody" })).toEqual(
      []
    );
    expect(
      await adapter.getContact({ ...input, externalId: "missing" })
    ).toBeNull();
  });
  it("rejects missing structured CRM output", async () => {
    mocks.execute.mockImplementation(async args => {
      args.assertControl();
      return { ...result, data: {} };
    });
    await expect(
      browserCrmAdapter("genie").searchContacts({ ...input, query: "Nobody" })
    ).rejects.toThrow("STRUCTURED_RESULT_REQUIRED");
  });
  it("executes as owner and releases after success", async () => {
    await testLearnedBrowserOperation(input);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(browserControlState(scope)).toBe("IDLE");
  });
  it("releases when deterministic execution throws", async () => {
    mocks.execute.mockImplementation(async args => {
      args.assertControl();
      throw Error("selector missing");
    });
    await expect(testLearnedBrowserOperation(input)).rejects.toThrow(
      "selector missing"
    );
    expect(browserControlState(scope)).toBe("IDLE");
    expect(mocks.failure).toHaveBeenCalledOnce();
  });
  it("does not connect while a human controls the target", async () => {
    acquireHumanBrowserControl(scope);
    await expect(testLearnedBrowserOperation(input)).rejects.toThrow(
      "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("blocks an overlapping unrelated execution", async () => {
    let finish: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    mocks.execute.mockImplementation(async args => {
      args.assertControl();
      entered();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      args.assertControl();
      return result;
    });
    const first = testLearnedBrowserOperation(input);
    await started;
    await expect(
      testLearnedBrowserOperation({ ...input, correlationId: "competitor" })
    ).rejects.toThrow("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
    finish();
    await first;
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(browserControlState(scope)).toBe("IDLE");
  });
});
