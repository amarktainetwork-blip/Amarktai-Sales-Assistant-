import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GenxCompanyLearningClient,
  selectCompanyLearningModel,
} from "./genxCompanyLearning";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("governed GenX whole-site client", () => {
  it("honours a live suitable override and otherwise selects a strong long-context text model", () => {
    const modelsPayload = {
      data: [
        { id: "tiny-fast", category: "text", context_window: 1_000_000 },
        { id: "frontier-opus", category: "text", context_window: 1_000_000 },
        { id: "image-only", category: "image", context_window: 2_000_000 },
      ],
    };
    const pricingPayload = { data: [{ model_id: "frontier-opus", input: 10 }] };
    expect(
      selectCompanyLearningModel({
        modelsPayload,
        pricingPayload,
        override: "tiny-fast",
      }).id
    ).toBe("tiny-fast");
    expect(
      selectCompanyLearningModel({
        modelsPayload,
        pricingPayload,
        override: "missing",
      }).id
    ).toBe("frontier-opus");
  });

  it("uses official catalogue, pricing, credits, file and session endpoints and cleans resources", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";
        calls.push({ url, method });
        if (url.endsWith("/models?category=text"))
          return json({
            data: [
              {
                id: "frontier-opus",
                category: "text",
                context_window: 1_000_000,
              },
            ],
          });
        if (url.endsWith("/account/pricing?category=text"))
          return json({ data: [{ model_id: "frontier-opus", input: 10 }] });
        if (url.endsWith("/account/credits")) return json({ balance: 10_000 });
        if (url.endsWith("/files") && method === "POST")
          return json({ id: "file-1" });
        if (url.endsWith("/sessions") && method === "POST")
          return json({ id: "session-1" });
        if (url.endsWith("/sessions/session-1/messages"))
          return json({
            content: '{"ok":true}',
            usage: { total_tokens: 42, credits: 0 },
          });
        if (url.endsWith("/sessions/session-1/close"))
          return json({ closed: true });
        if (url.endsWith("/files/file-1") && method === "DELETE")
          return new Response(null, { status: 204 });
        return json({ error: "unexpected" }, 404);
      }
    );
    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test_secret",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
      recordCredits: vi.fn(),
    });
    const selected = await client.selectModels();
    expect(selected.analysis.id).toBe("frontier-opus");
    const fileId = await client.uploadCorpus({
      jsonl: "{}",
      corpusHash: "a".repeat(64),
    });
    const sessionId = await client.createSession({
      model: selected.analysis.id,
      systemPrompt: "system",
      title: "title",
    });
    const response = await client.sendSessionMessage({
      sessionId,
      content: "analyse",
      fileIds: [fileId],
      idempotencyKey: "stable-key",
      billing: {
        userId: 1,
        organisationId: 1,
        feature: "test",
        reference: "test",
      },
    });
    expect(response.content).toBe('{"ok":true}');
    expect(await client.cleanup({ fileId, sessionIds: [sessionId] })).toEqual(
      []
    );
    expect(
      calls.map(call => `${call.method} ${new URL(call.url).pathname}`)
    ).toContain("POST /api/v1/sessions/session-1/close");
    expect(
      calls.map(call => `${call.method} ${new URL(call.url).pathname}`)
    ).toContain("DELETE /api/v1/files/file-1");
  });

  it("bounds retries to retryable failures", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      return attempts < 2
        ? json({ error: "temporary" }, 503)
        : json({ id: "file-after-retry" });
    });
    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
      retries: 1,
    });
    await expect(
      client.uploadCorpus({ jsonl: "{}", corpusHash: "b".repeat(64) })
    ).resolves.toBe("file-after-retry");
    expect(attempts).toBe(2);
  });

  it("never logs or persists the raw API key and keeps upstream branding out of customer adapters", () => {
    const clientSource = readFileSync(
      new URL("./genxCompanyLearning.ts", import.meta.url),
      "utf8"
    );
    const serviceSource = readFileSync(
      new URL("./companyIntelligenceService.ts", import.meta.url),
      "utf8"
    );
    expect(clientSource).not.toMatch(
      /console\.(?:log|error|warn)\([^)]*apiKey/
    );
    expect(clientSource).not.toMatch(/JSON\.stringify\([^)]*apiKey/);
    expect(serviceSource).not.toContain("selectedModels");
    expect(serviceSource).not.toContain("upstream provider");
  });
});
