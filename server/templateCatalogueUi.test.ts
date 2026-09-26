import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const studio = readFileSync(
  new URL("../client/src/components/SkillStudio.tsx", import.meta.url),
  "utf8"
);
const assistant = readFileSync(
  new URL("./assistantRoutes.ts", import.meta.url),
  "utf8"
);
const approved = readFileSync(
  new URL("./approvedTemplates.ts", import.meta.url),
  "utf8"
);

describe("Genie template catalogue management", () => {
  it("requires manager review before an imported draft becomes usable", () => {
    expect(studio).toContain("Review exact stored content");
    expect(studio).toContain("Publish for Review use");
    expect(studio).toContain("/api/team-admin/approval-templates/");
    expect(studio).toContain("does not send a message or change Genie");
    expect(studio).toContain("Imported templates stay drafts");
  });

  it("supports searching real catalogue metadata", () => {
    expect(studio).toContain("Search templates, subject or channel");
    expect(studio).toContain("template.metadata?.subject");
    expect(studio).toContain("template.metadata?.channel");
    expect(studio).toContain("template.metadata?.sourceReference");
  });

  it("exposes only published catalogue templates to Assistant", () => {
    expect(approved).toContain("listPublishedCommunicationTemplates");
    expect(approved).toContain('eq(approvalTemplates.status, "published")');
    expect(assistant).toContain("listPublishedCommunicationTemplates");
    expect(assistant).toContain('source: "approved_genie_catalogue"');
    expect(assistant).toContain("approved for review-controlled use");
  });
});
