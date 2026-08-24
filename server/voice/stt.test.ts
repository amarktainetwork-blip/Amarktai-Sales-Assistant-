import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeAudio, probeSttHealth, transcribeAudio } from "./stt";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STT_TRANSCRIPTIONS_URL;
  delete process.env.STT_HEALTH_URL;
  delete process.env.STT_MODEL;
});

describe("built-in speech transcription", () => {
  it("rejects malformed and oversized audio before network use", () => {
    expect(() => decodeAudio("not base64!")).toThrow("valid base64");
    expect(() => decodeAudio(Buffer.alloc(800_001).toString("base64"))).toThrow("too large");
  });

  it("probes health and sends actual multipart audio to the configured path", async () => {
    process.env.STT_TRANSCRIPTIONS_URL = "http://stt.test/inference";
    process.env.STT_HEALTH_URL = "http://stt.test/";
    process.env.STT_MODEL = "ggml-base-q5_1";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://stt.test/") return new Response("ok");
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ text: "The sales assistant voice test" }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeSttHealth()).resolves.toMatchObject({ ready: true });
    await expect(transcribeAudio(Buffer.from("RIFF-test-audio"), "audio/wav", "en")).resolves.toBe("The sales assistant voice test");
  });
});

