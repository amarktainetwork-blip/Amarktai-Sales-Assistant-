import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../observability/events", () => ({ recordOperationalEvent: vi.fn() }));

import { matchInboundContact } from "./inboundPipeline";

function databaseReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { database: { select: vi.fn(() => ({ from })) }, limit };
}

describe("indexed inbound contact matching", () => {
  beforeEach(() => mocks.getDb.mockReset());

  it.each([
    ["email" as const, "Person2001@Example.test", "normalizedEmail"],
    ["sms" as const, "+27 82 000 2001", "normalizedPhone"],
  ])(
    "matches a %s contact beyond the former 2,000-row boundary",
    async (channel, sender) => {
      const contacts = Array.from({ length: 2_001 }, (_, index) => ({
        id: index + 1,
        externalId: `contact-${index + 1}`,
        connectedSystemId: 7,
      }));
      const { database, limit } = databaseReturning([contacts[2_000]]);
      mocks.getDb.mockResolvedValue(database);
      const result = await matchInboundContact(4, {
        externalMessageId: "message-1",
        channel,
        senderReference: sender,
        body: "Please call me",
        receivedAt: new Date(),
      });
      expect(result).toMatchObject({
        contact: { id: 2_001, externalId: "contact-2001" },
        ambiguous: false,
      });
      expect(limit).toHaveBeenCalledWith(2);
      expect(limit).not.toHaveBeenCalledWith(2_000);
    }
  );

  it("fails closed when an indexed sender identity matches multiple contacts", async () => {
    const { database } = databaseReturning([
      { id: 1, externalId: "a" },
      { id: 2, externalId: "b" },
    ]);
    mocks.getDb.mockResolvedValue(database);
    await expect(
      matchInboundContact(4, {
        externalMessageId: "message-1",
        channel: "email",
        senderReference: "shared@example.test",
        body: "Hello",
        receivedAt: new Date(),
      })
    ).resolves.toEqual({ contact: undefined, ambiguous: true });
  });
});
