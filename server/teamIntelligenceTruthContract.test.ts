import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./teamIntelligence.ts", import.meta.url),
  "utf8"
);

describe("Team Intelligence source-truth contract", () => {
  it("does not silently cap organisation opportunities, open work or unanswered customers", () => {
    expect(source).not.toContain(".limit(5000)");
    expect(source).not.toContain(".limit(10_000)");
    expect(source).toContain("INCOMPLETE_TASK_STATUSES");
    expect(source).toContain("gte(crmActivities.occurredAt");
  });
});
