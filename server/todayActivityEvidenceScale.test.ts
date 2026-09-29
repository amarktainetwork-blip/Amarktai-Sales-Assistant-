import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./today.ts", import.meta.url), "utf8");

describe("Today activity-evidence scale contract", () => {
  it("uses a recent time window instead of a silent 5,000-row ceiling", () => {
    const marker = source.indexOf("const recentTaskActivities");
    const block = source.slice(marker, marker + 1800);
    expect(block).toContain("30 * 86_400_000");
    expect(block).toContain("gte(");
    expect(block).not.toContain(".limit(5000)");
  });
});
