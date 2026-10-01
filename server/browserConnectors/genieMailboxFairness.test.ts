import { describe, expect, it, vi } from "vitest";
import { readPersonalGenieMailbox } from "./genieMailboxRead";

describe("Genie mailbox shared browser fairness", () => {
  it("yields after a slow read, then resumes the exact conversation without losing messages", async () => {
    let clock = Date.parse("2026-09-18T12:00:00Z");
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    let delayed = false;
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const conversations = ["1", "2"].map(id => ({
      id: `conv-${id}`,
      contactId: `contact-${id}`,
      locationId: "loc",
      assignedTo: "owner",
      lastMessageDate: "2026-09-18T11:00:00Z",
    }));
    const get = vi.fn(async (url: string) => {
      if (url.includes("/conversations/search"))
        return response({ conversations, total: 2 });
      const contact = url.match(/\/contacts\/(contact-\d+)/);
      if (contact) {
        if (!delayed) {
          delayed = true;
          clock += 16_000;
        }
        return response({
          contact: { id: contact[1], locationId: "loc", assignedTo: "owner" },
        });
      }
      const thread = url.match(/\/conversations\/(conv-\d+)\/messages$/);
      if (thread) {
        const id = thread[1].slice(-1);
        return response({
          messages: {
            nextPage: false,
            messages: [
              {
                id: `message-${id}`,
                type: 2,
                locationId: "loc",
                contactId: `contact-${id}`,
                conversationId: `conv-${id}`,
                direction: "inbound",
                dateAdded: "2026-09-18T11:00:00Z",
                body: "Course enquiry",
                from: "+447700900123",
                to: "+447428000560",
                deleted: false,
              },
            ],
          },
        });
      }
      const detail = url.match(/\/conversations\/messages\/(message-\d+)$/);
      if (detail) {
        const id = detail[1].slice(-1);
        return response({
          message: {
            id: detail[1],
            type: 2,
            locationId: "loc",
            contactId: `contact-${id}`,
            conversationId: `conv-${id}`,
            direction: "inbound",
            dateAdded: "2026-09-18T11:00:00Z",
            body: "Course enquiry",
            from: "+447700900123",
            to: "+447428000560",
            deleted: false,
          },
        });
      }
      throw Error(`Unexpected read ${url}`);
    });
    const page = {
      url: () => "https://genie.test/v2/location/loc/contacts",
      evaluate: async () => "token",
      context: () => ({
        request: {
          get,
          post: async () => response({ search: { conversations: [] } }),
        },
      }),
    } as any;
    const input = {
      page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
      since: new Date("2026-09-18T10:00:00Z"),
    };
    try {
      const first = await readPersonalGenieMailbox(input);
      expect(first.liveProgress).toMatchObject({ conversationIndex: 0 });
      expect(first.records).toHaveLength(0);
      const second = await readPersonalGenieMailbox({
        ...input,
        liveProgress: first.liveProgress,
      });
      expect(second.liveProgress).toBeUndefined();
      expect(second.records.map(x => x.externalMessageId)).toEqual([
        "message-1",
        "message-2",
      ]);
      expect(second.unreadPreserved).toBe(true);
    } finally {
      now.mockRestore();
    }
  });
});
