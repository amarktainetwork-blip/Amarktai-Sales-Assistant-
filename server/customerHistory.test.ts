import { describe, expect, it } from "vitest";
import { customerHistory } from "../shared/customerHistory";
describe("one customer communication timeline", () => {
  it("merges an inbound message with its CRM activity and preserves reply state", () => {
    const result = customerHistory(
      [
        {
          id: 1,
          externalId: "message:m",
          activityType: "sms",
          occurredAt: "2026-09-17",
          body: "Hello",
          raw: { direction: "inbound" },
        },
      ],
      [
        {
          id: 2,
          externalMessageId: "m",
          channel: "sms",
          body: "Hello",
          receivedAt: "2026-09-17",
          needsAction: true,
        },
      ]
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      channel: "SMS",
      direction: "Received",
      needsAction: true,
    });
  });
  it("does not label generic chat as WhatsApp", () => {
    const base = {
      id: 1,
      externalMessageId: "m",
      channel: "chat",
      body: "Hello",
      receivedAt: "2026-09-17",
      needsAction: true,
    };
    expect(customerHistory([], [base])[0].channel).toBe("Chat");
    expect(
      customerHistory(
        [],
        [{ ...base, classification: { sourceChannel: "whatsapp" } }]
      )[0].channel
    ).toBe("WhatsApp");
  });
  it("shows calls, notes and outbound email in time order without raw metadata", () => {
    const result = customerHistory(
      ["call", "note", "email"].map((activityType, i) => ({
        id: i,
        externalId: String(i),
        activityType,
        occurredAt: `2026-09-${10 + i}`,
        body: "Context",
        raw: { direction: "outbound", secret: "not for display" },
      })),
      []
    );
    expect(result.map(row => row.channel)).toEqual(["Email", "Note", "Call"]);
    expect(JSON.stringify(result)).not.toContain("not for display");
  });
});
