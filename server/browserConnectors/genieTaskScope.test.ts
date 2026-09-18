import { describe, it, expect, vi } from "vitest";
import {
  assertExactGenieTaskOwners,
  genieTaskSearchBody,
  readOwnerScopedGenieTasks,
} from "./genieTaskScope";
import { normalizeGenieTaskGridPage } from "./browserCrmAdapter";
const owner = "yZrFI0ptOyvG3ZXvs7iZ";
function harness(
  payloads: unknown[],
  statuses: number[] = [],
  tokens: string[] = []
) {
  const post = vi.fn().mockImplementation(async () => {
    const payload = payloads.shift();
    const status = statuses.shift() || 201;
    return {
      status: () => status,
      ok: () => status < 300,
      json: async () => payload,
    };
  });
  const evaluate = vi.fn().mockImplementation(async () => {
    if (tokens.length) return tokens.shift();
    return "private-session-token";
  });
  const page = {
    url: () =>
      "https://genie.entrepreneurscircle.org/v2/location/location-1/tasks?alreadyFiltered=true",
    context: () => ({ request: { post } }),
    evaluate,
  } as any;
  return {
    page,
    post,
    evaluate,
    read: () =>
      readOwnerScopedGenieTasks({
        page,
        ownerExternalId: owner,
        assertControl: vi.fn(),
        normalize: normalizeGenieTaskGridPage,
      }),
  };
}
const row = (id: string, owners: unknown = [owner]) => ({
  id,
  owners,
  properties: { title: "First Call", completed: 0 },
  searchAfter: [1, id],
});
describe("authenticated browser Tasks source", () => {
  it("builds the exact owner and incomplete-task filters", () =>
    expect(genieTaskSearchBody("location-1", owner, 1).filters).toEqual([
      {
        group: "AND",
        filters: [
          { field: "owners", operator: "eq", value: [owner] },
          { field: "properties.completed", operator: "eq", value: [0] },
        ],
      },
    ]));
  it.each([undefined, [], [owner, "other"], ["other"]])(
    "rejects missing, ambiguous and foreign immutable ownership: %j",
    owners =>
      expect(() =>
        assertExactGenieTaskOwners(
          { customObjectRecords: [{ ...row("1"), owners }], total: 1 },
          owner
        )
      ).toThrow(/CRM_OWNER_SCOPE/)
  );
  it("accepts proven zero without depending on grid selection events", async () => {
    const h = harness([{ customObjectRecords: [], total: 0 }]);
    const result = await h.read();
    expect(result.data.sourceTotal).toBe("0");
    expect(result.data.records).toBe("[]");
    expect(h.post).toHaveBeenCalledTimes(1);
  });
  it("rejects an unexplained empty collection", () =>
    expect(() =>
      assertExactGenieTaskOwners({ customObjectRecords: [], total: 1 }, owner)
    ).toThrow("INCOMPLETE"));
  it("drains with advancing source cursor despite an already active filter", async () => {
    const first = Array.from({ length: 100 }, (_, i) => row(String(i)));
    const h = harness([
      { customObjectRecords: first, total: 101 },
      { customObjectRecords: [row("100")], total: 101 },
    ]);
    const result = await h.read();
    expect(JSON.parse(result.data.records)).toHaveLength(101);
    expect(h.post.mock.calls[1][1].data.searchAfter).toEqual([1, "99"]);
    expect(h.post.mock.calls[1][1].data.filters).toEqual(
      genieTaskSearchBody("location-1", owner, 2).filters
    );
  });
  it("rejects stalled pages and truncated totals", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(String(i)));
    await expect(
      harness([
        { customObjectRecords: rows, total: 201 },
        { customObjectRecords: rows, total: 201 },
      ]).read()
    ).rejects.toThrow("INCOMPLETE");
  });
  it("retries bounded token-id rotation without widening task scope", async () => {
    const h = harness(
      [{}, {}, { customObjectRecords: [], total: 0 }],
      [401, 401, 201],
      ["token-old", "token-old", "token-new"]
    );
    const result = await h.read();
    expect(result.data.records).toBe("[]");
    expect(h.post).toHaveBeenCalledTimes(3);
    expect(h.post.mock.calls[0][1].headers["token-id"]).toBe("token-old");
    expect(h.post.mock.calls[1][1].headers["token-id"]).toBe("token-old");
    expect(h.post.mock.calls[2][1].headers["token-id"]).toBe("token-new");
    expect(h.post.mock.calls[2][1].data.filters).toEqual(
      genieTaskSearchBody("location-1", owner, 1).filters
    );
  });

  it("fails closed after bounded refreshed task authentication is still rejected", async () => {
    const h = harness([{}, {}, {}, {}], [401, 401, 401, 401]);
    await expect(h.read()).rejects.toThrow("HTTP 401");
    expect(h.post).toHaveBeenCalledTimes(4);
    expect(h.evaluate).toHaveBeenCalledTimes(4);
  });
  it("rejects completed records even if the provider ignores the incomplete filter", async () =>
    await expect(
      harness([
        {
          customObjectRecords: [
            { ...row("done"), properties: { title: "Old task", completed: 1 } },
          ],
          total: 1,
        },
      ]).read()
    ).rejects.toThrow("TASK_SCOPE_VIOLATION"));

  it("does not accept foreign records even from an exact-filter request", async () =>
    await expect(
      harness([{ customObjectRecords: [row("x", ["other"])], total: 1 }]).read()
    ).rejects.toThrow("VIOLATION"));
});
