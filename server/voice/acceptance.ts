import { probeSttHealth, transcribeAudio } from "./stt";
import { probeTtsHealth, synthesizeSpeech } from "./tts";

export const VOICE_ACCEPTANCE_TEXT = "The sales assistant verifies this voice test.";
const EXPECTED_WORDS = ["sales", "assistant", "voice", "test"];

export async function verifyVoiceAcceptance() {
  const [sttHealth, ttsHealth] = await Promise.all([probeSttHealth(), probeTtsHealth()]);
  if (!sttHealth.ready) throw new Error(`STT_HEALTH_FAILED: ${sttHealth.reason || "unavailable"}`);
  if (!ttsHealth.ready) throw new Error(`TTS_HEALTH_FAILED: ${ttsHealth.reason || "unavailable"}`);
  const synthesis = await synthesizeSpeech({ text: VOICE_ACCEPTANCE_TEXT });
  if (synthesis.bytes.length < 1_000) throw new Error("TTS_ACCEPTANCE_AUDIO_TOO_SMALL");
  const transcript = await transcribeAudio(synthesis.bytes, synthesis.contentType, "en");
  const normalized = transcript.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const recognizedWords = EXPECTED_WORDS.filter(word => normalized.includes(word));
  if (recognizedWords.length < 3)
    throw new Error(`STT_ACCEPTANCE_TEXT_MISMATCH: recognized ${recognizedWords.length}/${EXPECTED_WORDS.length} expected words; transcript=${transcript.slice(0, 180)}`);
  return {
    verifiedAt: new Date().toISOString(),
    fixtureText: VOICE_ACCEPTANCE_TEXT,
    transcript,
    recognizedWords,
    audioBytes: synthesis.bytes.length,
    contentType: synthesis.contentType,
    voice: synthesis.voice,
    rawAudioRetained: false,
  };
}
