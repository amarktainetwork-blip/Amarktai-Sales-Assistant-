import { and, desc, eq, lte, or } from "drizzle-orm";
import { assistantMemories, assistantReminders } from "../drizzle/schema";
import { getDb } from "./db";
import { requireOrganisationMembership } from "./organisation";

export type ReminderSource = "manual" | "assistant" | "call_commitment" | "crm" | "inbound" | "automation" | "appointment";
export type MemoryProvenance = "user_asserted" | "crm" | "call" | "message" | "approved_ai_extraction";

function validTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date()); return timezone; }
  catch { throw new Error("A valid IANA timezone is required."); }
}

function localParts(date: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), weekday: values.weekday, hour: Number(values.hour), minute: Number(values.minute) };
}

function zonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = localParts(new Date(guess), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0);
    guess -= represented - Date.UTC(year, month - 1, day, hour, minute, 0);
  }
  return new Date(guess);
}

export function parseDeterministicReminder(command: string, now: Date, timezone: string) {
  const zone = validTimezone(timezone);
  const text = command.trim();
  if (!/^remind me\b/i.test(text)) return undefined;
  const current = localParts(now, zone);
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day));
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) date.setUTCDate(date.getUTCDate() + 1);
  else {
    const weekday = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (!weekday) throw new Error("Use 'tomorrow' or a weekday for deterministic reminders.");
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = names.indexOf(weekday[1]);
    const currentIndex = date.getUTCDay();
    let delta = (target - currentIndex + 7) % 7;
    if (delta === 0) delta = 7;
    date.setUTCDate(date.getUTCDate() + delta);
  }
  const time = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let hour = time ? Number(time[1]) : 9;
  const minute = time?.[2] ? Number(time[2]) : 0;
  if (time?.[3] === "pm" && hour < 12) hour += 12;
  if (time?.[3] === "am" && hour === 12) hour = 0;
  if (!time?.[3] && hour >= 1 && hour <= 7) hour += 12;
  if (hour > 23 || minute > 59) throw new Error("Reminder time is invalid.");
  const dueAt = zonedDateTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, zone);
  if (dueAt <= now) throw new Error("Reminder time must be in the future.");
  const title = text
    .replace(/^remind me\s+/i, "")
    .replace(/\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\s+/g, " ").trim().replace(/^to\s+/i, "");
  if (!title) throw new Error("Say what the reminder is for.");
  return { title: title.slice(0, 300), dueAt, timezone: zone };
}

export function parseRememberCommand(command: string) {
  const match = command.trim().match(/^remember that\s+(.+?)\s+(prefers?|likes?|needs?|uses?|is)\s+(.+)$/i);
  if (!match) return undefined;
  return { subject: match[1].trim().slice(0, 220), content: `${match[2]} ${match[3]}`.trim(), memoryType: "customer_fact" as const };
}

export function trustForProvenance(provenance: MemoryProvenance, requested?: "confirmed" | "user_asserted" | "inferred") {
  if (provenance === "approved_ai_extraction") return "inferred" as const;
  if (provenance === "user_asserted") return "user_asserted" as const;
  return requested === "confirmed" ? "confirmed" as const : "inferred" as const;
}

export function reminderScopeMatches(record: { userId: number; organisationId: number }, userId: number, organisationId: number) {
  return record.userId === userId && record.organisationId === organisationId;
}

export function reminderStateUpdate(status: "open" | "snoozed" | "completed" | "cancelled", currentDueAt: Date, snoozedUntil?: Date, now = new Date()) {
  if (status === "snoozed" && (!snoozedUntil || snoozedUntil <= now)) throw new Error("Snooze time must be in the future.");
  return { status, snoozedUntil: status === "snoozed" ? snoozedUntil! : null, dueAt: status === "snoozed" ? snoozedUntil! : currentDueAt, completedAt: status === "completed" ? now : null };
}

export async function createReminder(input: { userId: number; organisationId: number; title: string; dueAt: Date; timezone: string; source: ReminderSource; details?: string; contactExternalId?: string; opportunityExternalId?: string; sourceReference?: string }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const values = { organisationId: input.organisationId, userId: input.userId, title: input.title.trim().slice(0, 300), details: input.details?.trim().slice(0, 10_000), dueAt: input.dueAt, timezone: validTimezone(input.timezone), source: input.source, contactExternalId: input.contactExternalId?.slice(0, 160), opportunityExternalId: input.opportunityExternalId?.slice(0, 160), sourceReference: input.sourceReference?.slice(0, 220) };
  if (!values.title || Number.isNaN(input.dueAt.valueOf())) throw new Error("Reminder title and due time are required.");
  const result = await db.insert(assistantReminders).values(values).onDuplicateKeyUpdate({ set: { title: values.title, dueAt: values.dueAt, details: values.details, status: "open", completedAt: null } });
  return { id: Number(result[0].insertId), ...values, status: "open" as const };
}

export async function updateReminderStatus(input: { userId: number; organisationId: number; reminderId: number; status: "open" | "snoozed" | "completed" | "cancelled"; snoozedUntil?: Date }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const existing = (await db.select().from(assistantReminders).where(and(eq(assistantReminders.id, input.reminderId), eq(assistantReminders.organisationId, input.organisationId), eq(assistantReminders.userId, input.userId))).limit(1))[0];
  if (!existing) throw new Error("Reminder was not found for this user and organisation.");
  const update = reminderStateUpdate(input.status, existing.dueAt, input.snoozedUntil);
  await db.update(assistantReminders).set(update).where(eq(assistantReminders.id, existing.id));
  return { ...existing, ...update };
}

export async function createAssistantMemory(input: { userId: number; organisationId: number; memoryType: "user_preference" | "customer_fact" | "commitment" | "conversation_reference"; subject: string; content: string; provenance: MemoryProvenance; trust?: "confirmed" | "user_asserted" | "inferred"; contactExternalId?: string; opportunityExternalId?: string; sourceReference?: string; occurredAt?: Date }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const trust = trustForProvenance(input.provenance, input.trust);
  const values = { organisationId: input.organisationId, userId: input.userId, memoryType: input.memoryType, subject: input.subject.trim().slice(0, 220), content: input.content.trim().slice(0, 20_000), provenance: input.provenance, trust, contactExternalId: input.contactExternalId?.slice(0, 160), opportunityExternalId: input.opportunityExternalId?.slice(0, 160), sourceReference: input.sourceReference?.slice(0, 220), occurredAt: input.occurredAt };
  const result = await db.insert(assistantMemories).values(values).onDuplicateKeyUpdate({ set: { subject: values.subject, content: values.content, trust: values.trust, status: "active", occurredAt: values.occurredAt } });
  return { id: Number(result[0].insertId), trust };
}

export async function executeAssistantMemoryCommand(input: { userId: number; organisationId: number; command: string; timezone: string; now?: Date; contactExternalId?: string; opportunityExternalId?: string }) {
  const reminder = parseDeterministicReminder(input.command, input.now ?? new Date(), input.timezone);
  if (reminder) return { kind: "reminder" as const, record: await createReminder({ ...input, ...reminder, source: "assistant" }) };
  const memory = parseRememberCommand(input.command);
  if (memory) return { kind: "memory" as const, record: await createAssistantMemory({ ...input, ...memory, provenance: "user_asserted" }) };
  throw new Error("Use 'Remind me tomorrow/Friday...' or 'Remember that ...'. Ambiguous commands need clarification before anything is stored.");
}

export async function persistConfirmedCommitment(input: { userId: number; organisationId: number; title: string; dueAt: Date; timezone: string; source: "call_commitment" | "inbound"; sourceReference: string; contactExternalId?: string; opportunityExternalId?: string }) {
  const reminder = await createReminder(input);
  await createAssistantMemory({ ...input, memoryType: "commitment", subject: input.title, content: `${input.title} — due ${input.dueAt.toISOString()}`, provenance: input.source === "call_commitment" ? "call" : "message", trust: input.source === "call_commitment" ? "confirmed" : "inferred", occurredAt: new Date() });
  return reminder;
}

export async function listUserReminders(input: { userId: number; organisationId: number; includeHistory?: boolean; dueThrough?: Date }) {
  await requireOrganisationMembership(input.userId, input.organisationId);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const conditions = [eq(assistantReminders.organisationId, input.organisationId), eq(assistantReminders.userId, input.userId)];
  if (!input.includeHistory) conditions.push(or(eq(assistantReminders.status, "open"), eq(assistantReminders.status, "snoozed"))!);
  if (input.dueThrough) conditions.push(lte(assistantReminders.dueAt, input.dueThrough));
  return db.select().from(assistantReminders).where(and(...conditions)).orderBy(desc(assistantReminders.dueAt)).limit(200);
}
