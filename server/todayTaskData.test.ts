import { describe, expect, it, vi } from "vitest";
import { queryRecorder } from "./testSupport/queryRecorder";
const m = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("./db", () => ({ getDb: m.db }));
import { getTodayTaskData } from "./todayTaskData";
describe("Today aggregate contract", () => {
  it("counts the full incomplete set before bounded display queues using London day and exact owner", async () => {
    const r = queryRecorder(q => (q.selection?.total ? [{ total: 2401 }] : []));
    m.db.mockResolvedValue(r.db);
    const result = await getTodayTaskData({
      userId: 2,
      organisationId: 8,
      timezone: "Europe/London",
      now: new Date("2026-07-01T23:30:00Z"),
      priorityTitles: [],
    });
    expect(result.metrics.overdue).toBe(2401);
    expect(result.bounds.start.toISOString()).toBe("2026-07-01T23:00:00.000Z");
    for (const q of r.queries) {
      expect(q.where.sql).toContain("exists (select 1");
      expect(q.where.params).toContain(2);
      if (q.selection?.total) expect(q.limit).toBeUndefined();
      else expect(q.limit).toBeLessThanOrEqual(50);
    }
    const counts = r.queries.filter(q => q.selection?.total);
    expect(counts[0].where.params).toContain("open");
    expect(counts[0].where.params).not.toContain("completed");
    expect(counts[0].where.params).not.toContain("unknown");
    expect(result.metrics.historicalBacklog).toBe(0);
  });
  it("separates a configured backlog cutoff without changing source records", async () => {
    const r = queryRecorder(q => (q.selection?.total ? [{ total: 700 }] : []));
    m.db.mockResolvedValue(r.db);
    const result = await getTodayTaskData({
      userId: 2,
      organisationId: 8,
      timezone: "Europe/London",
      now: new Date("2026-09-16"),
      priorityTitles: ["Initial enquiry"],
      backlogPolicy: { mode: "since", actionableSince: "2026-01-01T00:00:00Z" },
    });
    expect(result.metrics.historicalBacklog).toBe(700);
    expect(result.backlogPolicy.mode).toBe("since");
    expect(
      r.queries.some(q =>
        q.where.params.some((v: unknown) => String(v).startsWith("2026-01-01"))
      )
    ).toBe(true);
  });
});

describe("MariaDB task queue ordering", () => {
  it.each([
    { priorityTitles: [] },
    { priorityTitles: ["First contact", "Follow up"] },
  ])(
    "uses valid ordering for priority titles %j",
    async ({ priorityTitles }) => {
      const r = queryRecorder(q => (q.selection?.total ? [{ total: 0 }] : []));
      m.db.mockResolvedValue(r.db);
      const result = await getTodayTaskData({
        userId: 2,
        organisationId: 8,
        timezone: "Europe/London",
        now: new Date("2026-10-25T12:00:00Z"),
        priorityTitles,
      });
      expect(result.bounds.start.toISOString()).toBe(
        "2026-10-24T23:00:00.000Z"
      );
      expect(result.bounds.endExclusive.toISOString()).toBe(
        "2026-10-26T00:00:00.000Z"
      );
      const queues = r.queries.filter(q => q.limit);
      expect(queues).toHaveLength(3);
      for (const [index, q] of queues.entries()) {
        const order = q.orderSql.map((v: any) => v.sql).join(", ");
        expect(order).not.toMatch(/(?:^|,)\s*0(?:\s*,|$)/);
        expect(order).toContain("`crmTasks`.`id` asc");
        if (index < 2) expect(order).toContain("`crmTasks`.`dueAt` asc");
        if (priorityTitles.length) {
          expect(order).toContain("case when lower(trim(");
          expect(q.orderSql[0].params).toEqual([
            "first contact",
            0,
            "follow up",
            1,
            2,
          ]);
        } else {
          expect(order).not.toContain("case");
          expect(q.orderSql).toHaveLength(index < 2 ? 2 : 1);
        }
      }
      expect(result.metrics).toMatchObject({
        overdue: 0,
        dueToday: 0,
        incomplete: 0,
      });
    }
  );
});
