import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userMailboxConnections } from "../drizzle/schema";
import { mailboxOwnershipMatches } from "./delegatedMailbox";

const source = readFileSync(
  new URL("./delegatedMailbox.ts", import.meta.url),
  "utf8"
);
const execution = readFileSync(
  new URL("./crm/executeApprovedAction.ts", import.meta.url),
  "utf8"
);
const reviews = readFileSync(
  new URL("../client/src/pages/Reviews.tsx", import.meta.url),
  "utf8"
);

describe("per-user delegated Microsoft mailbox", () => {
  it("isolates mailbox ownership by both user and organisation", () => {
    const mailbox = { userId: 7, organisationId: 9 };
    expect(mailboxOwnershipMatches(mailbox, 7, 9)).toBe(true);
    expect(mailboxOwnershipMatches(mailbox, 8, 9)).toBe(false);
    expect(mailboxOwnershipMatches(mailbox, 7, 10)).toBe(false);
    expect(userMailboxConnections.userId).toBeDefined();
    expect(userMailboxConnections.organisationId).toBeDefined();
  });

  it("uses delegated authorization without accepting an Outlook password", () => {
    expect(source).toContain('response_type: "code"');
    expect(source).toContain('"offline_access"');
    expect(source).toContain('"Mail.Read"');
    expect(source).toContain('"Mail.Send"');
    expect(source).not.toMatch(/outlookPassword|mailboxPassword/);
    expect(source).toContain("encryptConnectionSecret");
    expect(source).not.toContain("console.log");
  });

  it("requires an approved draft reference and honours email opt-outs", () => {
    expect(source).toContain(
      "An approved review reference is required before sending email."
    );
    expect(source).toContain("contactCommunicationSuppressions");
    expect(source).toContain("OUTBOUND_SUPPRESSED");
    expect(source).toContain('graph<void>(mailbox.accessToken, "/me/sendMail"');
  });

  it("uses the existing review queue for editable inbound reply drafts", () => {
    expect(source).toContain('workflowKey: "mailbox_inbound_reply"');
    expect(source).toContain('provider: "microsoft_delegated"');
    expect(source).toContain("reviewRequired: true");
    expect(source).toContain('agentKey: "communications"');
    expect(execution).toContain("sendDelegatedOutlookMail");
    expect(execution).toContain('route.provider === "microsoft_delegated"');
    for (const label of [
      "Recipient",
      "Subject",
      "Why a reply is needed",
      "Draft reply",
      "Save edit",
      "Send email",
      "Dismiss",
    ])
      expect(reviews).toContain(label);
  });

  it("bounds personal inbox reads and keeps them assigned to the mailbox owner", () => {
    expect(source).toContain("(inbox.value || []).slice(0, 25)");
    expect(source).toContain("mailboxUserId: input.userId");
    expect(source).toContain("lastSyncedAt: new Date()");
    expect(source).not.toContain("console.log");
  });
});
