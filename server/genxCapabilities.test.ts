import { afterAll, describe, expect, it, vi } from "vitest";
import { discoverGenxCapabilities, selectAdvertisedGenxModel } from "./genx";

const original = {
  endpoint: process.env.GENX_CHAT_COMPLETIONS_URL,
  key: process.env.GENX_API_KEY,
  model: process.env.GENX_DEFAULT_MODEL,
};

afterAll(() => {
  vi.unstubAllGlobals();
  if (original.endpoint === undefined) delete process.env.GENX_CHAT_COMPLETIONS_URL; else process.env.GENX_CHAT_COMPLETIONS_URL = original.endpoint;
  if (original.key === undefined) delete process.env.GENX_API_KEY; else process.env.GENX_API_KEY = original.key;
  if (original.model === undefined) delete process.env.GENX_DEFAULT_MODEL; else process.env.GENX_DEFAULT_MODEL = original.model;
});

describe("dynamic GenX capability discovery", () => {
  it("routes only explicitly advertised audio capabilities", async () => {
    process.env.GENX_CHAT_COMPLETIONS_URL = "https://genx.test/v1/chat/completions";
    process.env.GENX_API_KEY = "test-key";
    process.env.GENX_DEFAULT_MODEL = "text-model";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [
      { id: "text-model", capabilities: ["chat", "text"] },
      { id: "voice-model", modalities: ["text-to-speech", "audio"] },
      { id: "unknown-model" },
    ] })));
    const catalogue = await discoverGenxCapabilities({ force: true });
    expect(catalogue.capabilities.text).toContain("text-model");
    expect(catalogue.capabilities.text_to_speech).toContain("voice-model");
    await expect(selectAdvertisedGenxModel({ configuredModel: "voice-model", capability: "text_to_speech" })).resolves.toBe("voice-model");
    await expect(selectAdvertisedGenxModel({ configuredModel: "unknown-model", capability: "text_to_speech" })).resolves.toBeUndefined();
    await expect(selectAdvertisedGenxModel({ configuredModel: "missing", capability: "text" })).resolves.toBeUndefined();
  });
});
