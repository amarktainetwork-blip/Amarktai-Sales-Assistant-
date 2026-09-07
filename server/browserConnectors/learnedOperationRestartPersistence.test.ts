import { beforeEach, describe, expect, it, vi } from "vitest";

const durableRows = [
  {
    id: 1,
    organisationId: 7,
    connectedSystemId: 9,
    operationKey: "contact.read",
    version: 3,
    status: "LIVE_PROVEN",
    definition: {
      mode: "read",
      execute: {
        steps: [{ action: "expect_visible", selector: "[data-contact-id]" }],
      },
    },
    prerequisites: {},
    targetAssertions: {},
    postconditionAssertions: [],
    checksum: "persisted-checksum",
    evidence: { controlledReplay: true, modelUsed: false },
    lastTestAt: new Date("2026-08-31T08:00:00.000Z"),
    lastSuccessAt: new Date("2026-08-31T08:00:00.000Z"),
    lastFailureAt: null,
    lastError: null,
    createdByUserId: 2,
    createdAt: new Date("2026-08-31T08:00:00.000Z"),
    updatedAt: new Date("2026-08-31T08:00:00.000Z"),
  },
];

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => durableRows }),
        }),
      }),
    }),
  })),
  recordAudit: vi.fn(),
}));

describe("LIVE_PROVEN learned-operation restart persistence", () => {
  beforeEach(() => vi.resetModules());

  it("reloads the durable definition after a process-module restart without commissioning", async () => {
    const model = vi.fn(() => {
      throw new Error("model unavailable after commissioning");
    });
    const first = await import("./learnedOperations");
    const before = await first.requireRuntimeBrowserOperation({
      organisationId: 7,
      connectedSystemId: 9,
      operationKey: "contact.read",
    });
    vi.resetModules();
    const restarted = await import("./learnedOperations");
    const after = await restarted.requireRuntimeBrowserOperation({
      organisationId: 7,
      connectedSystemId: 9,
      operationKey: "contact.read",
    });
    expect(after.definition).toEqual(before.definition);
    expect(after.status).toBe("LIVE_PROVEN");
    expect(after.checksum).toBe("persisted-checksum");
    expect(model).not.toHaveBeenCalled();
  });
});
