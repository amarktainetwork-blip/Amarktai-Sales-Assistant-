import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeGenieOpportunities,
  readOwnerScopedGenieOpportunities,
} from "./genieOpportunityScope";
const row = (id: string) => ({
  id,
  assignedTo: "owner",
  locationId: "loc",
  contactId: "contact",
  name: "Enquiry",
  pipelineId: "p",
  pipelineStageId: "s",
  monetaryValue: 25,
  status: "lost",
});
const pipelines = [
  {
    id: "p",
    locationId: "loc",
    name: "Pipeline",
    stages: [{ id: "s", name: "Closed" }],
  },
];
describe("Genie opportunity read", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads the browser's existing retained authenticated state when the SPA getter is unavailable", async () => {
    vi.stubGlobal("window", { getToken: async () => "" });
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === "refreshedToken" ? "saved-session" : null });
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const get = vi.fn(async (url: string) => ({
      status: () => 200, ok: () => true,
      json: async () => url.includes("pipelines")
        ? { pipelines }
        : { opportunities: [row("1")], meta: { total: 1 } },
    }));
    const result = await readOwnerScopedGenieOpportunities({
      page: {
        url: () => "https://example.test/v2/location/loc/opportunities",
        evaluate: async (read: () => Promise<string>) => read(),
        context: () => ({ request: { get } }),
      } as any,
      ownerExternalId: "owner", assertControl: () => {}, maxPages: 1,
    });
    expect(result.data.snapshotComplete).toBe("true");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain("assigned_to=owner");
  });
  it("retries only the same owner-scoped GET across independent token rotations", async () => {
    const tokens = ["initial", "pipeline-current", "search-current"];
    let tokenReads = 0;
    const get = vi.fn(async (url: string, options: any) => {
      const supplied = options.headers["token-id"];
      const status = url.includes("pipelines")
        ? supplied === "initial" ? 401 : 200
        : supplied === "pipeline-current" ? 403 : 200;
      return {
        status: () => status, ok: () => status === 200,
        json: async () => url.includes("pipelines")
          ? { pipelines }
          : { opportunities: [row("1")], meta: { total: 1 } },
      };
    });
    const result = await readOwnerScopedGenieOpportunities({
      page: {
        url: () => "https://example.test/v2/location/loc/opportunities",
        evaluate: async () => tokens[Math.min(tokenReads++, 2)],
        context: () => ({ request: { get } }),
      } as any,
      ownerExternalId: "owner", assertControl: () => {}, maxPages: 1,
    });
    expect(result.data.snapshotComplete).toBe("true");
    expect(get.mock.calls.map(([, option]) => option.headers["token-id"])).toEqual(
      ["initial", "pipeline-current", "pipeline-current", "search-current"]
    );
    const ownerReads = get.mock.calls.filter(([url]) => url.includes("/opportunities/search?"));
    expect(ownerReads).toHaveLength(2);
    expect(ownerReads.every(([url]) => new URL(url).searchParams.get("assigned_to") === "owner")).toBe(true);
  });
  it("does not certify an unauthorised source response after bounded retries", async () => {
    const get = vi.fn(async () => ({
      status: () => 403, ok: () => false,
      json: async () => ({ message: "sign in required" }),
    }));
    await expect(readOwnerScopedGenieOpportunities({
      page: {
        url: () => "https://example.test/v2/location/loc/opportunities",
        evaluate: async () => "previous-browser-session",
        context: () => ({ request: { get } }),
      } as any,
      ownerExternalId: "owner", assertControl: () => {}, maxPages: 1,
    })).rejects.toThrow("CRM_BROWSER_REAUTHENTICATION_REQUIRED");
    expect(get).toHaveBeenCalledTimes(3);
  });
  it("normalizes only proven identifiers, relations and lifecycle", () => {
    expect(
      normalizeGenieOpportunities(
        { opportunities: [row("1")] },
        "owner",
        "loc",
        pipelines
      )[0]
    ).toMatchObject({
      externalId: "1",
      contactExternalId: "contact",
      ownerExternalId: "owner",
      stage: "Closed",
      status: "lost",
      value: "25",
    });
  });
  it("uses the authoritative Won status-change time as the sale time", () => {
    const normalized = normalizeGenieOpportunities(
      {
        opportunities: [
          {
            ...row("won-1"),
            status: "won",
            lastStatusChangeAt: "2026-09-24T10:15:00.000Z",
            updatedAt: "2026-09-25T11:30:00.000Z",
          },
        ],
      },
      "owner",
      "loc",
      pipelines
    )[0];
    expect(normalized.closeAt).toBe("2026-09-24T10:15:00.000Z");
    expect(normalized.lastStatusChangeAt).toBe("2026-09-24T10:15:00.000Z");
  });

  it.each([
    { assignedTo: "foreign" },
    { assignedTo: null },
    { locationId: "foreign" },
  ])("rejects ambiguous or foreign scope %s", change => {
    expect(() =>
      normalizeGenieOpportunities(
        { opportunities: [{ ...row("1"), ...change }] },
        "owner",
        "loc",
        pipelines
      )
    ).toThrow("CRM_OWNER_SCOPE_VIOLATION");
  });
  it("fully drains with exclusive cursor pagination and GET only", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("pipelines")
          ? { pipelines }
          : url.includes("startAfter=")
            ? { opportunities: [row("101")], meta: { total: 101 } }
            : {
                opportunities: Array.from({ length: 100 }, (_, i) =>
                  row(String(i))
                ),
                meta: { total: 101, startAfter: 123, startAfterId: "99" },
              },
    }));
    const control = vi.fn();
    const r = await readOwnerScopedGenieOpportunities({
      page: {
        url: () => "https://example.test/v2/location/loc/contacts",
        evaluate: async () => "token",
        context: () => ({ request: { get } }),
      } as any,
      ownerExternalId: "owner",
      assertControl: control,
    });
    expect(r.data.sourceTotal).toBe("101");
    expect(r.data.pagesRead).toBe("2");
    const url = new URL(get.mock.calls[2][0]);
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("assigned_to")).toBe("owner");
    // Verify the browser-control lease before and after each authenticated GET.
    expect(control).toHaveBeenCalledTimes(6);
  });
  it("resumes bounded exact-owner batches without asserting premature snapshot completion", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("pipelines")
          ? { pipelines }
          : url.includes("startAfter=")
            ? { opportunities: [row("101")], meta: { total: 101 } }
            : {
                opportunities: Array.from({ length: 100 }, (_, i) =>
                  row(String(i))
                ),
                meta: { total: 101, startAfter: 123, startAfterId: "99" },
              },
    }));
    const page = {
      url: () => "https://example.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get } }),
    } as any;
    const first = await readOwnerScopedGenieOpportunities({
      page,
      ownerExternalId: "owner",
      assertControl: () => {},
      maxPages: 1,
    });
    expect(first.data.snapshotComplete).toBe("false");
    expect(JSON.parse(first.data.records)).toHaveLength(100);
    expect(first.data.nextCursor).toBeTruthy();
    const second = await readOwnerScopedGenieOpportunities({
      page,
      ownerExternalId: "owner",
      assertControl: () => {},
      maxPages: 1,
      continuation: first.data.nextCursor,
    });
    expect(second.data.snapshotComplete).toBe("true");
    expect(JSON.parse(second.data.records)).toHaveLength(1);
    expect(second.data.nextCursor).toBeUndefined();
    const after = new URL(get.mock.calls.at(-1)![0]);
    expect(after.searchParams.get("assigned_to")).toBe("owner");
    expect(after.searchParams.get("startAfterId")).toBe("99");
  });
  it("drains ten owner-only pages per bounded read without prematurely certifying source completion", async () => {
    const get = vi.fn(async (url: string) => {
      const pipeline = url.includes("/opportunities/pipelines?");
      const parameters = new URL(url).searchParams;
      const offset = parameters.has("startAfterId")
        ? Number(parameters.get("startAfterId")) + 1
        : 0;
      const count = Math.min(100, 1001 - offset);
      const records = Array.from({ length: count }, (_, i) => row(String(offset + i)));
      return {
        ok: () => true,
        status: () => 200,
        json: async () => pipeline
          ? { pipelines }
          : {
              opportunities: records,
              meta: {
                total: 1001,
                startAfter: offset + count - 1,
                startAfterId: String(offset + count - 1),
              },
            },
      };
    });
    const page = {
      url: () => "https://example.test/v2/location/loc/opportunities",
      evaluate: async () => "existing-browser-token",
      context: () => ({ request: { get } }),
    } as any;
    const first = await readOwnerScopedGenieOpportunities({
      page,
      ownerExternalId: "owner",
      assertControl: () => {},
      maxPages: 10,
    });
    expect(first.data.snapshotComplete).toBe("false");
    expect(first.data.pagesRead).toBe("10");
    expect(JSON.parse(first.data.records)).toHaveLength(1000);
    const checkpoint = JSON.parse(first.data.nextCursor!);
    expect(checkpoint.seen).toBe(1000);
    expect(checkpoint.sourceTotal).toBe(1001);
    const second = await readOwnerScopedGenieOpportunities({
      page,
      ownerExternalId: "owner",
      assertControl: () => {},
      maxPages: 10,
      continuation: first.data.nextCursor,
    });
    expect(second.data.snapshotComplete).toBe("true");
    expect(JSON.parse(second.data.records)).toHaveLength(1);
    expect(second.data.nextCursor).toBeUndefined();
    const sourceReads = get.mock.calls
      .map(([url]) => url)
      .filter(url => url.includes("/opportunities/search?"));
    expect(sourceReads).toHaveLength(11);
    expect(sourceReads.every(url => new URL(url).searchParams.get("assigned_to") === "owner")).toBe(true);
    expect(sourceReads.every(url => new URL(url).searchParams.get("location_id") === "loc")).toBe(true);
  });

  it("rejects an invalid or changed bounded continuation", async () => {
    const bad = '{"version":1,"after":[1,"99"],"seen":100,"sourceTotal":99}';
    await expect(
      readOwnerScopedGenieOpportunities({
        page: {
          url: () => "https://example.test/v2/location/loc/contacts",
        } as any,
        ownerExternalId: "owner",
        assertControl: () => {},
        continuation: bad,
        maxPages: 1,
      })
    ).rejects.toThrow();
  });

  it("fails an incomplete source count instead of publishing a partial set", async () => {
    const get = vi.fn(async (url: string) => ({
      ok: () => true,
      status: () => 200,
      json: async () =>
        url.includes("pipelines")
          ? { pipelines }
          : { opportunities: [row("1")], meta: { total: 500 } },
    }));
    await expect(
      readOwnerScopedGenieOpportunities({
        page: {
          url: () => "https://example.test/v2/location/loc/contacts",
          evaluate: async () => "token",
          context: () => ({ request: { get } }),
        } as any,
        ownerExternalId: "owner",
        assertControl: () => {},
      })
    ).rejects.toThrow("DRAIN_INCOMPLETE");
  });
});
