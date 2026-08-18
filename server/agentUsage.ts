export type UsageEventLike = { agentKey: string; cacheHit: boolean; inputTokens: number | null; outputTokens: number | null; inputChars: number; outputChars: number };

export function summarizeAgentUsageEvents(events: UsageEventLike[]) {
  const byAgent = new Map<string, { agentKey: string; requests: number; cacheHits: number; inputTokens: number; outputTokens: number; inputChars: number; outputChars: number }>();
  for (const event of events) {
    const current = byAgent.get(event.agentKey) ?? { agentKey: event.agentKey, requests: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0, inputChars: 0, outputChars: 0 };
    current.requests += 1;
    current.cacheHits += event.cacheHit ? 1 : 0;
    current.inputTokens += event.inputTokens ?? 0;
    current.outputTokens += event.outputTokens ?? 0;
    current.inputChars += event.inputChars;
    current.outputChars += event.outputChars;
    byAgent.set(event.agentKey, current);
  }
  return { totalRequests: events.length, cacheHits: events.filter(event => event.cacheHit).length, byAgent: Array.from(byAgent.values()).sort((a, b) => b.requests - a.requests) };
}
