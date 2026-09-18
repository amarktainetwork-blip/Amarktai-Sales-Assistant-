import { describe, expect, it } from "vitest";
import { buildTodayCallQueue } from "./todayCallQueue";

const contacts = [
  {
    id: 1,
    connectedSystemId: 8,
    externalId: "a",
    firstName: "Alice",
    lastName: "Example",
    email: "alice@example.test",
    phone: "+441",
    lifecycleStage: "lead",
  },
  {
    id: 2,
    connectedSystemId: 8,
    externalId: "b",
    firstName: "Bob",
    lastName: null,
    email: "bob@example.test",
    phone: "+442",
    lifecycleStage: "lead",
  },
];

describe("Today call queue", () => {
  it("prioritises customer replies ahead of overdue backlog, then due-today work", () => {
    const queue = buildTodayCallQueue({
      contacts,
      overdueTasks: [
        {
          id: 11,
          connectedSystemId: 8,
          contactExternalId: "b",
          title: "Call back",
          dueAt: new Date("2026-09-15T10:00:00Z"),
        },
      ],
      inbound: [
        {
          id: 22,
          connectedSystemId: 8,
          contactExternalId: "a",
          receivedAt: new Date("2026-09-16T08:00:00Z"),
          subject: "Course question",
        },
      ],
      dueToday: [
        {
          id: 33,
          connectedSystemId: 8,
          contactExternalId: "a",
          title: "First Call",
          dueAt: new Date("2026-09-16T09:00:00Z"),
        },
      ],
    });
    expect(queue.map(item => item.name)).toEqual(["Alice Example", "Bob"]);
    expect(queue[0].primaryKind).toBe("inbound_reply");
    expect(queue[0].workCount).toBe(2);
    expect(queue[0].reasons).toEqual([
      "Customer reply needs action",
      "Task due today",
    ]);
    expect(queue[1].primaryKind).toBe("overdue_task");
  });

  it("puts a confirmed follow-up into the main queue ahead of overdue backlog", () => {
    const queue = buildTodayCallQueue({
      contacts,
      overdueTasks: [
        {
          id: 11,
          connectedSystemId: 8,
          contactExternalId: "b",
          title: "Old task",
          dueAt: new Date("2026-09-15T10:00:00Z"),
        },
      ],
      inbound: [],
      reminders: [
        {
          id: 77,
          contactExternalId: "a",
          title: "Discuss funding options",
          dueAt: new Date("2026-09-18T11:00:00Z"),
          source: "call_commitment",
        },
      ],
      dueToday: [],
    });
    expect(queue.map(item => item.name)).toEqual(["Alice Example", "Bob"]);
    expect(queue[0]).toMatchObject({
      primaryKind: "confirmed_follow_up",
      headline: "Discuss funding options",
      reasons: ["Confirmed follow-up is due"],
      reminderIds: [77],
    });
  });

  it("never queues work without an exact owned normalized contact", () => {
    const queue = buildTodayCallQueue({
      contacts,
      overdueTasks: [],
      inbound: [],
      dueToday: [
        {
          id: 44,
          connectedSystemId: 8,
          contactExternalId: "foreign",
          title: "First Call",
          dueAt: new Date(),
        },
      ],
    });
    expect(queue).toEqual([]);
  });
});

describe("Today new lead priority", () => {
  it("puts a possible-sale inbound reply ahead of an untouched new lead", () => {
    const queue = buildTodayCallQueue({
      contacts,
      newLeads: [
        {
          workItemId: 90,
          connectedSystemId: 8,
          contactExternalId: "a",
          createdAt: new Date("2026-09-18T17:00:00Z"),
        },
      ],
      inbound: [
        {
          id: 91,
          connectedSystemId: 8,
          contactExternalId: "b",
          receivedAt: new Date("2026-09-18T17:01:00Z"),
          subject: "Ready to proceed",
          classification: { category: "sale_intent" },
        },
      ],
      overdueTasks: [],
      dueToday: [],
    });
    expect(queue.map(item => item.name)).toEqual(["Bob", "Alice Example"]);
    expect(queue[0]).toMatchObject({
      primaryKind: "inbound_reply",
      reasons: ["Possible sale or payment step needs attention"],
    });
  });

  it("puts a genuine new lead ahead of overdue work and carries course context", () => {
    const queue = buildTodayCallQueue({
      contacts: [
        {
          ...contacts[0],
          courseInterest: "Cyber Security",
          tags: ["course — cyber security"],
        },
        contacts[1],
      ],
      newLeads: [
        {
          workItemId: 90,
          connectedSystemId: 8,
          contactExternalId: "a",
          createdAt: new Date("2026-09-17T09:00:00Z"),
        },
      ],
      overdueTasks: [
        {
          id: 11,
          connectedSystemId: 8,
          contactExternalId: "b",
          title: "Call back",
          dueAt: new Date("2026-09-15T10:00:00Z"),
        },
      ],
      inbound: [],
      dueToday: [],
    });
    expect(queue.map(item => item.name)).toEqual(["Alice Example", "Bob"]);
    expect(queue[0]).toMatchObject({
      primaryKind: "new_lead",
      courseInterest: "Cyber Security",
      workItemIds: [90],
    });
  });
});
