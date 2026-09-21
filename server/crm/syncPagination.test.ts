import { describe, expect, it, vi } from "vitest";
import { drainCrmPages, rotatingHistoryWindow } from "./sync";

describe("CRM pagination drain", () => {
  it("drains 170 records across a 100 + 70 page sequence in one sync run", async () => {
    const pages = [
      { records: Array.from({ length: 100 }, (_, i) => i + 1), cursor: "100" },
      { records: Array.from({ length: 70 }, (_, i) => i + 101), cursor: undefined },
    ];
    const fetchPage = vi.fn(async (cursor?: string) =>
      cursor ? pages[1] : pages[0]
    );
    const seen: number[] = [];
    const result = await drainCrmPages({
      fetchPage,
      onPage: async records => void seen.push(...records),
    });
    expect(result).toEqual({ total: 170, pageCount: 2 });
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "100");
    expect(seen).toHaveLength(170);
    expect(new Set(seen).size).toBe(170);
  });

  it("fails closed when a provider cursor stalls", async () => {
    await expect(
      drainCrmPages({
        initialCursor: "100",
        fetchPage: async () => ({ records: [1], cursor: "100" }),
        onPage: async () => undefined,
      })
    ).rejects.toThrow("CRM_SYNC_CURSOR_STALLED");
  });

  it("fails closed instead of silently truncating when the page ceiling is reached", async () => {
    await expect(
      drainCrmPages({
        maxPages: 2,
        fetchPage: async cursor => ({
          records: [1],
          cursor: cursor === undefined ? "1" : "2",
        }),
        onPage: async () => undefined,
      })
    ).rejects.toThrow("CRM_SYNC_PAGE_LIMIT_REACHED");
  });
});

describe("CRM customer history rotation", () => {
  it("covers every active lead across successive watcher slots instead of starving older rows", () => {
    const leads = Array.from({ length: 31 }, (_, index) => index + 1);
    const first = rotatingHistoryWindow(
      leads,
      15,
      new Date("1970-01-01T00:00:00Z")
    );
    const second = rotatingHistoryWindow(
      leads,
      15,
      new Date("1970-01-01T00:01:00Z")
    );
    const third = rotatingHistoryWindow(
      leads,
      15,
      new Date("1970-01-01T00:02:00Z")
    );

    expect(first).toEqual(leads.slice(0, 15));
    expect(second).toEqual(leads.slice(15, 30));
    expect(third).toEqual(leads.slice(30));
    expect(new Set([...first, ...second, ...third])).toEqual(new Set(leads));
  });

  it("wraps cleanly after the final rotation window", () => {
    const leads = Array.from({ length: 31 }, (_, index) => index + 1);
    expect(
      rotatingHistoryWindow(leads, 15, new Date("1970-01-01T00:03:00Z"))
    ).toEqual(leads.slice(0, 15));
  });
});
