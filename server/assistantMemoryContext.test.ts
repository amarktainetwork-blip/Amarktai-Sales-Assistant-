import { describe, expect, it } from "vitest";
import {
  assistantMemoryWindowLabel,
  firstNameFromDisplayName,
  selectAssistantMemoryContext,
} from "./assistantMemoryContext";

describe("assistant memory context", () => {
  const now = new Date("2026-09-01T10:00:00.000Z");

  it("labels yesterday, last week and last month deterministically", () => {
    expect(assistantMemoryWindowLabel("2026-08-31T15:00:00.000Z", now)).toBe("yesterday");
    expect(assistantMemoryWindowLabel("2026-08-27T15:00:00.000Z", now)).toBe("last 7 days");
    expect(assistantMemoryWindowLabel("2026-08-10T15:00:00.000Z", now)).toBe("last 30 days");
  });

  it("keeps temporally relevant memories for last-month questions", () => {
    const selected = selectAssistantMemoryContext(
      "What did we discuss last month about the renewal?",
      [
        {
          subject: "Renewal discussion",
          content: "The customer asked for a revised renewal proposal.",
          memoryType: "conversation_reference",
          provenance: "approved_ai_extraction",
          trust: "inferred",
          occurredAt: "2026-08-12T11:00:00.000Z",
        },
        {
          subject: "Old unrelated item",
          content: "Unrelated historical note.",
          memoryType: "conversation_reference",
          provenance: "approved_ai_extraction",
          trust: "inferred",
          occurredAt: "2025-01-01T11:00:00.000Z",
        },
      ],
      now
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.subject).toBe("Renewal discussion");
  });

  it("uses the user's first display-name token", () => {
    expect(firstNameFromDisplayName("Graeme Smith")).toBe("Graeme");
    expect(firstNameFromDisplayName("  Amarktai Administrator ")).toBe("Amarktai");
  });
});
