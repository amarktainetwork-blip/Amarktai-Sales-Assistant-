const MAX_AUDIO_BYTES = 800_000;
const DEFAULT_TIMEOUT_MS = 45_000;

export const ALLOWED_STT_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
]);

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

let activeTranscriptions = 0;
let waitingTranscriptions = 0;

async function enterQueue() {
  const concurrency = Math.min(8, positiveInt(process.env.STT_MAX_CONCURRENCY, 1));
  const maxWaiting = Math.min(40, positiveInt(process.env.STT_MAX_QUEUE, 8));
  if (activeTranscriptions < concurrency) {
    activeTranscriptions += 1;
    return;
  }
  if (waitingTranscriptions >= maxWaiting)
    throw new Error("Speech transcription is busy. Wait a moment, then retry this audio chunk.");
  waitingTranscriptions += 1;
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (activeTranscriptions < concurrency) {
        clearInterval(timer);
        waitingTranscriptions -= 1;
        activeTranscriptions += 1;
        resolve();
      } else if (Date.now() - started > 15_000) {
        clearInterval(timer);
        waitingTranscriptions -= 1;
        reject(new Error("Speech transcription queue timed out. Retry this audio chunk."));
      }
    }, 50);
    timer.unref?.();
  });
}

function leaveQueue() {
  activeTranscriptions = Math.max(0, activeTranscriptions - 1);
}

export function decodeAudio(input: unknown) {
  if (typeof input !== "string" || input.length < 8) throw new Error("Audio data is missing.");
  const normalized = input.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0)
    throw new Error("Audio data is not valid base64.");
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw new Error("Audio data is empty.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Audio chunk is too large; use shorter chunks.");
  return bytes;
}

export function getSttConfiguration() {
  const endpoint = process.env.STT_TRANSCRIPTIONS_URL?.trim();
  const model = process.env.STT_MODEL?.trim();
  return {
    configured: Boolean(endpoint && model),
    endpoint,
    model,
    provider: process.env.STT_PROVIDER_LABEL?.trim() || "Self-hosted whisper.cpp",
    queue: { active: activeTranscriptions, waiting: waitingTranscriptions },
  };
}

export async function probeSttHealth() {
  const configuration = getSttConfiguration();
  if (!configuration.configured || !configuration.endpoint)
    return { ...configuration, ready: false, reason: "NOT_CONFIGURED" as const };
  const endpoint = new URL(configuration.endpoint);
  const healthUrl = process.env.STT_HEALTH_URL?.trim() || `${endpoint.origin}/`;
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
    return response.ok
      ? { ...configuration, ready: true, reason: null }
      : { ...configuration, ready: false, reason: `HEALTH_HTTP_${response.status}` };
  } catch (error) {
    return {
      ...configuration,
      ready: false,
      reason: error instanceof Error ? error.message.slice(0, 160) : "HEALTH_CHECK_FAILED",
    };
  }
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg")) return "mp3";
  return "webm";
}

export async function transcribeAudio(bytes: Buffer, mimeType: string, language?: string) {
  const { endpoint, model } = getSttConfiguration();
  if (!endpoint || !model) throw new Error("Speech-to-text is not configured.");
  if (!ALLOWED_STT_MIME.has(mimeType)) throw new Error("Unsupported audio type.");
  await enterQueue();
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), `call-chunk.${extensionFor(mimeType)}`);
    form.append("model", model);
    form.append("response_format", "json");
    if (language && /^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/.test(language)) form.append("language", language);
    const headers: Record<string, string> = {};
    if (process.env.STT_API_KEY?.trim()) headers.Authorization = `Bearer ${process.env.STT_API_KEY.trim()}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(Math.min(90_000, positiveInt(process.env.STT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS))),
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`Speech-to-text failed with ${response.status}${raw ? `: ${raw.slice(0, 240)}` : ""}`);
    if (!raw.trim()) return "";
    try {
      return ((JSON.parse(raw) as { text?: string }).text || "").trim();
    } catch {
      return raw.trim();
    }
  } finally {
    leaveQueue();
  }
}
