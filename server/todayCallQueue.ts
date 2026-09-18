export type TodayQueueTask = {
  id: number;
  connectedSystemId: number;
  contactExternalId: string | null;
  title: string;
  dueAt: Date | null;
};

export type TodayQueueInbound = {
  id: number;
  connectedSystemId: number | null;
  contactExternalId: string | null;
  receivedAt: Date;
  subject?: string | null;
  classification?: { category?: string } | null;
};

export type TodayQueueReminder = {
  id: number;
  contactExternalId: string | null;
  title: string;
  dueAt: Date;
  source: string;
};

export type TodayQueueContact = {
  id: number;
  connectedSystemId: number;
  externalId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  courseInterest?: string | null;
  interestValues?: string[];
  tags?: string[];
};

export type TodayCallQueueItem = {
  key: string;
  contactId: number;
  connectedSystemId: number;
  contactExternalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  courseInterest: string | null;
  interestValues: string[];
  tags: string[];
  primaryKind:
    | "new_lead"
    | "inbound_reply"
    | "confirmed_follow_up"
    | "overdue_task"
    | "due_today";
  headline: string;
  dueAt: Date | null;
  receivedAt: Date | null;
  reasons: string[];
  taskIds: number[];
  inboundIds: number[];
  reminderIds: number[];
  workItemIds: number[];
  workCount: number;
};

const contactKey = (systemId: number, externalId: string) =>
  `${systemId}:${externalId}`;

function contactName(contact: TodayQueueContact) {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.email ||
    contact.phone ||
    `CRM contact ${contact.externalId}`
  );
}

export function buildTodayCallQueue(input: {
  newLeads?: Array<{
    workItemId: number;
    connectedSystemId: number;
    contactExternalId: string;
    createdAt: Date;
  }>;
  overdueTasks: TodayQueueTask[];
  dueToday: TodayQueueTask[];
  inbound: TodayQueueInbound[];
  reminders?: TodayQueueReminder[];
  contacts: TodayQueueContact[];
}) {
  const contacts = new Map(
    input.contacts.map(contact => [
      contactKey(contact.connectedSystemId, contact.externalId),
      contact,
    ])
  );

  type Candidate = {
    rank: number;
    occurredAt: number;
    contact: TodayQueueContact;
    kind: TodayCallQueueItem["primaryKind"];
    headline: string;
    dueAt: Date | null;
    receivedAt: Date | null;
    reason: string;
    taskId?: number;
    inboundId?: number;
    reminderId?: number;
    workItemId?: number;
  };

  const candidates: Candidate[] = [];
  const addTask = (
    task: TodayQueueTask,
    kind: "overdue_task" | "due_today",
    rank: number
  ) => {
    if (!task.contactExternalId) return;
    const contact = contacts.get(
      contactKey(task.connectedSystemId, task.contactExternalId)
    );
    if (!contact) return;
    candidates.push({
      rank,
      occurredAt: task.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER,
      contact,
      kind,
      headline: task.title,
      dueAt: task.dueAt,
      receivedAt: null,
      reason: kind === "overdue_task" ? "Overdue task" : "Task due today",
      taskId: task.id,
    });
  };

  for (const lead of input.newLeads || []) {
    const contact = contacts.get(
      contactKey(lead.connectedSystemId, lead.contactExternalId)
    );
    if (!contact) continue;
    candidates.push({
      rank: 2,
      occurredAt: lead.createdAt.valueOf(),
      contact,
      kind: "new_lead",
      headline: contact.courseInterest
        ? `New lead · ${contact.courseInterest}`
        : "New lead ready for first contact",
      dueAt: null,
      receivedAt: null,
      reason: "New lead needs first contact",
      workItemId: lead.workItemId,
    });
  }
  for (const message of input.inbound) {
    if (!message.contactExternalId || !message.connectedSystemId) continue;
    const contact = contacts.get(
      contactKey(message.connectedSystemId, message.contactExternalId)
    );
    if (!contact) continue;
    const saleIntent = message.classification?.category === "sale_intent";
    candidates.push({
      rank: saleIntent ? 0 : 1,
      occurredAt: message.receivedAt.valueOf(),
      contact,
      kind: "inbound_reply",
      headline: saleIntent
        ? message.subject?.trim() || "Customer is ready to move forward"
        : message.subject?.trim() || "Customer reply needs attention",
      dueAt: null,
      receivedAt: message.receivedAt,
      reason: saleIntent
        ? "Possible sale or payment step needs attention"
        : "Customer reply needs action",
      inboundId: message.id,
    });
  }
  for (const reminder of input.reminders || []) {
    if (!reminder.contactExternalId) continue;
    const matching = input.contacts.filter(
      contact => contact.externalId === reminder.contactExternalId
    );
    if (matching.length !== 1) continue;
    const contact = matching[0];
    candidates.push({
      rank: reminder.source === "call_commitment" ? 3 : 4,
      occurredAt: reminder.dueAt.valueOf(),
      contact,
      kind: "confirmed_follow_up",
      headline: reminder.title,
      dueAt: reminder.dueAt,
      receivedAt: null,
      reason:
        reminder.source === "call_commitment"
          ? "Confirmed follow-up is due"
          : "Reminder is due",
      reminderId: reminder.id,
    });
  }
  input.overdueTasks.forEach(task => addTask(task, "overdue_task", 4));
  input.dueToday.forEach(task => addTask(task, "due_today", 5));

  candidates.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.occurredAt - b.occurredAt ||
      a.contact.id - b.contact.id
  );

  const result = new Map<string, TodayCallQueueItem>();
  for (const candidate of candidates) {
    const key = contactKey(
      candidate.contact.connectedSystemId,
      candidate.contact.externalId
    );
    const existing = result.get(key);
    if (!existing) {
      result.set(key, {
        key,
        contactId: candidate.contact.id,
        connectedSystemId: candidate.contact.connectedSystemId,
        contactExternalId: candidate.contact.externalId,
        name: contactName(candidate.contact),
        email: candidate.contact.email,
        phone: candidate.contact.phone,
        lifecycleStage: candidate.contact.lifecycleStage,
        courseInterest: candidate.contact.courseInterest || null,
        interestValues: candidate.contact.interestValues || [],
        tags: candidate.contact.tags || [],
        primaryKind: candidate.kind,
        headline: candidate.headline,
        dueAt: candidate.dueAt,
        receivedAt: candidate.receivedAt,
        reasons: [candidate.reason],
        taskIds: candidate.taskId ? [candidate.taskId] : [],
        inboundIds: candidate.inboundId ? [candidate.inboundId] : [],
        reminderIds: candidate.reminderId ? [candidate.reminderId] : [],
        workItemIds: candidate.workItemId ? [candidate.workItemId] : [],
        workCount: 1,
      });
      continue;
    }
    if (!existing.reasons.includes(candidate.reason))
      existing.reasons.push(candidate.reason);
    if (candidate.taskId) existing.taskIds.push(candidate.taskId);
    if (candidate.inboundId) existing.inboundIds.push(candidate.inboundId);
    if (candidate.reminderId) existing.reminderIds.push(candidate.reminderId);
    if (candidate.workItemId) existing.workItemIds.push(candidate.workItemId);
    existing.workCount += 1;
  }
  return Array.from(result.values());
}
