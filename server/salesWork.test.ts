import { describe, expect, it } from "vitest";
import { compareSalesWork, deriveCrmWorkCandidates } from "./salesWork";

describe("normalized sales work", () => {
  const now = new Date("2026-09-07T10:00:00.000Z");

  it("derives one stable new-lead work key so repeated sync upserts instead of duplicating", () => {
    const resource = {
      type: "contacts" as const,
      records: [
        {
          externalId: "lead-7",
          ownerExternalId: "owner-2",
          firstName: "Safe",
          raw: {},
        },
      ],
    };
    const first = deriveCrmWorkCandidates(9, resource, now);
    const repeated = deriveCrmWorkCandidates(9, resource, now);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "NEW_LEAD", priority: 80 });
    expect(repeated[0].sourceKey).toBe(first[0].sourceKey);
  });

  it("orders overdue work before future work without AI", () => {
    const items = [
      {
        sourceKey: "future",
        priority: 100,
        dueAt: new Date("2026-09-08T10:00:00.000Z"),
      },
      {
        sourceKey: "overdue",
        priority: 60,
        dueAt: new Date("2026-09-06T10:00:00.000Z"),
      },
    ];
    expect(items.sort((a, b) => compareSalesWork(a, b, now))[0].sourceKey).toBe(
      "overdue"
    );
  });

  it("turns callback and completed CRM tasks into authoritative work state", () => {
    const candidates = deriveCrmWorkCandidates(
      9,
      {
        type: "tasks",
        records: [
          {
            externalId: "task-1",
            title: "Customer callback",
            status: "open",
            dueAt: new Date("2026-09-07T12:00:00.000Z"),
            raw: {},
          },
          {
            externalId: "task-2",
            title: "Send proposal",
            status: "completed",
            raw: {},
          },
        ],
      },
      now
    );
    expect(candidates[0]).toMatchObject({
      type: "CALLBACK_DUE",
      status: "open",
    });
    expect(candidates[1]).toMatchObject({ status: "completed" });
  });
});
