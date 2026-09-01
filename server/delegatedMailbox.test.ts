import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { userMailboxConnections } from "../drizzle/schema";
import { mailboxOwnershipMatches, microsoftGraphUrl } from "./delegatedMailbox";

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
    expect(source).toContain('"Calendars.ReadWrite"');
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
    expect(source).toContain("delegatedMicrosoftGraphRequest<void>(");
    expect(source).toContain('"/me/sendMail"');
  });

  it("creates calendar invitations from the same delegated user account", () => {
    expect(source).toContain("createDelegatedOutlookCalendarEvent");
    expect(source).toContain('mailbox.accessToken, "/me/events"');
    expect(source).toContain("transactionId: input.reviewReference");
    expect(execution).toContain("createDelegatedOutlookCalendarEvent");
    expect(execution).toContain('route.provider !== "microsoft_delegated"');
    expect(execution).not.toContain("createOutlookCalendarEvent");
    expect(execution).not.toContain("getOutlookReadiness");
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

  it("paginates bounded inbox reads without skipping a busy mailbox", () => {
    expect(source).toContain("MAX_INBOX_SYNC_MESSAGES = 100");
    expect(source).toContain('$orderby: "receivedDateTime asc"');
    expect(source).toContain('page["@odata.nextLink"]');
    expect(source).toContain("morePagesPending: Boolean(next)");
    expect(source).toContain("newestProcessedAt.valueOf() - 1_000");
    expect(source).toContain("mailboxUserId: input.userId");
    expect(source).not.toContain("(inbox.value || []).slice(0, 25)");
  });

  it("accepts only Microsoft Graph paging URLs", () => {
    expect(
      microsoftGraphUrl(
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=abc"
      )
    ).toContain(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages"
    );
    expect(() =>
      microsoftGraphUrl("https://example.com/v1.0/me/messages")
    ).toThrow("unexpected host");
    expect(() => microsoftGraphUrl("relative-without-leading-slash")).toThrow(
      "path is invalid"
    );
  });

  it("cannot be activated by legacy shared-mailbox variables", () => {
    expect(source).not.toContain("process.env.OUTLOOK_TENANT_ID");
    expect(source).not.toContain("process.env.OUTLOOK_CLIENT_ID");
    expect(source).not.toContain("process.env.OUTLOOK_CLIENT_SECRET");
    expect(source).not.toContain("OUTLOOK_SENDER_EMAIL");
  });

  it("does not turn a Microsoft-accepted send into a retryable duplicate", () => {
    expect(execution).toContain(
      'eventType: "delegated_email_post_send_reconciliation_failed"'
    );
    expect(execution).toContain("The send must not be retried.");
    expect(execution).toContain("}).catch(() => undefined);");
    const delegatedBranch = execution.slice(
      execution.indexOf('route.provider === "microsoft_delegated"'),
      execution.indexOf(
        'if (input.proposal.actionType === "create_calendar_event")'
      )
    );
    expect(delegatedBranch).toContain("retryable: false");
  });
});
