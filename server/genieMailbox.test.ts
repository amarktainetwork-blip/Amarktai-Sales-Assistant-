import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exactGenieMailboxIdentity,
  parseGenieReceivedAt,
} from "./genieMailbox";

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

  it("parses Genie's actual received timestamp and rejects invalid timestamp text", () => {
    const parsed = parseGenieReceivedAt("Sep 14, 2026 06:03 PM");
    expect(parsed).toBeInstanceOf(Date);
    expect(Number.isNaN(parsed?.getTime())).toBe(false);
    expect(parseGenieReceivedAt("not-a-time")).toBeNull();
    expect(parseGenieReceivedAt("")).toBeNull();
  });

  it("pins the shared Team-inbox worker to exact recipient identity and unread-only ingestion", () => {
    const source = readFileSync(
      new URL("./genieMailbox.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain('button[aria-label^="Unread"]');
    expect(source).not.toContain('button[aria-label="All"]');
    expect(source).toContain("verifiedUserCrmScope");
    expect(source).toContain("loadUserConnectionSecret");
    expect(source).toContain("crmUserExternalId");
    expect(source).toContain("crmUserEmail");
    expect(source).toContain("const toMatch = text.match(");
    expect(source).toContain("recipientEmail: recipient");
    expect(source).toContain("exactGenieMailboxIdentity");
    expect(source).toContain('label === "Mark as unread"');
    expect(source).toContain("await restoreUnreadState(page)");
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
