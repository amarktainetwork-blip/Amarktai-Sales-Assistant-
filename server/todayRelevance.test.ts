import { describe, expect, it } from "vitest";
import { isCurrentActionableInbound } from "./today";

describe("current sales day relevance", () => {
  const now = new Date("2026-09-07T12:00:00.000Z");

  it("surfaces current actionable replies and excludes old mailbox history", () => {
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(true);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: true,
          receivedAt: new Date("2025-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
    expect(
      isCurrentActionableInbound(
        {
          needsAction: false,
          receivedAt: new Date("2026-09-06T12:00:00.000Z"),
        },
        now
      )
    ).toBe(false);
  });
});
