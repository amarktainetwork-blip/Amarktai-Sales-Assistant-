import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taskBodies: Array<Record<string, unknown>> = [];
let authenticatedPageCalls = 0;

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
      if (url.includes("/conversations/search"))
        return {
          status: 200,
          ok: true,
          text: JSON.stringify({ conversations: [{ id: "foreign-activity", assignedTo: "foreign-owner", lastMessageDate: null }] }),
        };
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
    withAuthenticatedBrowserSessionPage: async (input: { run: (page: unknown, context: unknown) => unknown }) => {
      authenticatedPageCalls += 1;
      return input.run(page, {});
    },
  };
});

import {
  genieSessionApiAdapter,
  genieSessionActivity,
  genieSessionSourceDate,
  genieTokenlessProfileIdentity,
  sessionRequestOnPage,
} from "./genieSessionApi";

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

describe("Genie live-page dynamic token boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the current in-page getToken for an owner-scoped read when storage tokens are absent", async () => {
    const fetchRead = vi.fn(async () => ({
      status: 200, ok: true,
      text: async () => JSON.stringify({ contacts: [{ id: "owned-contact" }] }),
    }));
    vi.stubGlobal("window", { getToken: async () => "live-dynamic-token" });
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    vi.stubGlobal("fetch", fetchRead);
    const page = { evaluate: async (run: (value: unknown) => unknown, arg: unknown) => run(arg) } as any;
    const url = "https://services.leadconnectorhq.com/contacts/search";
    const result = await sessionRequestOnPage(page, {
      url, method: "POST", body: { assignedTo: "owner" },
    });
    expect(result).toEqual({ contacts: [{ id: "owned-contact" }] });
    expect(fetchRead).toHaveBeenCalledWith(url, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "token-id": "live-dynamic-token" }),
    }));
  });

  it("fails closed without any authenticated token rather than attempting the provider read", async () => {
    const fetchRead = vi.fn();
    vi.stubGlobal("window", { getToken: async () => "" });
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    vi.stubGlobal("fetch", fetchRead);
    const page = { evaluate: async (run: (value: unknown) => unknown, arg: unknown) => run(arg) } as any;
    await expect(sessionRequestOnPage(page, {
      url: "https://services.leadconnectorhq.com/contacts/search",
      method: "POST", body: { assignedTo: "owner" },
    })).rejects.toThrow("GENIE_SESSION_TOKEN_UNAVAILABLE");
    expect(fetchRead).not.toHaveBeenCalled();
  });
});

describe("Genie numeric source-date contract", () => {
  it("retains numeric source chronology without fabricating a missing date", () => {
    const t = Date.parse("2026-10-01T07:35:00Z");
    expect(genieSessionSourceDate(t)?.getTime()).toBe(t);
    expect(genieSessionSourceDate(String(t))?.getTime()).toBe(t);
    const activity = genieSessionActivity({
      id: "a", contactId: "c", assignedTo: "crm-user-1",
      lastMessageDate: t, updatedAt: t, type: "sms",
    });
    expect(activity?.occurredAt.getTime()).toBe(t);
    expect(activity?.sourceRevision).toBe(String(t));
    expect(genieSessionActivity({ id: "bad", lastMessageDate: "invalid" })).toBeUndefined();
  });
});

describe("Genie tokenless signed-in identity fallback", () => {
  it("accepts exactly one profile email and exactly one current-user ID", () => {
    expect(
      genieTokenlessProfileIdentity({
        menuText:
          "AD\nAmelia De Beer\namelia@course2career.com\nSignout",
        userIds: ["yZrFI0ptOyvG3ZXvs7iZ"],
      })
    ).toEqual({
      externalId: "yZrFI0ptOyvG3ZXvs7iZ",
      displayName: "Amelia De Beer",
      email: "amelia@course2career.com",
    });
  });

  it("fails closed for missing or ambiguous identity evidence", () => {
    expect(
      genieTokenlessProfileIdentity({
        menuText: "AD\nAmelia De Beer\nSignout",
        userIds: ["owner-1"],
      })
    ).toBeUndefined();
    expect(
      genieTokenlessProfileIdentity({
        menuText:
          "AD\nAmelia De Beer\namelia@course2career.com\nSignout",
        userIds: ["owner-1", "owner-2"],
      })
    ).toBeUndefined();
  });
});

describe("Genie authenticated session API adapter", () => {
  beforeEach(() => {
    taskBodies.splice(0);
    authenticatedPageCalls = 0;
  });

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

  it("rejects foreign owner rows even without a valid timestamp", async () => {
    await expect(genieSessionApiAdapter.syncActivities({ connection, secret }))
      .rejects.toThrow("CRM_OWNER_SCOPE_VIOLATION");
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
    expect(authenticatedPageCalls).toBe(1);
  });
});
