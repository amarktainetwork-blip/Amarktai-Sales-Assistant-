import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { readPersonalGenieMailbox } from "./genieMailboxRead";

describe("Genie mailbox continuation", () => {
  it("continues past the first owner-scoped conversation page and ingests a later-page inbound message", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: `foreign-conv-${index}`,
      contactId: `foreign-contact-${index}`,
      locationId: "loc",
      assignedTo: "other-owner",
      // Deliberately give every first-page row the same timestamp. Date-only
      // continuation is ambiguous here; the provider cursor must be used.
      lastMessageDate: "2026-09-17T10:05:00Z",
    }));
    const targetConversation = {
      id: "target-conversation",
      contactId: "target-contact",
      locationId: "loc",
      assignedTo: "owner",
      lastMessageDate: "2026-09-17T10:05:00Z",
    };
    const targetMessage = {
      id: "target-message",
      type: 2,
      locationId: "loc",
      contactId: "target-contact",
      conversationId: "target-conversation",
      direction: "inbound",
      dateAdded: "2026-09-17T10:05:00Z",
      body: "Please call me about the course.",
      from: "+447700900123",
      to: "+447428000560",
      deleted: false,
    };
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const get = vi.fn(async (url: string, options?: any) => {
      if (url.includes("/conversations/search")) {
        return response(
          options?.params?.startAfterDate
            ? { conversations: [targetConversation], total: 21 }
            : {
                conversations: firstPage,
                total: 21,
                nextPage: "provider-cursor-page-2",
              }
        );
      }
      if (url.includes("/contacts/target-contact"))
        return response({
          contact: {
            id: "target-contact",
            locationId: "loc",
            assignedTo: "owner",
          },
        });
      if (url.endsWith("/conversations/target-conversation/messages"))
        return response({
          messages: { messages: [targetMessage], nextPage: false },
        });
      if (url.endsWith("/conversations/messages/target-message"))
        return response({ message: targetMessage });
      throw new Error(`unexpected GET ${url}`);
    });
    const post = vi.fn(async () =>
      response({ search: { conversations: [] } })
    );
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get, post } }),
    } as any;

    const first = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
    });
    expect(first.records).toHaveLength(0);
    expect(first.liveProgress).toMatchObject({
      conversationIndex: 10,
      nextSearchCursor: "provider-cursor-page-2",
    });

    const second = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      liveProgress: first.liveProgress,
    });
    expect(second.records).toHaveLength(0);
    expect(second.liveProgress).toMatchObject({
      searchCursor: "provider-cursor-page-2",
    });

    const third = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      liveProgress: second.liveProgress,
    });

    const searches = get.mock.calls.filter((call: any) =>
      String(call[0]).includes("/conversations/search")
    );
    expect(searches).toHaveLength(2);
    expect(searches[1]?.[1]?.params?.startAfterDate).toBe(
      "provider-cursor-page-2"
    );
    expect(third.records).toHaveLength(1);
    expect(third.records[0]).toMatchObject({
      externalMessageId: "target-message",
      contactExternalId: "target-contact",
      channel: "sms",
    });
    expect(first.checked + second.checked + third.checked).toBe(21);
    expect(third.liveProgress).toBeUndefined();
    expect(third.unreadPreserved).toBe(true);
  });

  it("bounds a deep live conversation and resumes from the exact message cursor", async () => {
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const conversation = {
      id: "busy-conversation",
      contactId: "busy-contact",
      locationId: "loc",
      assignedTo: "owner",
      lastMessageDate: "2026-09-17T10:30:00Z",
    };
    const cursors: Array<string | undefined> = [];
    const liveMessage = {
      id: "live-message",
      type: 2,
      locationId: "loc",
      contactId: "busy-contact",
      conversationId: "busy-conversation",
      direction: "inbound",
      dateAdded: "2026-09-17T10:00:00Z",
      body: "Please call me.",
      from: "+447700900123",
      deleted: false,
    };
    const get = vi.fn(async (url: string, options?: any) => {
      if (url.includes("/conversations/search"))
        return response({ conversations: [conversation], total: 1 });
      if (url.includes("/contacts/busy-contact"))
        return response({
          contact: {
            id: "busy-contact",
            locationId: "loc",
            assignedTo: "owner",
          },
        });
      if (url.endsWith("/conversations/busy-conversation/messages")) {
        const cursor = options?.params?.lastMessageId as string | undefined;
        cursors.push(cursor);
        const page = cursor ? Number(cursor.replace("page-", "")) + 1 : 1;
        if (page <= 6)
          return response({
            messages: {
              messages: [
                {
                  ...liveMessage,
                  id: `filler-${page}`,
                  dateAdded: "2026-09-17T10:20:00Z",
                },
              ],
              nextPage: true,
              lastMessageId: `page-${page}`,
            },
          });
        return response({
          messages: { messages: [liveMessage], nextPage: false },
        });
      }
      if (url.endsWith("/conversations/messages/live-message"))
        return response({ message: liveMessage });
      if (url.includes("/conversations/messages/filler-"))
        return response({
          message: {
            ...liveMessage,
            id: url.split("/").pop(),
            dateAdded: "2026-09-17T10:20:00Z",
          },
        });
      throw new Error(`unexpected GET ${url}`);
    });
    const post = vi.fn(async () =>
      response({ search: { conversations: [] } })
    );
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get, post } }),
    } as any;

    const first = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
    });
    expect(cursors).toEqual([
      undefined,
      "page-1",
      "page-2",
      "page-3",
      "page-4",
      "page-5",
    ]);
    expect(first.liveProgress).toMatchObject({
      conversationIndex: 0,
      lastMessageId: "page-6",
    });
    expect(first.bounded).toBe(true);

    cursors.length = 0;
    const second = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      liveProgress: first.liveProgress,
    });
    expect(cursors).toEqual(["page-6"]);
    expect(second.records).toEqual([
      expect.objectContaining({ externalMessageId: "live-message" }),
    ]);
    expect(second.liveProgress).toBeUndefined();
  });

  it("checkpoints one deep legacy conversation after three pages and resumes from that checkpoint", async () => {
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const outbound = {
      id: "outbound-after",
      type: 2,
      locationId: "loc",
      contactId: "target-contact",
      conversationId: "legacy-conversation",
      direction: "outbound",
      dateAdded: "2026-09-17T10:20:00Z",
      deleted: false,
    };
    const filler = (id: string) => ({
      id,
      type: 2,
      locationId: "loc",
      contactId: "target-contact",
      conversationId: "legacy-conversation",
      direction: "inbound",
      dateAdded: "2026-09-17T10:10:00Z",
      deleted: false,
    });
    const target = {
      ...filler("legacy-inbound"),
      dateAdded: "2026-09-17T10:00:00Z",
    };
    const historyCursors: Array<string | undefined> = [];
    const get = vi.fn(async (url: string, options?: any) => {
      if (url.includes("/conversations/search"))
        return response({ conversations: [], total: 0 });
      if (url.includes("/contacts/target-contact"))
        return response({
          contact: {
            id: "target-contact",
            locationId: "loc",
            assignedTo: "owner",
          },
        });
      if (url.endsWith("/conversations/messages/legacy-inbound"))
        return response({
          message: {
            ...target,
            id: "legacy-inbound",
          },
        });
      if (url.endsWith("/conversations/legacy-conversation/messages")) {
        const cursor = options?.params?.lastMessageId as string | undefined;
        historyCursors.push(cursor);
        if (!cursor)
          return response({
            messages: {
              messages: [outbound],
              nextPage: true,
              lastMessageId: "page-1",
            },
          });
        if (cursor === "page-1")
          return response({
            messages: {
              messages: [filler("filler-2")],
              nextPage: true,
              lastMessageId: "page-2",
            },
          });
        if (cursor === "page-2")
          return response({
            messages: {
              messages: [filler("filler-3")],
              nextPage: true,
              lastMessageId: "page-3",
            },
          });
        if (cursor === "page-3")
          return response({
            messages: {
              messages: [target],
              nextPage: false,
              lastMessageId: "page-4",
            },
          });
      }
      throw new Error(`unexpected GET ${url}`);
    });
    const post = vi.fn(async () =>
      response({ search: { conversations: [] } })
    );
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get, post } }),
    } as any;
    const unresolved = {
      externalMessageId: "legacy-inbound",
      channel: "sms" as const,
      contactExternalId: "target-contact",
      receivedAt: new Date("2026-09-17T10:00:00Z"),
    };

    const first = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      unresolved: [unresolved],
    });
    expect(historyCursors).toEqual([undefined, "page-1", "page-2"]);
    expect(first.outboundEvidence).toHaveLength(0);
    expect(first.legacyBackfillProgress).toHaveLength(1);
    expect(first.legacyBackfillProgress[0]).toMatchObject({
      inboundExternalMessageId: "legacy-inbound",
      conversationExternalId: "legacy-conversation",
      lastMessageId: "page-3",
      candidateOutboundEvidence: {
        externalMessageId: "outbound-after",
        verifiedAfterInboundByThreadOrder: true,
      },
    });

    historyCursors.length = 0;
    const progress = first.legacyBackfillProgress[0];
    const second = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      unresolved: [
        {
          ...unresolved,
          backfillProgress: {
            conversationExternalId: progress.conversationExternalId,
            lastMessageId: progress.lastMessageId,
            candidateOutboundEvidence: progress.candidateOutboundEvidence,
          },
        },
      ],
    });
    expect(historyCursors).toEqual(["page-3"]);
    expect(second.legacyBackfillProgress).toHaveLength(0);
    expect(second.outboundEvidence).toEqual([
      expect.objectContaining({
        externalMessageId: "outbound-after",
        inboundExternalMessageId: "legacy-inbound",
        verifiedAfterInboundByThreadOrder: true,
      }),
    ]);
  });

  it("has no fixed first-page or first-200-message discovery cap and checkpoints bounded legacy backfill", () => {
    const reader = readFileSync(new URL("./genieMailboxRead.ts", import.meta.url), "utf8");
    expect(reader).not.toContain("searchPage < 1");
    expect(reader).not.toContain("MAX_CONVERSATIONS_PER_SYNC");
    expect(reader).not.toContain("examined >= 200");
    expect(reader).not.toContain("(input.unresolved || []).slice(0, 20)");

    const mailbox = readFileSync(new URL("../genieMailbox.ts", import.meta.url), "utf8");
    const start = mailbox.indexOf("const actionableBackfill");
    const end = mailbox.indexOf("const now = Date.now()", start);
    const backfill = mailbox.slice(start, end);
    expect(backfill).not.toContain(".limit(60)");
    expect(backfill).not.toContain(".slice(0, 20)");
    expect(mailbox).toContain("GENIE_ACTIONABLE_BACKFILL_BATCH_SIZE = 10");
    expect(mailbox).toContain("genie_mailbox_backfill_");
    expect(mailbox).toContain("upperBoundId");
    expect(mailbox).toContain("saveGenieActionableBackfillCursor");
    expect(mailbox).toContain("saveGenieLiveMailboxProgress");
    expect(mailbox).not.toContain("cursor.upperBoundId > maxId");
    const syncStart = mailbox.indexOf("export async function syncGenieMailboxForUser");
    const audit = mailbox.indexOf(
      'eventType: "personal_genie_mailbox_synced"',
      syncStart
    );
    const checkpoint = mailbox.indexOf(
      "await saveGenieActionableBackfillCursor",
      audit
    );
    expect(checkpoint).toBeGreaterThan(audit);
  });
});
