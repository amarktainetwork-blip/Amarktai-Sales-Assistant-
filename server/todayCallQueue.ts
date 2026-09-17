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
  primaryKind: "overdue_task" | "inbound_reply" | "due_today";
  headline: string;
  dueAt: Date | null;
  receivedAt: Date | null;
  reasons: string[];
  taskIds: number[];
  inboundIds: number[];
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
  overdueTasks: TodayQueueTask[];
  dueToday: TodayQueueTask[];
  inbound: TodayQueueInbound[];
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

  input.overdueTasks.forEach(task => addTask(task, "overdue_task", 0));
  for (const message of input.inbound) {
    if (!message.contactExternalId || !message.connectedSystemId) continue;
    const contact = contacts.get(
      contactKey(message.connectedSystemId, message.contactExternalId)
    );
    if (!contact) continue;
    candidates.push({
      rank: 1,
      occurredAt: message.receivedAt.valueOf(),
      contact,
      kind: "inbound_reply",
      headline: message.subject?.trim() || "Customer reply needs attention",
      dueAt: null,
      receivedAt: message.receivedAt,
      reason: "Customer reply needs action",
      inboundId: message.id,
    });
  }
  input.dueToday.forEach(task => addTask(task, "due_today", 2));

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
        primaryKind: candidate.kind,
        headline: candidate.headline,
        dueAt: candidate.dueAt,
        receivedAt: candidate.receivedAt,
        reasons: [candidate.reason],
        taskIds: candidate.taskId ? [candidate.taskId] : [],
        inboundIds: candidate.inboundId ? [candidate.inboundId] : [],
        workCount: 1,
      });
      continue;
    }
    if (!existing.reasons.includes(candidate.reason))
      existing.reasons.push(candidate.reason);
    if (candidate.taskId) existing.taskIds.push(candidate.taskId);
    if (candidate.inboundId) existing.inboundIds.push(candidate.inboundId);
    existing.workCount += 1;
  }
  return Array.from(result.values());
}
