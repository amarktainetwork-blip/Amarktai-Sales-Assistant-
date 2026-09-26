import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeAudio,
  getSttConfiguration,
  getSttQueueLimits,
  probeSttHealth,
  requiresWhisperWavNormalization,
  transcribeAudio,
} from "./stt";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STT_TRANSCRIPTIONS_URL;
  delete process.env.STT_HEALTH_URL;
  delete process.env.STT_MODEL;
  delete process.env.STT_EN_TRANSCRIPTIONS_URL;
  delete process.env.STT_EN_HEALTH_URL;
  delete process.env.STT_EN_MODEL;
  delete process.env.STT_MAX_CONCURRENCY;
  delete process.env.STT_MAX_QUEUE;
});

describe("built-in speech transcription", () => {
  it("exposes bounded queue limits in readiness telemetry", () => {
    expect(getSttQueueLimits()).toEqual({ concurrency: 1, maxWaiting: 8 });
    process.env.STT_MAX_CONCURRENCY = "3";
    process.env.STT_MAX_QUEUE = "12";
    expect(getSttQueueLimits()).toEqual({ concurrency: 3, maxWaiting: 12 });
    expect(getSttConfiguration().queue).toMatchObject({
      concurrency: 3,
      maxWaiting: 12,
      active: 0,
      waiting: 0,
    });
  });

  it("normalizes browser recording formats to WAV for whisper.cpp", () => {
    expect(requiresWhisperWavNormalization("audio/webm")).toBe(true);
    expect(requiresWhisperWavNormalization("audio/ogg")).toBe(true);
    expect(requiresWhisperWavNormalization("audio/mp4")).toBe(true);
    expect(requiresWhisperWavNormalization("audio/mpeg")).toBe(true);
    expect(requiresWhisperWavNormalization("audio/wav")).toBe(false);
    expect(requiresWhisperWavNormalization("audio/x-wav")).toBe(false);
  });

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

  it("reports bounded queue telemetry for live-call capacity monitoring", async () => {
    process.env.STT_TRANSCRIPTIONS_URL = "http://stt.test/inference";
    process.env.STT_MODEL = "ggml-base-q5_1";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: "Measured transcript" }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const metrics: Array<{
      queueWaitMs: number;
      activeAtStart: number;
      waitingAtStart: number;
    }> = [];
    await expect(
      transcribeAudio(
        Buffer.from("RIFF-test-audio"),
        "audio/wav",
        "en",
        value => metrics.push(value)
      )
    ).resolves.toBe("Measured transcript");
    expect(metrics).toEqual([
      expect.objectContaining({
        queueWaitMs: 0,
        activeAtStart: 1,
        waitingAtStart: 0,
      }),
    ]);
  });

  it("routes English live audio to the fast lane and keeps multilingual fallback", async () => {
    process.env.STT_TRANSCRIPTIONS_URL = "http://stt.test/inference";
    process.env.STT_MODEL = "ggml-base-q5_1";
    process.env.STT_EN_TRANSCRIPTIONS_URL = "http://stt-en.test/inference";
    process.env.STT_EN_MODEL = "ggml-tiny.en-q5_1";
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      if (url === "http://stt-en.test/inference") {
        expect(form.get("model")).toBe("ggml-tiny.en-q5_1");
        expect(form.get("language")).toBe("en");
        return new Response(JSON.stringify({ text: "Fast English transcript" }));
      }
      expect(form.get("model")).toBe("ggml-base-q5_1");
      return new Response(JSON.stringify({ text: "Multilingual transcript" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudio(Buffer.from("RIFF-test-audio"), "audio/wav", "en-GB")
    ).resolves.toBe("Fast English transcript");
    await expect(
      transcribeAudio(Buffer.from("RIFF-test-audio"), "audio/wav", "fr-FR")
    ).resolves.toBe("Multilingual transcript");
    expect(urls).toEqual([
      "http://stt-en.test/inference",
      "http://stt.test/inference",
    ]);
  });

  it("falls back to the multilingual lane when the fast English lane is unavailable", async () => {
    process.env.STT_TRANSCRIPTIONS_URL = "http://stt.test/inference";
    process.env.STT_MODEL = "ggml-base-q5_1";
    process.env.STT_EN_TRANSCRIPTIONS_URL = "http://stt-en.test/inference";
    process.env.STT_EN_MODEL = "ggml-tiny.en-q5_1";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://stt-en.test/inference")
        return new Response("temporary failure", { status: 503 });
      return new Response(JSON.stringify({ text: "Fallback transcript" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudio(Buffer.from("RIFF-test-audio"), "audio/wav", "en")
    ).resolves.toBe("Fallback transcript");
  });
});
