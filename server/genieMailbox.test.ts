import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  exactGenieMailboxIdentity,
  parseGenieReceivedAt,
} from "./genieMailbox";
import {
  readPersonalGenieMailbox,
  genieConversationChannel,
  mailboxAddress,
  parsePersonalGenieConversationMessage,
  parsePersonalGenieEmail,
} from "./browserConnectors/genieMailboxRead";

const baseEmail = {
  id: "email-1",
  dateAdded: "2026-09-16T14:00:00.000Z",
  deleted: false,
  to: ["amelia@course2career.com"],
  from: "Customer <customer@example.test>",
  direction: "inbound",
  locationId: "location-1",
  contactId: "contact-1",
  conversationId: "conversation-1",
  subject: "Question",
  body: "Please call me.",
};

describe("Genie personal email isolation", () => {
  it("allows ingestion only when app, CRM mapping and Genie recipient email match exactly", () => {
    expect(
      exactGenieMailboxIdentity({
        appEmail: "Amelia@Course2Career.com",
        mappingEmail: "amelia@course2career.com",
        recipientEmail: " AMELIA@course2career.com ",
      })
    ).toBe(true);
  });

  it.each([
    {
      appEmail: "amelia@course2career.com",
      mappingEmail: "amelia@course2career.com",
      recipientEmail: "other@course2career.com",
    },
    {
      appEmail: "amelia@course2career.com",
      mappingEmail: "other@course2career.com",
      recipientEmail: "amelia@course2career.com",
    },
    {
      appEmail: "",
      mappingEmail: "amelia@course2career.com",
      recipientEmail: "amelia@course2career.com",
    },
  ])("fails closed for shared-inbox mismatch: %o", input => {
    expect(exactGenieMailboxIdentity(input)).toBe(false);
  });

  it("normalizes direct and display-name mailbox addresses", () => {
    expect(mailboxAddress(" Amelia@Course2Career.com ")).toBe(
      "amelia@course2career.com"
    );
    expect(mailboxAddress("Customer <customer@example.test>")).toBe(
      "customer@example.test"
    );
    expect(mailboxAddress("not-an-email")).toBe("");
  });

  it("accepts one exact personal unread inbound email", () => {
    const result = parsePersonalGenieEmail(
      { emailMessage: baseEmail },
      {
        emailId: "email-1",
        mailboxEmail: "amelia@course2career.com",
        locationId: "location-1",
        conversationId: "conversation-1",
        unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
      }
    );
    expect(result).toMatchObject({
      kind: "personal",
      message: {
        emailId: "email-1",
        sender: "customer@example.test",
        recipient: "amelia@course2career.com",
        contactExternalId: "contact-1",
      },
    });
  });

  it("rejects another mailbox and multi-recipient/team email without ingesting it", () => {
    const input = {
      emailId: "email-1",
      mailboxEmail: "amelia@course2career.com",
      locationId: "location-1",
      conversationId: "conversation-1",
      unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
    };
    expect(
      parsePersonalGenieEmail(
        { emailMessage: { ...baseEmail, to: ["team@course2career.com"] } },
        input
      )
    ).toEqual({ kind: "foreign" });
    expect(
      parsePersonalGenieEmail(
        {
          emailMessage: {
            ...baseEmail,
            to: ["amelia@course2career.com", "team@course2career.com"],
          },
        },
        input
      )
    ).toEqual({ kind: "foreign" });
  });

  it("ignores outbound, old/read-window, deleted, self and empty-body email", () => {
    const input = {
      emailId: "email-1",
      mailboxEmail: "amelia@course2career.com",
      locationId: "location-1",
      conversationId: "conversation-1",
      unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
    };
    expect(
      parsePersonalGenieEmail(
        { emailMessage: { ...baseEmail, direction: "outbound" } },
        input
      )
    ).toEqual({ kind: "excluded" });
    expect(
      parsePersonalGenieEmail(
        {
          emailMessage: {
            ...baseEmail,
            dateAdded: "2026-09-16T13:58:00.000Z",
          },
        },
        input
      )
    ).toEqual({ kind: "excluded" });
    expect(
      parsePersonalGenieEmail(
        { emailMessage: { ...baseEmail, deleted: true } },
        input
      )
    ).toEqual({ kind: "excluded" });
    expect(
      parsePersonalGenieEmail(
        {
          emailMessage: {
            ...baseEmail,
            from: "amelia@course2career.com",
          },
        },
        input
      )
    ).toEqual({ kind: "excluded" });
    expect(
      parsePersonalGenieEmail(
        { emailMessage: { ...baseEmail, body: "" } },
        input
      )
    ).toEqual({ kind: "excluded" });
  });

  it("fails closed when immutable Genie scope disagrees", () => {
    expect(() =>
      parsePersonalGenieEmail(
        {
          emailMessage: {
            ...baseEmail,
            conversationId: "conversation-other",
          },
        },
        {
          emailId: "email-1",
          mailboxEmail: "amelia@course2career.com",
          locationId: "location-1",
          conversationId: "conversation-1",
          unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
        }
      )
    ).toThrow("GENIE_MAILBOX_SCOPE_MISMATCH");
  });

  it("maps HighLevel call/SMS types correctly and recognizes WhatsApp by the provider message type", () => {
    expect(genieConversationChannel({ type: 1 })).toBeNull();
    expect(genieConversationChannel({ type: 2 })).toBe("sms");
    expect(
      genieConversationChannel({ type: 99, messageTypeString: "TYPE_WHATSAPP" })
    ).toBe("chat");
  });

  it("normalizes one owner-scoped unread inbound SMS/WhatsApp message without marking it read", () => {
    const common = {
      id: "message-1",
      locationId: "location-1",
      conversationId: "conversation-1",
      contactId: "contact-1",
      dateAdded: "2026-09-16T14:00:00.000Z",
      direction: "inbound",
      deleted: false,
      body: "Can you call me this afternoon?",
      from: "+447700900123",
      to: "+447428000560",
    };
    expect(
      parsePersonalGenieConversationMessage(
        { ...common, type: 2 },
        {
          messageId: "message-1",
          locationId: "location-1",
          conversationId: "conversation-1",
          contactExternalId: "contact-1",
          unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
        }
      )
    ).toMatchObject({
      kind: "personal",
      message: {
        channel: "sms",
        externalMessageId: "message-1",
        sender: "+447700900123",
        contactExternalId: "contact-1",
      },
    });
    expect(
      parsePersonalGenieConversationMessage(
        { ...common, type: 25, messageTypeString: "TYPE_WHATSAPP" },
        {
          messageId: "message-1",
          locationId: "location-1",
          conversationId: "conversation-1",
          contactExternalId: "contact-1",
          unreadSince: Date.parse("2026-09-16T13:59:00.000Z"),
        }
      )
    ).toMatchObject({ kind: "personal", message: { channel: "chat" } });
  });

  it("parses Genie's actual received timestamp and rejects invalid timestamp text", () => {
    const parsed = parseGenieReceivedAt("Sep 14, 2026 06:03 PM");
    expect(parsed).toBeInstanceOf(Date);
    expect(Number.isNaN(parsed?.getTime())).toBe(false);
    expect(parseGenieReceivedAt("not-a-time")).toBeNull();
    expect(parseGenieReceivedAt("")).toBeNull();
  });

  it("uses the authenticated read-only source instead of opening shared inbox conversations", () => {
    const source = readFileSync(
      new URL("./genieMailbox.ts", import.meta.url),
      "utf8"
    );
    const reader = readFileSync(
      new URL("./browserConnectors/genieMailboxRead.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("readPersonalGenieMailbox");
    expect(source).toContain("verifiedUserCrmScope");
    expect(source).toContain("loadUserConnectionSecret");
    expect(source).toContain("crmUserExternalId");
    expect(source).toContain("crmUserEmail");
    expect(source).toContain("exactGenieMailboxIdentity");
    expect(reader).toContain('status: "unread"');
    expect(reader).toContain("unreadPreserved");
    expect(reader).toContain("rejectedForeignRecipientCount");
    expect(reader).not.toContain(".click(");
  });

  it("refuses unhealthy Genie connections and preserves the source receive time", () => {
    const source = readFileSync(
      new URL("./genieMailbox.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      '["ready", "limited_permissions"].includes(candidate.status)'
    );
    expect(source).toContain("receivedAt: message.receivedAt");
    expect(source).not.toContain("receivedAt: new Date()");
  });

  it("filters Genie-enabled members before applying the mailbox-cycle bound", () => {
    const source = readFileSync(
      new URL("./genieMailbox.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain(".where(eq(organisationMembers.isActive, true));");
    expect(source).toContain(".slice(0, MAX_GENIE_MAILBOXES_PER_CYCLE)");
    expect(source).not.toContain(".limit(MAX_GENIE_MAILBOXES_PER_CYCLE * 4)");
  });
});

describe("inbound phone message fail-closed scope", () => {
  const input = {
    messageId: "m",
    locationId: "loc",
    conversationId: "conv",
    contactExternalId: "contact",
    unreadSince: Date.parse("2026-09-17T09:00:00Z"),
  };
  const message = {
    id: "m",
    type: 2,
    locationId: "loc",
    conversationId: "conv",
    contactId: "contact",
    dateAdded: "2026-09-17T10:00:00Z",
    direction: "inbound",
    body: "Please call",
    from: "+447700900123",
  };
  it.each(["contactId", "locationId", "conversationId"])(
    "rejects mismatched %s",
    field => {
      expect(() =>
        parsePersonalGenieConversationMessage(
          { ...message, [field]: "other" },
          input
        )
      ).toThrow("GENIE_MAILBOX_SCOPE_MISMATCH");
    }
  );
  it.each([
    { direction: "outbound" },
    { deleted: true },
    { type: 1 },
    { type: 25 },
    { dateAdded: "2026-09-16" },
  ])(
    "excludes calls, unproven types, old and non-inbound messages %j",
    change => {
      expect(
        parsePersonalGenieConversationMessage({ ...message, ...change }, input)
      ).toEqual({ kind: "excluded" });
    }
  );
  it("checks an email's contact as well as mailbox and conversation", () => {
    expect(() =>
      parsePersonalGenieEmail(
        { ...baseEmail, contactId: "other" },
        {
          emailId: "email-1",
          mailboxEmail: "amelia@course2career.com",
          locationId: "location-1",
          conversationId: "conversation-1",
          contactExternalId: "contact-1",
          unreadSince: 0,
        }
      )
    ).toThrow("GENIE_MAILBOX_SCOPE_MISMATCH");
  });
});

describe("read-only mailbox ownership proof", () => {
  function source(contactOwner: string, conversationOwner = "owner") {
    const conversation = {
      id: "conv",
      contactId: "contact",
      locationId: "loc",
      assignedTo: conversationOwner,
      unreadCount: 1,
      firstUnreadInboundTimestamp: Date.parse("2026-09-17T09:00:00Z"),
    };
    const message = {
      id: "m",
      type: 2,
      locationId: "loc",
      contactId: "contact",
      conversationId: "conv",
      direction: "inbound",
      dateAdded: "2026-09-17T10:00:00Z",
      body: "Please call",
      from: "+447700900123",
    };
    const response = (data: unknown) => ({
      ok: () => true,
      status: () => 200,
      json: async () => data,
    });
    const get = vi.fn(async (url: string) =>
      response(
        url.includes("/contacts/")
          ? {
              contact: {
                id: "contact",
                assignedTo: contactOwner,
                locationId: "loc",
              },
            }
          : url.endsWith("/messages")
            ? { messages: { messages: [message], nextPage: false } }
            : { message }
      )
    );
    const post = vi.fn(async () =>
      response({ search: { conversations: [conversation] } })
    );
    return {
      get,
      post,
      page: {
        url: () => "https://genie.test/v2/location/loc/contacts",
        evaluate: async () => "token",
        context: () => ({ request: { get, post } }),
      } as any,
    };
  }
  it("ingests a proven owner/contact SMS using only reads and preserves unread state", async () => {
    const f = source("owner");
    const result = await readPersonalGenieMailbox({
      page: f.page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      channel: "sms",
      contactExternalId: "contact",
    });
    expect(result.unreadPreserved).toBe(true);
    expect(f.post).toHaveBeenCalledTimes(2);
    expect(
      f.post.mock.calls.every(
        (call: any) =>
          call[0].endsWith("/inbox-bootstrap") &&
          call[1].data.saveFilters === false
      )
    ).toBe(true);
  });
  it("does not trust stale conversation assignment when the contact has another owner", async () => {
    const f = source("other");
    const result = await readPersonalGenieMailbox({
      page: f.page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
    });
    expect(result.records).toEqual([]);
    expect(result.rejectedForeignOwnerCount).toBe(1);
    expect(f.get).toHaveBeenCalledTimes(1);
  });
  it("excludes another salesperson's conversation even if the contact is owned", async () => {
    const f = source("owner", "other");
    const result = await readPersonalGenieMailbox({
      page: f.page,
      ownerExternalId: "owner",
      mailboxEmail: "advisor@example.test",
    });
    expect(result.records).toEqual([]);
    expect(f.get).not.toHaveBeenCalled();
  });
});
