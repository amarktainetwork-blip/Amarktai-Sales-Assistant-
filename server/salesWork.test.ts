import { describe, expect, it } from "vitest";
import {
  canUserOperateSalesWorkItem,
  compareSalesWork,
  deriveCrmWorkCandidates,
  isSalesWorkTransitionReplay,
  nextSalesWorkStatus,
  selectCallbackWorkForVerifiedCall,
} from "./salesWork";

describe("normalized sales work", () => {
  const now = new Date("2026-09-07T10:00:00.000Z");

  const contactResource = (
    externalId: string,
    raw: Record<string, unknown> = {}
  ) => ({
    type: "contacts" as const,
    records: [
      {
        externalId,
        ownerExternalId: "owner-2",
        firstName: "Safe",
        raw,
      },
    ],
  });

  it("creates no NEW_LEAD work for an initial historical baseline", () => {
    const records = Array.from({ length: 500 }, (_, index) => ({
      externalId: `historical-${index}`,
      raw: {},
    }));
    expect(
      deriveCrmWorkCandidates(9, { type: "contacts", records }, now, {
        baselineComplete: false,
        existingExternalIds: new Set(),
      })
    ).toHaveLength(0);
  });

  it("creates exactly one stable NEW_LEAD after baseline and never for updates", () => {
    const first = deriveCrmWorkCandidates(9, contactResource("lead-7"), now, {
      baselineComplete: true,
      existingExternalIds: new Set(),
    });
    const repeated = deriveCrmWorkCandidates(
      9,
      contactResource("lead-7"),
      now,
      {
        baselineComplete: true,
        existingExternalIds: new Set(["lead-7"]),
      }
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "NEW_LEAD", priority: 80 });
    expect(repeated).toHaveLength(0);
    expect(
      deriveCrmWorkCandidates(
        9,
        contactResource("lead-7", { changedField: "phone" }),
        now,
        {
          baselineComplete: true,
          existingExternalIds: new Set(["lead-7"]),
        }
      )
    ).toHaveLength(0);
  });

  it("accepts an explicit provider new-contact event after baseline", () => {
    expect(
      deriveCrmWorkCandidates(
        9,
        contactResource("lead-8", { eventType: "contact.created" }),
        now,
        {
          baselineComplete: true,
          existingExternalIds: new Set(["lead-8"]),
        }
      )
    ).toHaveLength(1);
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

  it("supports the operational work lifecycle and idempotent completion", () => {
    expect(nextSalesWorkStatus("open", "start")).toBe("in_progress");
    expect(nextSalesWorkStatus("in_progress", "snooze")).toBe("snoozed");
    expect(nextSalesWorkStatus("snoozed", "reschedule")).toBe("open");
    expect(nextSalesWorkStatus("open", "block")).toBe("blocked");
    expect(nextSalesWorkStatus("in_progress", "complete")).toBe("completed");
    expect(nextSalesWorkStatus("completed", "complete")).toBe("completed");
    expect(() => nextSalesWorkStatus("completed", "start")).toThrow(
      "WORK_ITEM_TRANSITION_INVALID"
    );
  });

  it("enforces work ownership while allowing managers to operate team work", () => {
    expect(canUserOperateSalesWorkItem("salesperson", 7, 7)).toBe(true);
    expect(canUserOperateSalesWorkItem("salesperson", 7, 8)).toBe(false);
    expect(canUserOperateSalesWorkItem("manager", 7, 8)).toBe(true);
    expect(canUserOperateSalesWorkItem("auditor", 7, 7)).toBe(false);
  });

  it("recognizes the persisted transition key after a process restart", () => {
    const persisted = { lastTransitionKey: "start:work-42:v1" };
    expect(
      isSalesWorkTransitionReplay(
        persisted.lastTransitionKey,
        "start:work-42:v1"
      )
    ).toBe(true);
    expect(
      isSalesWorkTransitionReplay(
        persisted.lastTransitionKey,
        "complete:work-42:v2"
      )
    ).toBe(false);
  });

  it("resolves only the exact callback target and never every callback for a contact", () => {
    const rows = [
      {
        sourceKey: "task-1",
        status: "open",
        taskExternalId: "task-1",
        opportunityExternalId: null,
        contactExternalId: "contact-1",
        dueAt: new Date("2026-09-06T10:00:00.000Z"),
        priority: 90,
      },
      {
        sourceKey: "task-2",
        status: "open",
        taskExternalId: "task-2",
        opportunityExternalId: null,
        contactExternalId: "contact-1",
        dueAt: new Date("2026-09-07T10:00:00.000Z"),
        priority: 90,
      },
    ];
    expect(
      selectCallbackWorkForVerifiedCall(rows, {
        contactExternalId: "contact-1",
        taskExternalId: "task-2",
      })?.sourceKey
    ).toBe("task-2");
    expect(
      selectCallbackWorkForVerifiedCall(rows, {
        contactExternalId: "contact-1",
      })?.sourceKey
    ).toBe("task-1");
  });
});
