import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canStartLegacyGenieBackfillRow, readPersonalGenieMailbox } from "./genieMailboxRead";

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

  it("clears live progress once a saved source window reaches its time boundary", async () => {
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const oldConversation = {
      id: "old-conversation",
      contactId: "old-contact",
      locationId: "loc",
      assignedTo: "owner",
      lastMessageDate: "2026-09-17T08:59:59Z",
    };
    const get = vi.fn(async (url: string) => {
      if (url.includes("/conversations/search"))
        throw new Error("saved snapshot should finish without a new search");
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

    const result = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      liveProgress: {
        sourceSince: "2026-09-17T09:00:00.000Z",
        conversations: [oldConversation],
        conversationIndex: 0,
      },
    });

    expect(result.checked).toBe(1);
    expect(result.liveProgress).toBeUndefined();
    expect(result.bounded).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("bounds email detail reads within one page and resumes at the exact email id", async () => {
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const conversation = {
      id: "email-heavy-conversation",
      contactId: "email-heavy-contact",
      locationId: "loc",
      assignedTo: "owner",
      lastMessageDate: "2026-09-17T10:30:00Z",
    };
    const emailIds = Array.from({ length: 25 }, (_, index) => `email-${index}`);
    const thread = {
      id: "email-thread",
      type: 3,
      locationId: "loc",
      contactId: "email-heavy-contact",
      conversationId: "email-heavy-conversation",
      direction: "inbound",
      dateAdded: "2026-09-17T10:20:00Z",
      meta: { email: { messageIds: emailIds } },
    };
    const detailReads: string[] = [];
    const get = vi.fn(async (url: string) => {
      if (url.includes("/conversations/search"))
        return response({ conversations: [conversation], total: 1 });
      if (url.includes("/contacts/email-heavy-contact"))
        return response({
          contact: {
            id: "email-heavy-contact",
            locationId: "loc",
            assignedTo: "owner",
          },
        });
      if (url.endsWith("/conversations/email-heavy-conversation/messages"))
        return response({
          messages: { messages: [thread], nextPage: false },
        });
      if (url.includes("/conversations/messages/email/")) {
        const emailId = url.split("/").pop()!;
        detailReads.push(emailId);
        return response({
          emailMessage: {
            id: emailId,
            type: 3,
            locationId: "loc",
            contactId: "email-heavy-contact",
            conversationId: "email-heavy-conversation",
            direction: "inbound",
            dateAdded: "2026-09-17T10:20:00Z",
            from: "lead@example.test",
            to: ["advisor@example.test"],
            subject: "Course enquiry",
            body: `Message ${emailId}`,
            deleted: false,
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

    const first = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
    });
    expect(detailReads).toEqual(emailIds.slice(0, 20));
    expect(first.records).toHaveLength(20);
    expect(first.liveProgress).toMatchObject({
      conversationIndex: 0,
      threadOffset: 0,
      emailIdOffset: 20,
    });
    expect(first.bounded).toBe(true);

    detailReads.length = 0;
    const second = await readPersonalGenieMailbox({
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-17T09:00:00Z"),
      liveProgress: first.liveProgress,
    });
    expect(detailReads).toEqual(emailIds.slice(20));
    expect(second.records.map(record => record.externalMessageId)).toEqual(
      emailIds.slice(20)
    );
    expect(second.liveProgress).toBeUndefined();
    expect(second.bounded).toBe(false);
  });

  it("caps aggregate legacy provider work before the worker watchdog can be monopolised", () => {
    expect(
      canStartLegacyGenieBackfillRow({
        providerRequests: 40,
        elapsedMs: 5_000,
        attemptedRows: 0,
      })
    ).toBe(true);
    expect(
      canStartLegacyGenieBackfillRow({
        providerRequests: 42,
        elapsedMs: 5_000,
        attemptedRows: 0,
      })
    ).toBe(false);
    expect(
      canStartLegacyGenieBackfillRow({
        providerRequests: 5,
        elapsedMs: 15_000,
        attemptedRows: 0,
      })
    ).toBe(true);
    expect(
      canStartLegacyGenieBackfillRow({
        providerRequests: 5,
        elapsedMs: 15_000,
        attemptedRows: 1,
      })
    ).toBe(false);
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
    expect(reader).toContain("MAX_LIVE_DETAIL_READS_PER_CYCLE = 20");
    expect(reader).toContain("MAX_PROVIDER_REQUESTS_PER_CYCLE = 48");
    expect(reader).toContain("MAILBOX_REQUEST_TIMEOUT_MS = 10_000");
    expect(reader).toContain("threadOffset");
    expect(reader).toContain("emailIdOffset");
    expect(reader).toContain("liveReachedTimeBoundary");
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

  it("overlaps a date boundary when Genie omits provider continuation and still reaches the next-page inbound", async () => {
    const first = Array.from({ length: 20 }, (_, index) => ({
      id: `foreign-${index}`,
      contactId: `foreign-contact-${index}`,
      locationId: "loc",
      assignedTo: "other",
      lastMessageDate: new Date(Date.parse("2026-09-17T10:20:00Z") - index * 60_000).toISOString(),
    }));
    const target = {
      id: "target", contactId: "target-contact", locationId: "loc",
      assignedTo: "owner", lastMessageDate: "2026-09-17T10:00:00Z",
    };
    const response = (data: unknown) => ({
      ok: () => true, status: () => 200, json: async () => data,
    });
    const search = vi.fn(async (_url: string, options?: any) => {
      if (options?.params?.startAfterDate) {
        expect(options.params.startAfterDate).toBe("2026-09-17T10:01:00.001Z");
        return response({ conversations: [target], total: 21 });
      }
      return response({ conversations: first, total: 21 });
    });
    const get = vi.fn(async (url: string, options?: any) => {
      if (url.includes("/conversations/search")) return search(url, options);
      if (url.endsWith("/contacts/target-contact")) return response({
        contact: { id: "target-contact", locationId: "loc", assignedTo: "owner" },
      });
      if (url.endsWith("/conversations/target/messages")) return response({
        messages: { messages: [], nextPage: false },
      });
      throw Error(`unexpected GET ${url}`);
    });
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: { get, post: async () => response({ search: { conversations: [] } }) } }),
    } as any;
    const input = { page, ownerExternalId: "owner", mailboxEmail: "advisor@example.test", since: new Date("2026-09-17T09:00:00Z") };
    const a = await readPersonalGenieMailbox(input);
    const b = await readPersonalGenieMailbox({ ...input, liveProgress: a.liveProgress });
    expect(b.liveProgress).toMatchObject({
      searchCursor: "2026-09-17T10:01:00.001Z",
      previousPageIds: first.map(x => x.id),
    });
    const c = await readPersonalGenieMailbox({ ...input, liveProgress: b.liveProgress });
    expect(c.checked).toBe(1);
    expect(c.liveProgress).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("fails closed rather than looping or silently skipping timestamp ties when the fallback page cannot advance", async () => {
    const first = Array.from({ length: 20 }, (_, index) => ({
      id: `same-${index}`, contactId: `contact-${index}`, locationId: "loc",
      assignedTo: "other", lastMessageDate: "2026-09-17T10:05:00Z",
    }));
    const response = (data: unknown) => ({ ok: () => true, status: () => 200, json: async () => data });
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({ request: {
        get: async (url: string) => {
          if (url.includes("/conversations/search"))
            return response({ conversations: first, total: 21 });
          throw Error(`unexpected GET ${url}`);
        },
        post: async () => response({ search: { conversations: [] } }),
      } }),
    } as any;
    const input = { page, ownerExternalId: "owner", mailboxEmail: "advisor@example.test", since: new Date("2026-09-17T09:00:00Z") };
    const a = await readPersonalGenieMailbox(input);
    const b = await readPersonalGenieMailbox({ ...input, liveProgress: a.liveProgress });
    expect(b.liveProgress?.searchCursor).toBe("2026-09-17T10:05:00.001Z");
    await expect(readPersonalGenieMailbox({ ...input, liveProgress: b.liveProgress }))
      .rejects.toThrow("GENIE_MAILBOX_SEARCH_CURSOR_STALLED");
  });
});
