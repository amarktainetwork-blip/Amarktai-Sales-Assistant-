import { describe, expect, it } from "vitest";
import { summarizeAgentUsageEvents } from "./agentUsage";

describe("agent usage ledger", () => {
  it("aggregates provider usage, character fallback, and cache hits by specialist", () => {
    const summary = summarizeAgentUsageEvents([
      { agentKey: "communications", cacheHit: false, inputTokens: 120, outputTokens: 80, inputChars: 700, outputChars: 340 },
      { agentKey: "communications", cacheHit: true, inputTokens: null, outputTokens: null, inputChars: 700, outputChars: 340 },
      { agentKey: "knowledge_guide", cacheHit: false, inputTokens: 200, outputTokens: 100, inputChars: 1200, outputChars: 500 },
    ]);
    expect(summary.totalRequests).toBe(3);
    expect(summary.cacheHits).toBe(1);
    expect(summary.byAgent.find(item => item.agentKey === "communications")).toMatchObject({ requests: 2, cacheHits: 1, inputTokens: 120, outputTokens: 80 });
  });
});
