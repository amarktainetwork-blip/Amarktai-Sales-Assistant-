export const LIVE_AUDIO_VAD_RMS = 0.006;
export const LIVE_AUDIO_MIN_VOICED_MS = 120;
export const LIVE_AUDIO_MAX_WAITING_CHUNKS = 3;
export const LIVE_AUDIO_MAX_LOCAL_BACKLOG_MS = 30_000;

export function audioFrameRms(samples: Float32Array) {
  if (!samples.length) return 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index++)
    energy += samples[index] * samples[index];
  return Math.sqrt(energy / samples.length);
}

export function isLikelySpeechFrame(
  samples: Float32Array,
  threshold = LIVE_AUDIO_VAD_RMS
) {
  return audioFrameRms(samples) >= threshold;
}

export function hasEnoughVoicedAudio(input: {
  voicedSamples: number;
  sampleRate: number;
  peakRms: number;
}) {
  const voicedMs =
    (Math.max(0, input.voicedSamples) / Math.max(1, input.sampleRate)) * 1000;
  return voicedMs >= LIVE_AUDIO_MIN_VOICED_MS || input.peakRms >= 0.035;
}

export function transcriptionQueueHasCapacity(
  waitingChunks: number,
  maxWaitingChunks = LIVE_AUDIO_MAX_WAITING_CHUNKS
) {
  return waitingChunks < maxWaitingChunks;
}
