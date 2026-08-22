import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { getLocalSessionUser, isLocalAuthMode } from "../localAuth";
import { TWO_FACTOR_COOKIE, verifyTwoFactorSession } from "../twoFactor";
import { sdk } from "../_core/sdk";
import { appendLiveTranscript, createWorkflowRun } from "../db";
import { prepareLiveCoachingTip, preparePostCallSummary } from "../liveCoach";
import { ensureDefaultOrganisation } from "../organisation";
import { listConnectedSystemsForUser } from "../connectedSystems";
import { routeConnectedSystemActions } from "../crmRouter";
import { detectLiveSignals } from "./signals";
import { completeLiveCallExact, requireLiveCallOwner } from "./store";

const MAX_AUDIO_BYTES = 800_000;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg"]);
type Authenticated = { id: number };

async function requireAuthorisedUser(req: Request): Promise<Authenticated> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const user = isLocalAuthMode() ? await getLocalSessionUser(cookies[COOKIE_NAME]) : await sdk.authenticateRequest(req);
  if (!user || ("isCron" in user && user.isCron)) throw new Error("AUTH_REQUIRED");
  const verified = await verifyTwoFactorSession(cookies[TWO_FACTOR_COOKIE], user.id);
  if (!verified) throw new Error("TWO_FACTOR_REQUIRED");
  return { id: user.id };
}
function transcriptionReadiness() { return { ready: Boolean(process.env.STT_TRANSCRIPTIONS_URL?.trim() && process.env.STT_MODEL?.trim()), provider: process.env.STT_PROVIDER_LABEL?.trim() || "Configured speech-to-text service" }; }
function decodedAudio(input: unknown) {
  if (typeof input !== "string" || input.length < 8) throw new Error("Audio data is missing.");
  const bytes = Buffer.from(input, "base64");
  if (!bytes.length) throw new Error("Audio data is empty.");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Audio chunk is too large; use shorter chunks.");
  return bytes;
}
async function transcribe(bytes: Buffer, mimeType: string, language?: string) {
  const url = process.env.STT_TRANSCRIPTIONS_URL?.trim(); const model = process.env.STT_MODEL?.trim();
  if (!url || !model) throw new Error("Speech-to-text is not configured.");
  const form = new FormData();
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "webm";
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), `call-chunk.${extension}`); form.append("model", model); form.append("response_format", "json");
  if (language && /^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/.test(language)) form.append("language", language);
  const headers: Record<string, string> = {}; if (process.env.STT_API_KEY?.trim()) headers.Authorization = `Bearer ${process.env.STT_API_KEY.trim()}`;
  const response = await fetch(url, { method: "POST", headers, body: form, signal: AbortSignal.timeout(45_000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Speech-to-text failed with ${response.status}${raw ? `: ${raw.slice(0, 240)}` : ""}`);
  if (!raw.trim()) return "";
  try { return ((JSON.parse(raw) as { text?: string }).text || "").trim(); } catch { return raw.trim(); }
}
function sendLiveCallError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  if (detail === "Live call session was not found.") return res.status(404).json({ error: detail });
  if (detail === "Speech-to-text is not configured.") return res.status(503).json({ error: detail });
  if (/AI Credit/i.test(detail)) return res.status(402).json({ error: detail });
  console.error(JSON.stringify({ event: "live_call_api_error", detail: detail.slice(0, 300) }));
  return res.status(502).json({ error: detail.slice(0, 300) || "Live Call Companion request failed." });
}

export function registerLiveCallRoutes(app: Express) {
  app.get("/api/live-calls/readiness", async (req, res) => {
    try { await requireAuthorisedUser(req); return res.json(transcriptionReadiness()); }
    catch (error) { return sendLiveCallError(res, error); }
  });

  app.post("/api/live-calls/transcribe", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req); const callSessionId = Number(req.body?.callSessionId);
      if (!Number.isInteger(callSessionId) || callSessionId <= 0) return res.status(400).json({ error: "A valid live call session is required." });
      await requireLiveCallOwner(user.id, callSessionId);
      const mimeType = String(req.body?.mimeType || "").split(";")[0].toLowerCase();
      if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: "Unsupported audio type." });
      const durationMs = Math.max(0, Math.min(15_000, Number(req.body?.durationMs || 0))); const bytes = decodedAudio(req.body?.audioBase64);
      const text = await transcribe(bytes, mimeType, typeof req.body?.language === "string" ? req.body.language : undefined); const signals = detectLiveSignals(text);
      if (text) await appendLiveTranscript({ userId: user.id, callSessionId, transcriptChunk: text });
      console.log(JSON.stringify({ event: "live_call_transcription_chunk", userId: user.id, callSessionId, bytes: bytes.length, durationMs, textChars: text.length, signalTypes: signals.map(signal => signal.type) }));
      return res.json({ text, signals, durationMs, rawAudioRetained: false });
    } catch (error) { return sendLiveCallError(res, error); }
  });

  app.post("/api/live-calls/coach", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req); const callSessionId = Number(req.body?.callSessionId);
      const leadLabel = typeof req.body?.leadLabel === "string" ? req.body.leadLabel.trim().slice(0, 160) : ""; const transcriptChunk = typeof req.body?.transcriptChunk === "string" ? req.body.transcriptChunk.trim().slice(-8_000) : "";
      if (!Number.isInteger(callSessionId) || callSessionId <= 0 || !leadLabel || transcriptChunk.length < 2) return res.status(400).json({ error: "A live call, contact and transcript segment are required." });
      await requireLiveCallOwner(user.id, callSessionId); const organisation = await ensureDefaultOrganisation(user.id);
      const result = await prepareLiveCoachingTip({ leadLabel, transcript: transcriptChunk, billing: { userId: user.id, organisationId: organisation.organisationId, feature: "live_call_coaching", reference: `call:${callSessionId}` } });
      console.log(JSON.stringify({ event: "live_call_coaching", userId: user.id, callSessionId, transcriptChars: transcriptChunk.length, genxUsage: result.usage ?? {}, creditsCharged: result.creditsCharged ?? 0 }));
      return res.json({ content: result.content, usage: result.usage ?? {}, creditsCharged: result.creditsCharged ?? 0 });
    } catch (error) { return sendLiveCallError(res, error); }
  });

  app.post("/api/live-calls/complete", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req); const callSessionId = Number(req.body?.callSessionId);
      const leadLabel = typeof req.body?.leadLabel === "string" ? req.body.leadLabel.trim().slice(0, 160) : ""; const transcript = typeof req.body?.transcript === "string" ? req.body.transcript.trim().slice(-40_000) : "";
      if (!Number.isInteger(callSessionId) || callSessionId <= 0 || !leadLabel || transcript.length < 4) return res.status(400).json({ error: "A live call, contact and transcript are required." });
      await requireLiveCallOwner(user.id, callSessionId); const organisation = await ensureDefaultOrganisation(user.id);
      const summary = await preparePostCallSummary({ leadLabel, transcript, billing: { userId: user.id, organisationId: organisation.organisationId, feature: "post_call_summary", reference: `call:${callSessionId}` } });
      await completeLiveCallExact({ userId: user.id, callSessionId, transcript, summary: summary.content });

      const systems = await listConnectedSystemsForUser(user.id, organisation.organisationId);
      const proposed = routeConnectedSystemActions([{ actionType: "append_contact_note", title: "Add factual post-call summary to CRM", targetLabel: leadLabel, idempotencyKey: `live-call:${callSessionId}:summary-note`, payload: { reviewRequired: true, content: summary.content, sourceCallSessionId: callSessionId, contactExternalId: typeof req.body?.contactExternalId === "string" ? req.body.contactExternalId.trim().slice(0, 180) : undefined } }], systems);
      const workflowRunId = await createWorkflowRun({ userId: user.id, workflowKey: "post_call_closeout", leadLabel, payload: { sourceCallSessionId: callSessionId }, verificationSummary: "Review the factual call summary before writing it to the verified CRM. Add any promised task/message as a separate governed action if it was explicitly agreed during the conversation.", actions: proposed });
      const blockedActionCount = proposed.filter(action => (action.payload.crmRoute as { routable?: boolean } | undefined)?.routable === false).length;
      console.log(JSON.stringify({ event: "live_call_completed", userId: user.id, callSessionId, transcriptChars: transcript.length, genxUsage: summary.usage ?? {}, creditsCharged: summary.creditsCharged ?? 0, workflowRunId, blockedActionCount }));
      return res.json({ content: summary.content, usage: summary.usage ?? {}, creditsCharged: summary.creditsCharged ?? 0, closeoutWorkflowRunId: workflowRunId, closeoutActionCount: proposed.length, blockedActionCount });
    } catch (error) { return sendLiveCallError(res, error); }
  });
}
