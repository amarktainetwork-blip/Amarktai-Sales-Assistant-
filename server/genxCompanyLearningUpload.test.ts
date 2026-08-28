import { describe, expect, it, vi } from "vitest";
import { GenxCompanyLearningClient } from "./genxCompanyLearning";

describe("GenX company corpus upload compatibility", () => {
  it("uploads the unchanged JSONL corpus as a supported plain-text document", async () => {
    let capturedBody: FormData | undefined;
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as FormData;
        return new Response(JSON.stringify({ id: "file-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );
    const client = new GenxCompanyLearningClient({
      apiKey: "gnxk_test_secret",
      restBaseUrl: "https://query.test/api/v1",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const jsonl = '{"url":"https://example.com/a","text":"Alpha"}\n{"url":"https://example.com/b","text":"Beta"}';

    await expect(
      client.uploadCorpus({ jsonl, corpusHash: "a".repeat(64) })
    ).resolves.toBe("file-1");

    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody?.get("purpose")).toBe("company-learning");
    const file = capturedBody?.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe(
      "amarktai-company-corpus-aaaaaaaaaaaaaaaa.txt"
    );
    expect((file as Blob).type).toBe("text/plain");
    expect(await (file as Blob).text()).toBe(jsonl);
  });
});
