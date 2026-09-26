import { describe, expect, it } from "vitest";
import {
  LIVE_AUDIO_MAX_WAITING_CHUNKS,
  audioFrameRms,
  hasEnoughVoicedAudio,
  isLikelySpeechFrame,
  transcriptionQueueHasCapacity,
} from "./liveAudioPipeline";

describe("live audio pipeline", () => {
  it("treats silence as silence", () => {
    const samples = new Float32Array(1600);
    expect(audioFrameRms(samples)).toBe(0);
    expect(isLikelySpeechFrame(samples)).toBe(false);
  });

  it("detects a speech-like frame above the RMS gate", () => {
    const samples = Float32Array.from({ length: 1600 }, (_, index) =>
      index % 2 ? 0.04 : -0.04
    );
    expect(audioFrameRms(samples)).toBeGreaterThan(0.006);
    expect(isLikelySpeechFrame(samples)).toBe(true);
  });

  it("requires enough voiced audio unless a clear peak was captured", () => {
    expect(
      hasEnoughVoicedAudio({
        voicedSamples: 100,
        sampleRate: 16_000,
        peakRms: 0.01,
      })
    ).toBe(false);
    expect(
      hasEnoughVoicedAudio({
        voicedSamples: 2_000,
        sampleRate: 16_000,
        peakRms: 0.01,
      })
    ).toBe(true);
    expect(
      hasEnoughVoicedAudio({
        voicedSamples: 50,
        sampleRate: 16_000,
        peakRms: 0.04,
      })
    ).toBe(true);
  });

  it("bounds queued transcription chunks", () => {
    expect(transcriptionQueueHasCapacity(0)).toBe(true);
    expect(
      transcriptionQueueHasCapacity(LIVE_AUDIO_MAX_WAITING_CHUNKS - 1)
    ).toBe(true);
    expect(
      transcriptionQueueHasCapacity(LIVE_AUDIO_MAX_WAITING_CHUNKS)
    ).toBe(false);
  });
});
