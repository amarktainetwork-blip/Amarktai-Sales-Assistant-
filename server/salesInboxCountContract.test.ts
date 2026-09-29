import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./salesInbox.ts", import.meta.url),
  "utf8"
);
const today = readFileSync(
  new URL("./today.ts", import.meta.url),
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

  it("keeps Today's reply headline independent of its bounded message queue", () => {
    expect(today).toContain("inboundActionCountRows");
    expect(today).toContain("inboundNeedsAction: Number(inboundActionCountRows[0]?.total || 0)");
    expect(today).not.toContain("inboundNeedsAction: currentInbound.length");
    expect(today).not.toContain(".limit(600)");
  });
});
