export type TtsVoice = { id: string; name: string; language: string | null; speakers: string[] };

function endpoint() {
  return process.env.TTS_BASE_URL?.trim()?.replace(/\/$/, "") || "";
}

export function approvedTtsVoiceIds() {
  const configured = process.env.TTS_APPROVED_VOICES?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  return Array.from(new Set(configured.length ? configured : [getTtsConfiguration().defaultVoice]));
}

export function getTtsConfiguration() {
  const baseUrl = endpoint();
  return {
    configured: Boolean(baseUrl),
    provider: process.env.TTS_PROVIDER_LABEL?.trim() || "Self-hosted Piper",
    defaultVoice: process.env.TTS_DEFAULT_VOICE?.trim() || "en_US-lessac-medium",
  };
}

export async function probeTtsHealth() {
  const configuration = getTtsConfiguration();
  if (!configuration.configured)
    return { ...configuration, ready: false, reason: "NOT_CONFIGURED" as const };
  try {
    const response = await fetch(`${endpoint()}/info`, { signal: AbortSignal.timeout(5_000) });
    return response.ok
      ? { ...configuration, ready: true, reason: null }
      : { ...configuration, ready: false, reason: `HEALTH_HTTP_${response.status}` };
  } catch (error) {
    return { ...configuration, ready: false, reason: error instanceof Error ? error.message.slice(0, 160) : "HEALTH_CHECK_FAILED" };
  }
}

export async function listTtsVoices(): Promise<TtsVoice[]> {
  if (!endpoint()) return [];
  const response = await fetch(`${endpoint()}/voices`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Voice list failed with ${response.status}.`);
  const payload = (await response.json()) as unknown;
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? Object.entries(payload as Record<string, unknown>).map(([id, value]) => ({ id, ...(value && typeof value === "object" ? value : {}) }))
      : [];
  const approved = new Set(approvedTtsVoiceIds());
  return records.slice(0, 100).map((value, index) => {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const id = String(record.id || record.key || record.name || `voice-${index + 1}`);
    const language = record.language && typeof record.language === "object"
      ? String((record.language as Record<string, unknown>).code || "") || null
      : typeof record.language === "string" ? record.language : null;
    return {
      id,
      name: String(record.name || id),
      language,
      speakers: Array.isArray(record.speakers) ? record.speakers.map(String).slice(0, 50) : [],
    };
  }).filter(voice => approved.has(voice.id));
}

export async function synthesizeSpeech(input: { text: string; voice?: string; lengthScale?: number }) {
  const configuration = getTtsConfiguration();
  if (!configuration.configured) throw new Error("Text-to-speech is not configured.");
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Text is required for speech generation.");
  if (text.length > 5_000) throw new Error("Speech text is too long. Use 5,000 characters or fewer.");
  const voice = input.voice || configuration.defaultVoice;
  if (!approvedTtsVoiceIds().includes(voice))
    throw new Error("This voice profile is not approved for the workspace service.");
  const lengthScale = Math.min(2, Math.max(0.5, input.lengthScale || 1));
  const response = await fetch(`${endpoint()}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice, length_scale: lengthScale }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech generation failed with ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 44) throw new Error("Speech generation returned an empty or invalid audio artifact.");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "audio/wav";
  if (!contentType.startsWith("audio/")) throw new Error("Speech generation did not return playable audio.");
  return { bytes, contentType, voice, textChars: text.length };
}
