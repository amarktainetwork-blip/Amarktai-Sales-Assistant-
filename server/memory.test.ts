import { describe, expect, it } from "vitest";
import { assistantMemories, assistantReminders } from "../drizzle/schema";
import { parseDeterministicReminder, parseRememberCommand, reminderScopeMatches, reminderStateUpdate, trustForProvenance } from "./memory";

describe("durable reminders and structured memory", () => {
  it("parses a timezone-aware reminder deterministically without AI", () => {
    const parsed = parseDeterministicReminder("Remind me tomorrow at 2 to call John", new Date("2026-08-23T10:00:00.000Z"), "Africa/Johannesburg");
    expect(parsed).toMatchObject({ title: "call John", timezone: "Africa/Johannesburg" });
    expect(parsed?.dueAt.toISOString()).toBe("2026-08-24T12:00:00.000Z");
  });

  it("parses weekday reminders and user-asserted customer memory", () => {
    expect(parseDeterministicReminder("Remind me Friday to check this opportunity", new Date("2026-08-23T10:00:00.000Z"), "UTC")?.dueAt.toISOString()).toBe("2026-08-28T09:00:00.000Z");
    expect(parseRememberCommand("Remember that Sarah prefers afternoon calls")).toMatchObject({ subject: "Sarah", content: "prefers afternoon calls" });
  });

  it("keeps reminders isolated by both user and organisation", () => {
    const reminder = { userId: 7, organisationId: 9 };
    expect(reminderScopeMatches(reminder, 7, 9)).toBe(true);
    expect(reminderScopeMatches(reminder, 8, 9)).toBe(false);
    expect(reminderScopeMatches(reminder, 7, 10)).toBe(false);
  });

  it("tracks snooze and completed history durably", () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    const dueAt = new Date("2026-08-23T11:00:00.000Z");
    const snoozed = reminderStateUpdate("snoozed", dueAt, new Date("2026-08-24T11:00:00.000Z"), now);
    expect(snoozed.status).toBe("snoozed");
    expect(reminderStateUpdate("completed", snoozed.dueAt, undefined, now).completedAt).toEqual(now);
  });

  it("stores reminders and memories in restart-safe database tables", () => {
    expect(assistantReminders.dueAt).toBeDefined();
    expect(assistantReminders.status).toBeDefined();
    expect(assistantMemories.provenance).toBeDefined();
  });

  it("never promotes approved AI extraction to confirmed fact", () => {
    expect(trustForProvenance("approved_ai_extraction", "confirmed")).toBe("inferred");
    expect(trustForProvenance("user_asserted", "confirmed")).toBe("user_asserted");
  });
});
