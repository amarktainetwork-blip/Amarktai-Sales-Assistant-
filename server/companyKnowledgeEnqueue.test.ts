import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  recordAudit: vi.fn(),
  validatePublicWebsiteUrl: vi.fn(),
  discoverPublicWebsite: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  recordAudit: mocks.recordAudit,
  saveWebsiteDiscoveryReview: vi.fn(),
}));

vi.mock("./companyDiscovery", () => ({
  validatePublicWebsiteUrl: mocks.validatePublicWebsiteUrl,
  discoverPublicWebsite: mocks.discoverPublicWebsite,
}));

import { startCompanyKnowledgeJob } from "./companyKnowledgeJobs";

describe("company website discovery enqueue boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates and durably queues a job without executing the crawler in the API call", async () => {
    const job = {
      id: 42,
      userId: 9,
      organisationId: 7,
      companyProfileId: 5,
      websiteUrl: "https://example.co.za/",
      phase: "SCANNING_WEBSITE" as const,
      status: "queued" as const,
      progress: { humanStatus: "Scanning website" },
      discoverySnapshot: null,
      pageInventory: null,
      mapResults: null,
      corpusSnapshot: null,
      corpusHash: null,
      sourceHashes: null,
      analysisDraft: null,
      auditDraft: null,
      validatedPack: null,
      temporaryResources: null,
      analysisCalls: 0,
      auditCalls: 0,
      normalizationEvents: 0,
      repairCalls: 0,
      resultDiscoveryId: null,
      attempt: 0,
      leaseExpiresAt: null,
      lastError: null,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const selectResults: unknown[][] = [[], [job]];
    const database = {
      select: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn(() => chain);
        chain.where = vi.fn(() => chain);
        chain.orderBy = vi.fn(() => chain);
        chain.limit = vi.fn(() => Promise.resolve(result));
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve([{ insertId: 42 }])),
      })),
    };
    mocks.validatePublicWebsiteUrl.mockResolvedValue(job.websiteUrl);
    mocks.getDb.mockResolvedValue(database);
    mocks.recordAudit.mockResolvedValue(undefined);

    await expect(
      startCompanyKnowledgeJob({
        userId: 9,
        organisationId: 7,
        companyProfileId: 5,
        websiteUrl: "https://example.co.za",
      })
    ).resolves.toMatchObject({ id: 42, status: "queued" });

    expect(mocks.validatePublicWebsiteUrl).toHaveBeenCalledWith(
      "https://example.co.za"
    );
    expect(database.insert).toHaveBeenCalledTimes(1);
    expect(mocks.discoverPublicWebsite).not.toHaveBeenCalled();
  });
});
