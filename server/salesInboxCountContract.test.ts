import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./salesInbox.ts", import.meta.url),
  "utf8"
);

describe("Sales Inbox truth-count contract", () => {
  it("counts the complete actionable source independently of the displayed page limit", () => {
    expect(source).toContain("const [rows, countRows] = await Promise.all");
    expect(source).toContain("total: count()");
    expect(source).toContain("saleIntent: sql<number>");
    expect(source).toContain("needsActionCount: Number(totals?.total || 0)");
    expect(source).not.toContain(
      "needsActionCount: messages.filter(message => message.needsAction).length"
    );
  });
});
