import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Assistant approved-company-knowledge contract", () => {
  it("retrieves organisation-approved knowledge before calling GenX", () => {
    const routers = readFileSync(path.resolve("server/routers.ts"), "utf8");
    const chatStart = routers.indexOf("chat: secondFactorProcedure");
    const chatEnd = routers.indexOf("organisation: router", chatStart);
    const chat = routers.slice(chatStart, chatEnd);

    expect(chatStart).toBeGreaterThan(-1);
    expect(chat).toContain("searchApprovedKnowledge(");
    expect(chat).toContain("const approvedKnowledge = sources.length");
    expect(chat).toContain("const response = await runGenxAgent({");
    expect(chat).toContain("approvedKnowledge,");
    expect(chat.indexOf("searchApprovedKnowledge(")).toBeLessThan(
      chat.indexOf("const response = await runGenxAgent({")
    );
  });

  it("allows organisation-visible approved knowledge to be shared with teammates", () => {
    const db = readFileSync(path.resolve("server/db.ts"), "utf8");
    const searchStart = db.indexOf("export async function searchApprovedKnowledge");
    const searchEnd = db.indexOf("\nexport async function", searchStart + 1);
    const search = db.slice(searchStart, searchEnd > searchStart ? searchEnd : undefined);

    expect(searchStart).toBeGreaterThan(-1);
    expect(search).toContain("eq(knowledgeSources.status, \"ready\")");
    expect(search).toContain("eq(knowledgeSources.organisationId, organisationId)");
    expect(search).toContain("eq(knowledgeSources.visibility, \"organisation\")");
  });
});
