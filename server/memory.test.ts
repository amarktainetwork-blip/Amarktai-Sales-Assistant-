import { describe, expect, it } from "vitest";
import { assistantMemories, assistantReminders } from "../drizzle/schema";
import {
  isSafeAssistantMemory,
  parseDeterministicReminder,
  parseRememberCommand,
  reminderScopeMatches,
  reminderStateUpdate,
  selectRelevantAssistantMemories,
  trustForProvenance,
  type AssistantMemoryRecord,
} from "./memory";

const memory = (
  overrides: Partial<AssistantMemoryRecord> = {}
): AssistantMemoryRecord => ({
  id: overrides.id ?? 1,
  userId: overrides.userId ?? 7,
  organisationId: overrides.organisationId ?? 9,
  memoryType: overrides.memoryType ?? "customer_fact",
  subject: overrides.subject ?? "Sarah",
  content: overrides.content ?? "prefers afternoon calls",
  contactExternalId: overrides.contactExternalId ?? null,
  opportunityExternalId: overrides.opportunityExternalId ?? null,
  trust: overrides.trust ?? "user_asserted",
  occurredAt: overrides.occurredAt ?? new Date("2025-01-01T10:00:00.000Z"),
  createdAt: overrides.createdAt ?? new Date("2025-01-01T10:00:00.000Z"),
});

describe("durable reminders and structured memory", () => {
  it("parses a timezone-aware reminder deterministically without AI", () => {
    const parsed = parseDeterministicReminder(
      "Remind me tomorrow at 2 to call John",
      new Date("2026-08-23T10:00:00.000Z"),
      "Africa/Johannesburg"
    );
    expect(parsed).toMatchObject({
      title: "call John",
      timezone: "Africa/Johannesburg",
    });
    expect(parsed?.dueAt.toISOString()).toBe("2026-08-24T12:00:00.000Z");
  });

  it("parses weekday reminders and user-asserted customer memory", () => {
    expect(
      parseDeterministicReminder(
        "Remind me Friday to check this opportunity",
        new Date("2026-08-23T10:00:00.000Z"),
        "UTC"
      )?.dueAt.toISOString()
    ).toBe("2026-08-28T09:00:00.000Z");
    expect(
      parseRememberCommand("Remember that Sarah prefers afternoon calls")
    ).toMatchObject({ subject: "Sarah", content: "prefers afternoon calls" });
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
    const snoozed = reminderStateUpdate(
      "snoozed",
      dueAt,
      new Date("2026-08-24T11:00:00.000Z"),
      now
    );
    expect(snoozed.status).toBe("snoozed");
    expect(
      reminderStateUpdate("completed", snoozed.dueAt, undefined, now)
        .completedAt
    ).toEqual(now);
  });

  it("stores reminders and memories in restart-safe database tables", () => {
    expect(assistantReminders.dueAt).toBeDefined();
    expect(assistantReminders.status).toBeDefined();
    expect(assistantMemories.provenance).toBeDefined();
  });

  it("never promotes approved AI extraction to confirmed fact", () => {
    expect(trustForProvenance("approved_ai_extraction", "confirmed")).toBe(
      "inferred"
    );
    expect(trustForProvenance("user_asserted", "confirmed")).toBe(
      "user_asserted"
    );
  });

  it("recalls older relevant memory without blindly injecting irrelevant memory", () => {
    const selected = selectRelevantAssistantMemories(
      [
        memory({ id: 1, subject: "Sarah", content: "prefers afternoon calls" }),
        memory({
          id: 2,
          subject: "Unrelated",
          content: "office parking is downstairs",
        }),
      ],
      {
        userId: 7,
        organisationId: 9,
        query: "When should I call Sarah?",
        now: new Date("2026-09-01T10:00:00.000Z"),
      }
    );
    expect(selected.map(item => item.id)).toEqual([1]);
  });

  it("cannot select memory from another user or organisation", () => {
    const selected = selectRelevantAssistantMemories(
      [
        memory({ id: 1, userId: 8 }),
        memory({ id: 2, organisationId: 10 }),
        memory({ id: 3 }),
      ],
      { userId: 7, organisationId: 9, query: "Sarah afternoon" }
    );
    expect(selected.map(item => item.id)).toEqual([3]);
  });

  it("suppresses passwords, OTPs, tokens and other sign-in secrets", () => {
    for (const content of [
      "CRM password is hunter2",
      "OTP 123456",
      "refresh token eyJabcdefghijkl.abcdefghi",
      "client secret is do-not-store",
    ])
      expect(isSafeAssistantMemory(content)).toBe(false);
    expect(isSafeAssistantMemory("Sarah prefers afternoon calls")).toBe(true);
  });
});
