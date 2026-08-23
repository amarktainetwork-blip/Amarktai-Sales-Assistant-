import type { Express, Request, Response } from "express";
import { requireLocalHttpContext } from "../httpAuth";
import {
  appendLiveTranscript,
  createWorkflowRun,
  listActionProposals,
} from "../db";
import { prepareLiveCoachingTip, preparePostCallSummary } from "../liveCoach";
import type { OrganisationMembership } from "../organisation";
import { listConnectedSystemsForUser } from "../connectedSystems";
import { routeConnectedSystemActions } from "../crmRouter";
import { detectLiveSignals } from "./signals";
import { completeLiveCallExact, requireLiveCallOwner } from "./store";
import {
  TELESALES_OUTCOMES,
  planTelesalesCloseout,
  type TelesalesOutcome,
} from "../telesales/closeoutPlanner";
import { getAutomationPolicy } from "../automationPolicy";
import { executeAutoPreapprovedActions } from "../governedActions";

const MAX_AUDIO_BYTES = 800_000;
const ALLOWED_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
]);
type Authenticated = { id: number; membership: OrganisationMembership };

async function requireAuthorisedUser(req: Request): Promise<Authenticated> {
  const identity = await requireLocalHttpContext(req);
  return { id: identity.userId, membership: identity.membership };
}

function transcriptionReadiness() {
  return {
    ready: Boolean(
      process.env.STT_TRANSCRIPTIONS_URL?.trim() &&
        process.env.STT_MODEL?.trim()
    ),
    provider:
      process.env.STT_PROVIDER_LABEL?.trim() ||
      "Configured speech-to-text service",
  };
}

function decodedAudio(input: unknown) {
  if (typeof input !== "string" || input.length < 8)
    throw new Error("Audio data is missing.");
  const bytes = Buffer.from(input, "base64");
  if (!bytes.length) throw new Error("Audio data is empty.");
  if (bytes.length > MAX_AUDIO_BYTES)
    throw new Error("Audio chunk is too large; use shorter chunks.");
  return bytes;
}

async function transcribe(bytes: Buffer, mimeType: string, language?: string) {
  const url = process.env.STT_TRANSCRIPTIONS_URL?.trim();
  const model = process.env.STT_MODEL?.trim();
  if (!url || !model) throw new Error("Speech-to-text is not configured.");
  const form = new FormData();
  const extension = mimeType.includes("ogg")
    ? "ogg"
    : mimeType.includes("mp4")
      ? "m4a"
      : mimeType.includes("wav")
        ? "wav"
        : mimeType.includes("mpeg")
          ? "mp3"
          : "webm";
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    `call-chunk.${extension}`
  );
  form.append("model", model);
  form.append("response_format", "json");
  if (language && /^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})?$/.test(language))
    form.append("language", language);
  const headers: Record<string, string> = {};
  if (process.env.STT_API_KEY?.trim())
    headers.Authorization = `Bearer ${process.env.STT_API_KEY.trim()}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new Error(
      `Speech-to-text failed with ${response.status}${raw ? `: ${raw.slice(0, 240)}` : ""}`
    );
  if (!raw.trim()) return "";
  try {
    return ((JSON.parse(raw) as { text?: string }).text || "").trim();
  } catch {
    return raw.trim();
  }
}

function sendLiveCallError(res: Response, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "AUTH_REQUIRED")
    return res.status(401).json({ error: "Authentication is required." });
  if (detail === "TWO_FACTOR_REQUIRED")
    return res
      .status(403)
      .json({ error: "Second-factor verification is required." });
  if (detail === "Live call session was not found.")
    return res.status(404).json({ error: detail });
  if (detail === "Speech-to-text is not configured.")
    return res.status(503).json({ error: detail });
  if (/AI Credit/i.test(detail)) return res.status(402).json({ error: detail });
  console.error(
    JSON.stringify({
      event: "live_call_api_error",
      detail: detail.slice(0, 300),
    })
  );
  return res
    .status(502)
    .json({
      error: detail.slice(0, 300) || "Live Call Companion request failed.",
    });
}

export function registerLiveCallRoutes(app: Express) {
  app.get("/api/live-calls/readiness", async (req, res) => {
    try {
      await requireAuthorisedUser(req);
      return res.json(transcriptionReadiness());
    } catch (error) {
      return sendLiveCallError(res, error);
    }
  });

  app.post("/api/live-calls/transcribe", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req);
      const callSessionId = Number(req.body?.callSessionId);
      if (!Number.isInteger(callSessionId) || callSessionId <= 0)
        return res
          .status(400)
          .json({ error: "A valid live call session is required." });
      await requireLiveCallOwner(
        user.id,
        user.membership.organisationId,
        callSessionId
      );
      const mimeType = String(req.body?.mimeType || "")
        .split(";")[0]
        .toLowerCase();
      if (!ALLOWED_MIME.has(mimeType))
        return res.status(400).json({ error: "Unsupported audio type." });
      const durationMs = Math.max(
        0,
        Math.min(15_000, Number(req.body?.durationMs || 0))
      );
      const bytes = decodedAudio(req.body?.audioBase64);
      const text = await transcribe(
        bytes,
        mimeType,
        typeof req.body?.language === "string" ? req.body.language : undefined
      );
      const signals = detectLiveSignals(text);
      if (text)
        await appendLiveTranscript({
          userId: user.id,
          organisationId: user.membership.organisationId,
          callSessionId,
          transcriptChunk: text,
        });
      console.log(
        JSON.stringify({
          event: "live_call_transcription_chunk",
          userId: user.id,
          callSessionId,
          bytes: bytes.length,
          durationMs,
          textChars: text.length,
          signalTypes: signals.map(signal => signal.type),
        })
      );
      return res.json({ text, signals, durationMs, rawAudioRetained: false });
    } catch (error) {
      return sendLiveCallError(res, error);
    }
  });

  app.post("/api/live-calls/coach", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req);
      const callSessionId = Number(req.body?.callSessionId);
      const leadLabel =
        typeof req.body?.leadLabel === "string"
          ? req.body.leadLabel.trim().slice(0, 160)
          : "";
      const transcriptChunk =
        typeof req.body?.transcriptChunk === "string"
          ? req.body.transcriptChunk.trim().slice(-8_000)
          : "";
      if (
        !Number.isInteger(callSessionId) ||
        callSessionId <= 0 ||
        !leadLabel ||
        transcriptChunk.length < 2
      )
        return res
          .status(400)
          .json({
            error: "A live call, contact and transcript segment are required.",
          });
      await requireLiveCallOwner(
        user.id,
        user.membership.organisationId,
        callSessionId
      );
      const result = await prepareLiveCoachingTip({
        leadLabel,
        transcript: transcriptChunk,
        billing: {
          userId: user.id,
          organisationId: user.membership.organisationId,
          feature: "live_call_coaching",
          reference: `call:${callSessionId}`,
        },
      });
      console.log(
        JSON.stringify({
          event: "live_call_coaching",
          userId: user.id,
          callSessionId,
          transcriptChars: transcriptChunk.length,
          genxUsage: result.usage ?? {},
          creditsCharged: result.creditsCharged ?? 0,
        })
      );
      return res.json({
        content: result.content,
        usage: result.usage ?? {},
        creditsCharged: result.creditsCharged ?? 0,
      });
    } catch (error) {
      return sendLiveCallError(res, error);
    }
  });

  app.post("/api/live-calls/complete", async (req, res) => {
    try {
      const user = await requireAuthorisedUser(req);
      const callSessionId = Number(req.body?.callSessionId);
      const leadLabel =
        typeof req.body?.leadLabel === "string"
          ? req.body.leadLabel.trim().slice(0, 160)
          : "";
      const transcript =
        typeof req.body?.transcript === "string"
          ? req.body.transcript.trim().slice(-40_000)
          : "";
      const outcome =
        typeof req.body?.outcome === "string" &&
        TELESALES_OUTCOMES.includes(req.body.outcome as TelesalesOutcome)
          ? (req.body.outcome as TelesalesOutcome)
          : undefined;
      if (
        !Number.isInteger(callSessionId) ||
        callSessionId <= 0 ||
        !leadLabel ||
        transcript.length < 4 ||
        !outcome
      )
        return res
          .status(400)
          .json({
            error:
              "A live call, contact, transcript and salesperson-confirmed outcome are required.",
          });
      await requireLiveCallOwner(
        user.id,
        user.membership.organisationId,
        callSessionId
      );
      const summary = await preparePostCallSummary({
        leadLabel,
        transcript,
        billing: {
          userId: user.id,
          organisationId: user.membership.organisationId,
          feature: "post_call_summary",
          reference: `call:${callSessionId}`,
        },
      });
      await completeLiveCallExact({
        userId: user.id,
        organisationId: user.membership.organisationId,
        callSessionId,
        transcript,
        summary: summary.content,
      });
      const systems = await listConnectedSystemsForUser(
        user.id,
        user.membership.organisationId
      );
      const communicationSource =
        req.body?.communication &&
        typeof req.body.communication === "object" &&
        !Array.isArray(req.body.communication)
          ? (req.body.communication as Record<string, unknown>)
          : undefined;
      const communication =
        communicationSource &&
        ["email", "sms", "whatsapp"].includes(
          String(communicationSource.channel)
        ) &&
        typeof communicationSource.templateName === "string" &&
        communicationSource.templateName.trim()
          ? {
              channel: communicationSource.channel as
                | "email"
                | "sms"
                | "whatsapp",
              templateName: communicationSource.templateName
                .trim()
                .slice(0, 180),
              to:
                typeof communicationSource.to === "string"
                  ? communicationSource.to.trim().slice(0, 320)
                  : undefined,
              subject:
                typeof communicationSource.subject === "string"
                  ? communicationSource.subject.trim().slice(0, 500)
                  : undefined,
              body:
                typeof communicationSource.body === "string"
                  ? communicationSource.body.trim().slice(0, 20_000)
                  : undefined,
            }
          : undefined;
      const planned = planTelesalesCloseout({
        callSessionId,
        leadLabel,
        summary: summary.content,
        outcome,
        nextStep:
          typeof req.body?.nextStep === "string"
            ? req.body.nextStep.trim().slice(0, 500)
            : undefined,
        callbackAt:
          typeof req.body?.callbackAt === "string" &&
          !Number.isNaN(new Date(req.body.callbackAt).valueOf())
            ? new Date(req.body.callbackAt).toISOString()
            : undefined,
        opportunityState: ["open", "won", "lost", "unchanged"].includes(
          req.body?.opportunityState
        )
          ? req.body.opportunityState
          : "unchanged",
        contactStatus:
          typeof req.body?.contactStatus === "string"
            ? req.body.contactStatus.trim().slice(0, 120)
            : undefined,
        communication,
        contactExternalId:
          typeof req.body?.contactExternalId === "string"
            ? req.body.contactExternalId.trim().slice(0, 180)
            : undefined,
        taskExternalId:
          typeof req.body?.taskExternalId === "string"
            ? req.body.taskExternalId.trim().slice(0, 180)
            : undefined,
        opportunityExternalId:
          typeof req.body?.opportunityExternalId === "string"
            ? req.body.opportunityExternalId.trim().slice(0, 180)
            : undefined,
        commitmentsConfirmed: req.body?.commitmentsConfirmed === true,
      });
      const proposed = routeConnectedSystemActions(planned, systems);
      const workflowRunId = await createWorkflowRun({
        userId: user.id,
        organisationId: user.membership.organisationId,
        workflowKey: "post_call_closeout",
        leadLabel,
        payload: {
          sourceCallSessionId: callSessionId,
          confirmedOutcome: outcome,
          commitmentsConfirmed: req.body?.commitmentsConfirmed === true,
        },
        verificationSummary:
          "The salesperson confirmed this structured outcome. Actions use the existing policy, review, claim, deterministic execution, postcondition evidence, and idempotency path.",
        actions: proposed,
      });
      const proposals = await listActionProposals(
        user.id,
        user.membership.organisationId,
        workflowRunId
      );
      const policy = await getAutomationPolicy({
        userId: user.id,
        organisationId: user.membership.organisationId,
      });
      const autoExecutions = await executeAutoPreapprovedActions({
        userId: user.id,
        organisationId: user.membership.organisationId,
        proposals,
        policy,
      });
      const blockedActionCount = proposed.filter(
        action =>
          (action.payload.crmRoute as { routable?: boolean } | undefined)
            ?.routable === false
      ).length;
      console.log(
        JSON.stringify({
          event: "live_call_completed",
          userId: user.id,
          callSessionId,
          outcome,
          transcriptChars: transcript.length,
          genxUsage: summary.usage ?? {},
          creditsCharged: summary.creditsCharged ?? 0,
          workflowRunId,
          blockedActionCount,
          autoExecutionCount: autoExecutions.length,
        })
      );
      return res.json({
        content: summary.content,
        usage: summary.usage ?? {},
        creditsCharged: summary.creditsCharged ?? 0,
        closeoutWorkflowRunId: workflowRunId,
        closeoutActionCount: proposed.length,
        blockedActionCount,
        autoExecutions,
        actions: proposals.map(proposal => ({
          id: proposal.id,
          actionType: proposal.actionType,
          title: proposal.title,
          state: proposal.state,
          autoEligible:
            policy.mode === "auto_preapproved" &&
            policy.autoActionTypes.includes(proposal.actionType),
        })),
      });
    } catch (error) {
      return sendLiveCallError(res, error);
    }
  });
}
