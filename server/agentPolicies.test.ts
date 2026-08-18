import { describe, expect, it } from "vitest";
import { compactAgentMessages, createAgentRequestHash, getAgentPolicy, isAgentResponseFresh } from "./agentPolicies";

describe("agent policy efficiency controls", () => {
  it("uses a small live-coaching context budget", () => {
    const policy = getAgentPolicy("conversation_coach");
    expect(policy.maxMessages).toBe(3);
    expect(policy.maxInputChars).toBe(6_000);
  });
  it("keeps the newest messages within the policy budget", () => {
    const policy = { ...getAgentPolicy("conversation_coach"), maxMessages: 2, maxInputChars: 12 };
    const messages = compactAgentMessages([{ role: "user" as const, content: "older context" }, { role: "assistant" as const, content: "middle context" }, { role: "user" as const, content: "new context" }], policy);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("new context");
  });
  it("isolates cached requests when company context changes and respects expiry", () => {
    const policy = getAgentPolicy("communications");
    const base = { agentKey: "communications", messages: [{ role: "user" as const, content: "Draft a callback reply" }], policy };
    expect(createAgentRequestHash({ ...base, companyContext: "Brand voice: concise" })).not.toBe(createAgentRequestHash({ ...base, companyContext: "Brand voice: formal" }));
    expect(isAgentResponseFresh(new Date("2026-08-18T12:01:00.000Z"), new Date("2026-08-18T12:00:00.000Z"))).toBe(true);
    expect(isAgentResponseFresh(new Date("2026-08-18T11:59:00.000Z"), new Date("2026-08-18T12:00:00.000Z"))).toBe(false);
  });
});
