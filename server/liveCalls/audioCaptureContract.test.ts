import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../client/src/pages/LiveCalls.tsx", import.meta.url),
  "utf8"
);

describe("live call capture contract", () => {
  it("defaults to microphone capture and only requests display media for mixed mode", () => {
    expect(source).toContain('useState<CaptureMode>("microphone")');
    const microphoneReturn = source.indexOf('if (mode === "microphone")');
    const displayRequest = source.indexOf(
      "navigator.mediaDevices.getDisplayMedia"
    );
    expect(microphoneReturn).toBeGreaterThan(-1);
    expect(displayRequest).toBeGreaterThan(microphoneReturn);
  });

  it("enables browser echo and noise suppression", () => {
    expect(source).toContain("echoCancellation: true");
    expect(source).toContain("noiseSuppression: true");
    expect(source).toContain('highPass.type = "highpass"');
    expect(source).toContain("createDynamicsCompressor()");
  });

  it("gates silence and bounds STT backlog instead of building unlimited latency", () => {
    expect(source).toContain("hasEnoughVoicedAudio");
    expect(source).toContain("LIVE_AUDIO_MAX_WAITING_CHUNKS");
    expect(source).toContain("LIVE_AUDIO_MAX_LOCAL_BACKLOG_MS");
    expect(source).toContain("Live transcription paused because speech processing fell more than 30 seconds behind");
    expect(source).toContain("pendingChunkCountRef.current += 1");
    expect(source).toContain("pendingChunkCountRef.current - 1");
  });

  it("fully tears down a backpressured capture loop before retry", () => {
    expect(source).toContain("window.clearInterval(chunkTimerRef.current)");
    expect(source).toContain("processor.onaudioprocess = null");
    expect(source).toContain("source.disconnect()");
    expect(source).toContain("void context.close().catch(() => undefined)");
  });
});
