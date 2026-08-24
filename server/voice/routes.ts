import type { Express, Request, Response } from "express";
import { recordAudit } from "../db";
import { requireLocalHttpContext } from "../httpAuth";
import { listTtsVoices, probeTtsHealth, synthesizeSpeech } from "./tts";

function sendError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED") return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED") return res.status(403).json({ error: "Second-factor verification is required." });
  if (/not configured|too long|required/i.test(detail)) return res.status(400).json({ error: detail });
  return res.status(502).json({ error: detail.slice(0, 300) || "Voice service request failed." });
}

async function authenticated(req: Request) {
  return requireLocalHttpContext(req);
}

export function registerVoiceRoutes(app: Express) {
  app.get("/api/voice/readiness", async (req, res) => {
    try {
      await authenticated(req);
      return res.json(await probeTtsHealth());
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.get("/api/voice/voices", async (req, res) => {
    try {
      await authenticated(req);
      return res.json({ voices: await listTtsVoices() });
    } catch (error) {
      return sendError(res, error);
    }
  });
  app.post("/api/voice/synthesize", async (req, res) => {
    try {
      const identity = await authenticated(req);
      const result = await synthesizeSpeech({
        text: typeof req.body?.text === "string" ? req.body.text : "",
        voice: typeof req.body?.voice === "string" ? req.body.voice.slice(0, 180) : undefined,
        lengthScale: typeof req.body?.lengthScale === "number" ? req.body.lengthScale : undefined,
      });
      await recordAudit({
        userId: identity.userId,
        organisationId: identity.membership.organisationId,
        eventType: "tts_audio_generated",
        entityType: "voice_generation",
        summary: "A reviewed text response was converted to a temporary audio artifact.",
        metadata: { voice: result.voice, textChars: result.textChars, audioBytes: result.bytes.length, rawTextRetained: false },
      });
      return res.json({
        contentType: result.contentType,
        audioBase64: result.bytes.toString("base64"),
        voice: result.voice,
        bytes: result.bytes.length,
        persisted: false,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
