import { describe, expect, it } from "vitest";
import { nextPlaybookVersion, resolvePublishedPlaybook } from "./versioning";

describe("versioned playbook runtime boundary", () => {
  it("selects exactly one published revision and excludes newer drafts", () => {
    const selected = resolvePublishedPlaybook([
      { id: 1, playbookKey: "outreach", version: 1, status: "published" },
      { id: 2, playbookKey: "outreach", version: 2, status: "draft" },
    ], "outreach");
    expect(selected.id).toBe(1);
    expect(nextPlaybookVersion([{ version: 1 }, { version: 3 }])).toBe(4);
  });

  it("fails closed for missing or ambiguous published revisions", () => {
    expect(() => resolvePublishedPlaybook([], "outreach")).toThrow("PLAYBOOK_NOT_PUBLISHED");
    expect(() => resolvePublishedPlaybook([
      { id: 1, playbookKey: "outreach", version: 1, status: "published" },
      { id: 2, playbookKey: "outreach", version: 2, status: "published" },
    ], "outreach")).toThrow("PLAYBOOK_PUBLICATION_AMBIGUOUS");
  });
});
