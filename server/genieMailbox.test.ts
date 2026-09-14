import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exactGenieMailboxIdentity } from "./genieMailbox";

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
    expect(source).not.toContain("mappedOwnerLabelMatches");
  });
});
