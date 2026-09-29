import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

describe("approved knowledge scale contract", () => {
  it("does not discard older approved tenant sources before relevance ranking", () => {
    const start = source.indexOf("export async function searchApprovedKnowledge");
    const block = source.slice(start, start + 1400);
    expect(block).toContain("rankApprovedKnowledgeSources(sources, query)");
    expect(block).not.toContain(".limit(80)");
  });

  it("still bounds the final selected context after ranking", () => {
    const start = source.indexOf("export function rankApprovedKnowledgeSources");
    const block = source.slice(start, start + 4200);
    expect(block).toContain("if (selected.length >= 6) break");
  });
});
