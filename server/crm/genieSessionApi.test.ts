import { beforeEach, describe, expect, it, vi } from "vitest";

const taskBodies: Array<Record<string, unknown>> = [];

vi.mock("../browserConnectors/browserCrmAdapter", () => {
  const page = {
    url: () => "https://genie.entrepreneurscircle.org/v2/location/location-1/tasks",
    evaluate: vi.fn(async (_fn: unknown, request?: Record<string, unknown>) => {
      if (!request)
        return {
          userId: "crm-user-1",
          companyId: "company-1",
          email: "sales@example.com",
        };
      const url = String(request.url || "");
      const body = (request.body || {}) as Record<string, unknown>;
      if (url.includes("/locations/location-1/tasks/search")) {
        taskBodies.push(body);
        const skip = Number(body.skip || 0);
        const length = skip === 0 ? 100 : 70;
        return {
          status: 200,
          ok: true,
          text: JSON.stringify({
            tasks: Array.from({ length }, (_, index) => ({
              id: `task-${skip + index + 1}`,
              title: `Task ${skip + index + 1}`,
              assignedTo: "crm-user-1",
              completed: false,
            })),
          }),
        };
      }
      if (url.includes("/users/crm-user-1"))
        return {
          status: 200,
          ok: true,
          text: JSON.stringify({
            user: {
              id: "crm-user-1",
              firstName: "Sales",
              lastName: "Person",
              email: "sales@example.com",
            },
          }),
        };
      return { status: 200, ok: true, text: JSON.stringify({}) };
    }),
  };
  return {
    browserCrmAdapter: () => ({}),
    withAuthenticatedBrowserSessionPage: async (input: { run: (page: unknown, context: unknown) => unknown }) =>
      input.run(page, {}),
  };
});

import { genieSessionApiAdapter } from "./genieSessionApi";

const connection = {
  id: 1,
  organisationId: 1,
  provider: "genie" as const,
  displayName: "Genie",
  baseUrl: "https://genie.example.test",
  connectionMethod: "browser" as const,
  allowedReadCapabilities: ["tasks.read"],
  allowedWriteCapabilities: [],
  verifiedCapabilities: ["tasks.read"],
  scopes: [],
  configuration: {},
};
const secret = {
  browserUserId: 7,
  crmUserExternalId: "crm-user-1",
  crmUserDisplayName: "Sales Person",
  crmUserEmail: "sales@example.com",
};

describe("Genie authenticated session API adapter", () => {
  beforeEach(() => taskBodies.splice(0));

  it("requests only the exact salesperson's pending tasks and paginates beyond 100", async () => {
    const first = await genieSessionApiAdapter.syncTasks({ connection, secret });
    expect(first.records).toHaveLength(100);
    expect(first.cursor).toBe("100");
    expect(first.records.every(record => record.ownerExternalId === "crm-user-1")).toBe(true);
    expect(first.records.every(record => record.status === "pending")).toBe(true);

    const second = await genieSessionApiAdapter.syncTasks({
      connection,
      secret,
      cursor: first.cursor,
    });
    expect(second.records).toHaveLength(70);
    expect(second.cursor).toBeUndefined();
    expect(taskBodies).toEqual([
      expect.objectContaining({
        assignedTo: ["crm-user-1"],
        completed: false,
        limit: 100,
        skip: 0,
      }),
      expect.objectContaining({
        assignedTo: ["crm-user-1"],
        completed: false,
        limit: 100,
        skip: 100,
      }),
    ]);
  });

  it("fails closed before personal task reads without an exact CRM identity", async () => {
    await expect(
      genieSessionApiAdapter.syncTasks({ connection, secret: { browserUserId: 7 } })
    ).rejects.toThrow("CRM_SALESPERSON_IDENTITY_REQUIRED");
  });

  it("discovers the authenticated CRM user as an immutable identity candidate", async () => {
    const users = await genieSessionApiAdapter.discoverUsers!({ connection, secret });
    expect(users).toEqual([
      expect.objectContaining({
        externalId: "crm-user-1",
        displayName: "Sales Person",
        email: "sales@example.com",
      }),
    ]);
  });
});
