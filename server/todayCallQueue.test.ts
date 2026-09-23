import { describe, expect, it } from "vitest";
import { buildTodayCallQueue, unrepresentedTodayTasks } from "./todayCallQueue";

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
  it("prioritises customer replies ahead of due-soon and overdue work", () => {
    const queue = buildTodayCallQueue({
      now: new Date("2026-09-16T08:30:00Z"),
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
      "Scheduled task due within 30 minutes",
    ]);
    expect(queue[1].primaryKind).toBe("overdue_task");
  });

  it("keeps overdue work ahead of an ordinary later follow-up", () => {
    const queue = buildTodayCallQueue({
      now: new Date("2026-09-18T09:00:00Z"),
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
    expect(queue.map(item => item.name)).toEqual(["Bob", "Alice Example"]);
    expect(queue[0]).toMatchObject({
      primaryKind: "overdue_task",
      reasons: ["Overdue task"],
    });
    expect(queue[1]).toMatchObject({
      primaryKind: "confirmed_follow_up",
      headline: "Discuss funding options",
      reasons: ["Confirmed follow-up is due"],
      reminderIds: [77],
    });
  });

  it("keeps the intended urgency bands in a deterministic order", () => {
    const moreContacts = [
      ...contacts,
      {
        id: 3,
        connectedSystemId: 8,
        externalId: "c",
        firstName: "Cara",
        lastName: null,
        email: "cara@example.test",
        phone: "+443",
        lifecycleStage: "lead",
      },
      {
        id: 4,
        connectedSystemId: 8,
        externalId: "d",
        firstName: "Dan",
        lastName: null,
        email: "dan@example.test",
        phone: "+444",
        lifecycleStage: "lead",
      },
      {
        id: 5,
        connectedSystemId: 8,
        externalId: "e",
        firstName: "Erin",
        lastName: null,
        email: "erin@example.test",
        phone: "+445",
        lifecycleStage: "lead",
      },
    ];
    const queue = buildTodayCallQueue({
      now: new Date("2026-09-21T13:30:00Z"),
      contacts: moreContacts,
      inbound: [
        {
          id: 101,
          connectedSystemId: 8,
          contactExternalId: "a",
          receivedAt: new Date("2026-09-21T13:25:00Z"),
          subject: "Ready to enrol",
          classification: { category: "sale_intent" },
        },
      ],
      dueToday: [
        {
          id: 102,
          connectedSystemId: 8,
          contactExternalId: "b",
          title: "Scheduled call",
          dueAt: new Date("2026-09-21T13:50:00Z"),
        },
        {
          id: 103,
          connectedSystemId: 8,
          contactExternalId: "d",
          title: "Later task",
          dueAt: new Date("2026-09-21T14:30:00Z"),
        },
      ],
      overdueTasks: [
        {
          id: 104,
          connectedSystemId: 8,
          contactExternalId: "c",
          title: "Overdue callback",
          dueAt: new Date("2026-09-21T13:00:00Z"),
        },
      ],
      newLeads: [
        {
          workItemId: 105,
          connectedSystemId: 8,
          contactExternalId: "e",
          createdAt: new Date("2026-09-21T13:20:00Z"),
        },
      ],
    });

    expect(queue.map(item => item.name)).toEqual([
      "Erin",
      "Alice Example",
      "Cara",
      "Bob",
      "Dan",
    ]);
    expect(queue[0].primaryKind).toBe("new_lead");
    expect(queue[1].primaryKind).toBe("inbound_reply");
    expect(queue[2].reasons).toEqual(["Overdue task"]);
    expect(queue[3].reasons).toContain(
      "Scheduled task due within 30 minutes"
    );
    expect(queue[4].reasons).toEqual(["Task due today"]);
  });

  it("treats a task due now as urgent but does not relabel overdue work as due-soon", () => {
    const extra = [
      ...contacts,
      {
        id: 3,
        connectedSystemId: 8,
        externalId: "c",
        firstName: "Cara",
        lastName: null,
        email: "cara@example.test",
        phone: "+443",
        lifecycleStage: "lead",
      },
    ];
    const queue = buildTodayCallQueue({
      now: new Date("2026-09-21T13:30:00Z"),
      contacts: extra,
      inbound: [],
      dueToday: [
        {
          id: 201,
          connectedSystemId: 8,
          contactExternalId: "b",
          title: "Call now",
          dueAt: new Date("2026-09-21T13:30:00Z"),
        },
      ],
      overdueTasks: [
        {
          id: 202,
          connectedSystemId: 8,
          contactExternalId: "c",
          title: "Already late",
          dueAt: new Date("2026-09-21T13:29:00Z"),
        },
      ],
    });

    expect(queue.map(item => item.name)).toEqual(["Cara", "Bob"]);
    expect(queue[0].reasons).toEqual(["Overdue task"]);
    expect(queue[1].reasons).toEqual([
      "Scheduled task due within 30 minutes",
    ]);
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

  it("keeps assigned tasks visible to the safety lane when customer context is unavailable", () => {
    const task = {
      id: 44,
      connectedSystemId: 8,
      contactExternalId: "missing-contact",
      title: "First Call",
      dueAt: new Date("2026-09-21T09:00:00Z"),
    };
    const queue = buildTodayCallQueue({
      contacts,
      overdueTasks: [task],
      inbound: [],
      dueToday: [],
    });
    expect(queue).toEqual([]);
    expect(unrepresentedTodayTasks(queue, [task])).toEqual([task]);
  });

  it("does not duplicate tasks already represented in the person queue", () => {
    const task = {
      id: 45,
      connectedSystemId: 8,
      contactExternalId: "a",
      title: "First Call",
      dueAt: new Date("2026-09-21T09:00:00Z"),
    };
    const queue = buildTodayCallQueue({
      contacts,
      overdueTasks: [task],
      inbound: [],
      dueToday: [],
    });
    expect(queue[0]?.taskIds).toEqual([45]);
    expect(unrepresentedTodayTasks(queue, [task])).toEqual([]);
  });
});

describe("Today new lead priority", () => {
  it("puts an untouched new lead ahead of an inbound reply", () => {
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
    expect(queue.map(item => item.name)).toEqual(["Alice Example", "Bob"]);
    expect(queue[0]).toMatchObject({
      primaryKind: "new_lead",
      workItemIds: [90],
    });
    expect(queue[1]).toMatchObject({
      primaryKind: "inbound_reply",
      reasons: ["Possible sale or payment step needs attention"],
    });
  });

  it("keeps a genuine new lead ahead of overdue work while carrying course context", () => {
    const queue = buildTodayCallQueue({
      now: new Date("2026-09-17T10:00:00Z"),
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
    expect(queue[1]).toMatchObject({
      primaryKind: "overdue_task",
      reasons: ["Overdue task"],
    });
  });
});
