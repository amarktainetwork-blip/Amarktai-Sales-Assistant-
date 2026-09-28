import { contactPreferenceEligibility } from "./contactPreference";
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
  contactPreference?: string | null;
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
  contactPreference: string | null;
  contactPreferenceLabel: string | null;
  contactEligibleNow: boolean;
  contactPreferenceState: "none" | "in_window" | "later_today" | "window_passed";
  primaryKind:
    | "new_lead"
    | "inbound_reply"
    | "confirmed_follow_up"
    | "overdue_task"
    | "due_today";
  headline: string;
  dueAt: Date | null;
  attentionDueAt: Date | null;
  attentionHeadline: string | null;
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
  now?: Date;
  timezone?: string;
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
  const now = input.now ?? new Date();
  const timezone = input.timezone || "UTC";
  const dueSoonCutoff = new Date(now.valueOf() + 30 * 60_000);
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
    deferForContactPreference: boolean;
    preferenceLabel: string | null;
    preferenceState: "none" | "in_window" | "later_today" | "window_passed";
    preferenceSortMinute: number;
  };

  const candidates: Candidate[] = [];
  const preferenceFor = (contact: TodayQueueContact) =>
    contactPreferenceEligibility({
      preference: contact.contactPreference,
      now,
      timezone,
    });
  const addTask = (
    task: TodayQueueTask,
    kind: "overdue_task" | "due_today",
    defaultRank: number
  ) => {
    if (!task.contactExternalId) return;
    const contact = contacts.get(
      contactKey(task.connectedSystemId, task.contactExternalId)
    );
    if (!contact) return;
    const timeCritical = Boolean(
      task.dueAt && task.dueAt >= now && task.dueAt <= dueSoonCutoff
    );
    const overdue = Boolean(task.dueAt && task.dueAt < now);
    const preference = preferenceFor(contact);
    const deferForContactPreference =
      !timeCritical &&
      !overdue &&
      preference.preference !== null &&
      !preference.eligibleNow;
    candidates.push({
      rank: overdue ? 2 : timeCritical ? 3 : defaultRank,
      occurredAt: task.dueAt?.valueOf() ?? Number.MAX_SAFE_INTEGER,
      contact,
      kind,
      headline: task.title,
      dueAt: task.dueAt,
      receivedAt: null,
      reason:
        kind === "overdue_task"
          ? "Overdue task"
          : timeCritical
            ? "Scheduled task due within 30 minutes"
            : "Task due today",
      taskId: task.id,
      deferForContactPreference,
      preferenceLabel: preference.preference?.label || null,
      preferenceState: preference.state,
      preferenceSortMinute: preference.sortMinute,
    });
  };

  for (const lead of input.newLeads || []) {
    const contact = contacts.get(
      contactKey(lead.connectedSystemId, lead.contactExternalId)
    );
    if (!contact) continue;
    const preference = preferenceFor(contact);
    candidates.push({
      rank: 0,
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
      deferForContactPreference:
        preference.preference !== null && !preference.eligibleNow,
      preferenceLabel: preference.preference?.label || null,
      preferenceState: preference.state,
      preferenceSortMinute: preference.sortMinute,
    });
  }
  for (const message of input.inbound) {
    if (!message.contactExternalId || !message.connectedSystemId) continue;
    const contact = contacts.get(
      contactKey(message.connectedSystemId, message.contactExternalId)
    );
    if (!contact) continue;
    const saleIntent = message.classification?.category === "sale_intent";
    const preference = preferenceFor(contact);
    candidates.push({
      rank: 1,
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
      deferForContactPreference: false,
      preferenceLabel: preference.preference?.label || null,
      preferenceState: preference.state,
      preferenceSortMinute: preference.sortMinute,
    });
  }
  for (const reminder of input.reminders || []) {
    if (!reminder.contactExternalId) continue;
    const matching = input.contacts.filter(
      contact => contact.externalId === reminder.contactExternalId
    );
    if (matching.length !== 1) continue;
    const contact = matching[0];
    const timeCritical =
      reminder.dueAt >= now && reminder.dueAt <= dueSoonCutoff;
    const overdue = reminder.dueAt < now;
    const preference = preferenceFor(contact);
    candidates.push({
      rank: overdue ? 2 : timeCritical ? 3 : 4,
      occurredAt: reminder.dueAt.valueOf(),
      contact,
      kind: "confirmed_follow_up",
      headline: reminder.title,
      dueAt: reminder.dueAt,
      receivedAt: null,
      reason: timeCritical
        ? "Scheduled follow-up due within 30 minutes"
        : overdue
          ? "Confirmed follow-up is overdue"
          : reminder.source === "call_commitment"
            ? "Confirmed follow-up is due"
            : "Reminder is due",
      reminderId: reminder.id,
      deferForContactPreference: false,
      preferenceLabel: preference.preference?.label || null,
      preferenceState: preference.state,
      preferenceSortMinute: preference.sortMinute,
    });
  }
  input.overdueTasks.forEach(task => addTask(task, "overdue_task", 3));
  input.dueToday.forEach(task => addTask(task, "due_today", 4));

  candidates.sort(
    (a, b) =>
      Number(a.deferForContactPreference) -
        Number(b.deferForContactPreference) ||
      (a.deferForContactPreference && b.deferForContactPreference
        ? a.preferenceSortMinute - b.preferenceSortMinute
        : 0) ||
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
        contactPreference: candidate.contact.contactPreference || null,
        contactPreferenceLabel: candidate.preferenceLabel,
        contactEligibleNow: !candidate.deferForContactPreference,
        contactPreferenceState: candidate.preferenceState,
        primaryKind: candidate.kind,
        headline: candidate.headline,
        dueAt: candidate.dueAt,
        attentionDueAt:
          candidate.dueAt && candidate.dueAt.valueOf() >= now.valueOf() - 60_000
            ? candidate.dueAt
            : null,
        attentionHeadline:
          candidate.dueAt && candidate.dueAt.valueOf() >= now.valueOf() - 60_000
            ? candidate.headline
            : null,
        receivedAt: candidate.receivedAt,
        reasons: [
          candidate.reason,
          ...(candidate.deferForContactPreference && candidate.preferenceLabel
            ? [`Preferred contact time: ${candidate.preferenceLabel}`]
            : []),
        ],
        taskIds: candidate.taskId ? [candidate.taskId] : [],
        inboundIds: candidate.inboundId ? [candidate.inboundId] : [],
        reminderIds: candidate.reminderId ? [candidate.reminderId] : [],
        workItemIds: candidate.workItemId ? [candidate.workItemId] : [],
        workCount: 1,
      });
      continue;
    }
    if (!candidate.deferForContactPreference)
      existing.contactEligibleNow = true;
    if (!existing.reasons.includes(candidate.reason))
      existing.reasons.push(candidate.reason);
    if (
      candidate.deferForContactPreference &&
      candidate.preferenceLabel &&
      !existing.reasons.includes(
        `Preferred contact time: ${candidate.preferenceLabel}`
      )
    )
      existing.reasons.push(
        `Preferred contact time: ${candidate.preferenceLabel}`
      );
    if (candidate.taskId) existing.taskIds.push(candidate.taskId);
    if (candidate.inboundId) existing.inboundIds.push(candidate.inboundId);
    if (candidate.reminderId) existing.reminderIds.push(candidate.reminderId);
    if (candidate.workItemId) existing.workItemIds.push(candidate.workItemId);
    if (
      candidate.dueAt &&
      candidate.dueAt.valueOf() >= now.valueOf() - 60_000 &&
      (!existing.attentionDueAt ||
        candidate.dueAt.valueOf() < existing.attentionDueAt.valueOf())
    ) {
      existing.attentionDueAt = candidate.dueAt;
      existing.attentionHeadline = candidate.headline;
    }
    existing.workCount += 1;
  }
  return Array.from(result.values());
}

export function unrepresentedTodayTasks(
  queue: Array<Pick<TodayCallQueueItem, "taskIds">>,
  tasks: TodayQueueTask[]
) {
  const represented = new Set(queue.flatMap(item => item.taskIds));
  return tasks.filter(task => !represented.has(task.id));
}
