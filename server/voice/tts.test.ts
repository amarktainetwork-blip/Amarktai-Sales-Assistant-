import { afterEach, describe, expect, it, vi } from "vitest";
import { listTtsVoices, probeTtsHealth, synthesizeSpeech } from "./tts";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TTS_BASE_URL;
  delete process.env.TTS_APPROVED_VOICES;
  delete process.env.TTS_DEFAULT_VOICE;
});

describe("built-in speech synthesis", () => {
  it("lists only approved profiles and returns non-empty playable audio", async () => {
    process.env.TTS_BASE_URL = "http://tts.test";
    process.env.TTS_APPROVED_VOICES = "en_US-lessac-medium";
    const audio = Buffer.alloc(1_204);
    audio.write("RIFF", 0, "ascii");
    audio.write("WAVE", 8, "ascii");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/info")) return new Response("ok");
      if (url.endsWith("/voices")) return Response.json({
        "en_US-lessac-medium": { name: "Lessac", language: { code: "en-US" } },
        "unapproved-voice": { name: "Other", language: { code: "en-US" } },
      });
      return new Response(audio, { headers: { "content-type": "text/html; charset=utf-8" } });
    }));
    await expect(probeTtsHealth()).resolves.toMatchObject({ ready: true });
    await expect(listTtsVoices()).resolves.toEqual([{ id: "en_US-lessac-medium", name: "Lessac", language: "en-US", speakers: [] }]);
    await expect(synthesizeSpeech({ text: "Approved text" })).resolves.toMatchObject({ contentType: "audio/wav", voice: "en_US-lessac-medium", textChars: 13 });
    await expect(synthesizeSpeech({ text: "No", voice: "unapproved-voice" })).rejects.toThrow("not approved");
  });
});
