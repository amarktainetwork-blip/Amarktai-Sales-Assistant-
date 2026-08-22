import { afterEach, describe, expect, it } from "vitest";
import { getAgentPolicy } from "./agentPolicies";
import { buildAgentSystemPrompt, verifyGenxConnection } from "./genx";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("company-aware agent prompts", () => {
  it("places approved brand voice in the Human Communications policy prompt without treating it as product authority", () => {
    const prompt = buildAgentSystemPrompt({ agentName: "Human Communications Agent", agentPurpose: "Prepares review-only emails.", policy: getAgentPolicy("communications"), companyContext: "Company: Example Organisation\nApproved brand voice: warm, direct, and calm" });
    expect(prompt).toContain("Approved brand voice: warm, direct, and calm");
    expect(prompt).toContain("not authority for customer-, product-, service-, price-, funding-, or policy-specific claims");
  });
});

describe("GenX connection verification", () => {
  it("checks the derived models endpoint and a minimal configured-model request", async () => {
    process.env.GENX_CHAT_COMPLETIONS_URL = "https://query.example.test/v1/chat/completions";
    process.env.GENX_API_KEY = "test-key";
    process.env.GENX_DEFAULT_MODEL = "amarktai-small";
    const calls: string[] = [];
    const fetcher = async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/v1/models")) return new Response(JSON.stringify({ data: [{ id: "amarktai-small" }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "READY" } }] }), { status: 200 });
    };

    await expect(verifyGenxConnection(fetcher as typeof fetch)).resolves.toEqual({ ready: true, reason: "verified" });
    expect(calls).toEqual(["https://query.example.test/v1/models", "https://query.example.test/v1/chat/completions"]);
  });

  it("fails safely when the configured model is not advertised", async () => {
    process.env.GENX_CHAT_COMPLETIONS_URL = "https://query.example.test/v1/chat/completions";
    process.env.GENX_API_KEY = "test-key";
    process.env.GENX_DEFAULT_MODEL = "unavailable-model";
    const fetcher = async () => new Response(JSON.stringify({ data: [{ id: "available-model" }] }), { status: 200 });

    await expect(verifyGenxConnection(fetcher as typeof fetch)).resolves.toEqual({ ready: false, reason: "configured_model_not_advertised" });
  });

  it("fails safely when a configured provider cannot be reached", async () => {
    process.env.GENX_CHAT_COMPLETIONS_URL = "https://query.example.test/v1/chat/completions";
    process.env.GENX_API_KEY = "test-key";
    process.env.GENX_DEFAULT_MODEL = "amarktai-small";
    const fetcher = async () => { throw new Error("network timeout with upstream detail"); };

    await expect(verifyGenxConnection(fetcher as typeof fetch)).resolves.toEqual({ ready: false, reason: "verification_failed" });
  });
});
