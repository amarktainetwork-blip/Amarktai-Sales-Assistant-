import { queryRecorder } from "../testSupport/queryRecorder";
const mocked = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocked.db }));
import { describe, expect, it, vi } from "vitest";
import {
  matchInboundContact,
  inboundIdempotencyKey,
  mayPrepareInboundReply,
  parseInboundWebhookEnvelope,
  shouldSurfaceInbound,
} from "./inboundPipeline";

describe("inbound message processing contract", () => {
  it("normalizes a connector message envelope", () => {
    expect(
      parseInboundWebhookEnvelope({
        message: {
          id: "m-1",
          contactId: "contact-1",
          channel: "email",
          from: "Lead@Example.com",
          subject: "Pricing",
          body: "Could you send pricing?",
          receivedAt: "2026-08-23T08:00:00Z",
        },
      })
    ).toMatchObject({
      externalMessageId: "m-1",
      channel: "email",
      senderReference: "Lead@Example.com",
      contactExternalId: "contact-1",
      body: "Could you send pricing?",
    });
  });

  it("deduplicates within an organisation without crossing tenants", () => {
    expect(inboundIdempotencyKey(1, "email", "message-1")).toBe(
      inboundIdempotencyKey(1, "email", "message-1")
    );
    expect(inboundIdempotencyKey(1, "email", "message-1")).not.toBe(
      inboundIdempotencyKey(2, "email", "message-1")
    );
  });

  it("keeps actionable replies visible and review-controlled", () => {
    const classification = {
      category: "reply_needed" as const,
      reasons: ["question"],
    };
    expect(shouldSurfaceInbound(classification)).toBe(true);
    expect(mayPrepareInboundReply(classification, false)).toBe(true);
  });

  it("fails closed for unsubscribe and suppression", () => {
    const unsubscribe = {
      category: "unsubscribe" as const,
      reasons: ["opt out"],
    };
    expect(mayPrepareInboundReply(unsubscribe, false)).toBe(false);
    expect(
      mayPrepareInboundReply({ category: "reply_needed", reasons: [] }, true)
    ).toBe(false);
  });
});

describe("immutable contact and owner isolation", () => {
  const envelope = {
    externalMessageId: "m",
    channel: "sms" as const,
    senderReference: "+447700900123",
    contactExternalId: "exact-contact",
    body: "Please call",
    receivedAt: new Date(),
  };
  it("uses the exact contact without a phone rematch and scopes organisation, system and owner", async () => {
    const recorder = queryRecorder(q =>
      q.table === "externalUserMappings"
        ? [{ externalUserId: "owner" }]
        : [{ externalId: "exact-contact" }]
    );
    mocked.db.mockResolvedValue(recorder.db);
    const result = await matchInboundContact(8, envelope, {
      connectedSystemId: 3,
      mailboxUserId: 2,
    });
    expect(result.contact?.externalId).toBe("exact-contact");
    expect(recorder.queries).toHaveLength(2);
    expect(recorder.queries[1].where.params).toEqual([
      8,
      3,
      "exact-contact",
      "owner",
    ]);
    expect(recorder.queries[1].where.sql).not.toContain("normalizedPhone");
  });
  it("does not fall back to another phone contact when the exact ID is missing", async () => {
    const recorder = queryRecorder(() => []);
    mocked.db.mockResolvedValue(recorder.db);
    expect(
      (await matchInboundContact(8, envelope, { connectedSystemId: 3 })).contact
    ).toBeUndefined();
    expect(recorder.queries).toHaveLength(1);
  });
  it.each([
    { owners: [] },
    { owners: [{ externalUserId: "a" }, { externalUserId: "b" }] },
  ])(
    "fails closed for missing or ambiguous owner mapping",
    async ({ owners }) => {
      const recorder = queryRecorder(() => owners);
      mocked.db.mockResolvedValue(recorder.db);
      await expect(
        matchInboundContact(8, envelope, {
          connectedSystemId: 3,
          mailboxUserId: 2,
        })
      ).rejects.toThrow("INBOUND_OWNER_SCOPE_REQUIRED");
      expect(recorder.queries).toHaveLength(1);
    }
  );
});
