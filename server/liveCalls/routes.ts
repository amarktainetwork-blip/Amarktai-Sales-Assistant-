import type { Express, Request, Response } from "express";
import { requireLocalHttpContext } from "../httpAuth";
import {
  appendLiveTranscript,
  listActionProposals,
} from "../db";
import {
  prepareLiveCoachingTip,
  prepareOutcomeAwarePostCallSummary,
} from "../liveCoach";
import type { OrganisationMembership } from "../organisation";
import { listConnectedSystemsForUser } from "../connectedSystems";
import { routeConnectedSystemActions } from "../crmRouter";
import { detectLiveSignals } from "./signals";
import { completeLiveCallExact, requireLiveCallOwner } from "./store";
import { parseLiveCallCompletion } from "./completion";
import { planTelesalesCloseout } from "../telesales/closeoutPlanner";
import { getAutomationPolicy } from "../automationPolicy";
import { executeAutoPreapprovedActions } from "../governedActions";
import { resolveLiveCallCloseoutIdentity } from "./context";
import { persistConfirmedCommitment } from "../memory";
import { prepareCustomCommunication, resolveApprovedCommunicationTemplate } from "../approvedTemplates";
import { prepareClaimedCloseoutWorkflow, runCanonicalCallCloseout, saveCallCloseoutSummary } from "./closeoutIdempotency";
import { ALLOWED_STT_MIME, decodeAudio, probeSttHealth, transcribeAudio } from "../voice/stt";

type Authenticated = { id: number; membership: OrganisationMembership };

async function requireAuthorisedUser(req: Request): Promise<Authenticated> {
  const identity = await requireLocalHttpContext(req);
  return { id: identity.userId, membership: identity.membership };
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
  if (/^(TEMPLATE_NOT_FOUND|TEMPLATE_CONTENT_REQUIRED)|destination is required|requires a subject|supported communication channel/i.test(detail))
    return res.status(400).json({ error: detail.slice(0, 300) });
  if (detail.startsWith("CLOSEOUT_PROCESSING")) return res.status(409).json({ error: detail });
  console.error(
    JSON.stringify({
      event: "live_call_api_error",
      detail: detail.slice(0, 300),
    })
  );
  return res.status(502).json({
    error: detail.slice(0, 300) || "Live Call Companion request failed.",
  });
}

export function registerLiveCallRoutes(app: Express) {
  app.get("/api/live-calls/readiness", async (req, res) => {
    try {
      await requireAuthorisedUser(req);
      return res.json(await probeSttHealth());
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
      if (!ALLOWED_STT_MIME.has(mimeType))
        return res.status(400).json({ error: "Unsupported audio type." });
      const durationMs = Math.max(
        0,
        Math.min(15_000, Number(req.body?.durationMs || 0))
      );
      const bytes = decodeAudio(req.body?.audioBase64);
      const text = await transcribeAudio(
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
      const transcriptChunk =
        typeof req.body?.transcriptChunk === "string"
          ? req.body.transcriptChunk.trim().slice(-8_000)
          : "";
      if (
        !Number.isInteger(callSessionId) ||
        callSessionId <= 0 ||
        transcriptChunk.length < 2
      )
        return res.status(400).json({
          error: "A live call, contact and transcript segment are required.",
        });
      const session = await requireLiveCallOwner(
        user.id,
        user.membership.organisationId,
        callSessionId
      );
      const leadLabel = session.leadLabel;
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
      const completion = parseLiveCallCompletion(req.body);
      if (!completion.ok)
        return res.status(400).json({
          error: "A live call and salesperson-confirmed outcome are required.",
        });
      const { callSessionId, transcript, outcome } = completion;
      const session = await requireLiveCallOwner(
        user.id,
        user.membership.organisationId,
        callSessionId
      );
      const leadLabel = session.leadLabel;
      const result = await runCanonicalCallCloseout(
        {
          userId: user.id,
          organisationId: user.membership.organisationId,
          callSessionId,
          leadLabel,
        },
        async claim => {
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
          if (
            communicationSource &&
            !["email", "sms", "whatsapp"].includes(
              String(communicationSource.channel)
            )
          )
            throw new Error("A supported communication channel is required.");
          const communicationIntent = communicationSource
            ? {
                channel: communicationSource.channel as
                  | "email"
                  | "sms"
                  | "whatsapp",
                templateName:
                  typeof communicationSource.templateName === "string"
                    ? communicationSource.templateName.trim().slice(0, 180)
                    : "",
                to:
                  typeof communicationSource.to === "string"
                    ? communicationSource.to.trim().slice(0, 320)
                    : "",
                subject:
                  typeof communicationSource.subject === "string"
                    ? communicationSource.subject.trim().slice(0, 500)
                    : undefined,
                body:
                  typeof communicationSource.body === "string"
                    ? communicationSource.body.trim().slice(0, 20_000)
                    : "",
              }
            : undefined;
          const structuredOutcome = {
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
            templateName: communicationIntent?.templateName || undefined,
            opportunityState: ["open", "won", "lost", "unchanged"].includes(
              req.body?.opportunityState
            )
              ? req.body.opportunityState
              : "unchanged",
          };
          const identity = await resolveLiveCallCloseoutIdentity({
            organisationId: user.membership.organisationId,
            session,
            advanced: {
              contactExternalId:
                typeof req.body?.contactExternalId === "string"
                  ? req.body.contactExternalId
                  : undefined,
              taskExternalId:
                typeof req.body?.taskExternalId === "string"
                  ? req.body.taskExternalId
                  : undefined,
              opportunityExternalId:
                typeof req.body?.opportunityExternalId === "string"
                  ? req.body.opportunityExternalId
                  : undefined,
            },
          });
          const destination =
            communicationIntent?.to ||
            (communicationIntent?.channel === "email"
              ? identity?.email
              : identity?.phone) ||
            "";
          const communication =
            communicationIntent && req.body?.commitmentsConfirmed === true
              ? communicationIntent.templateName
                ? await resolveApprovedCommunicationTemplate({
                    organisationId: user.membership.organisationId,
                    channel: communicationIntent.channel,
                    templateName: communicationIntent.templateName,
                    to: destination,
                  })
                : prepareCustomCommunication({
                    channel: communicationIntent.channel,
                    to: destination,
                    subject: communicationIntent.subject,
                    body: communicationIntent.body,
                  })
              : undefined;
          const savedSummary = claim.input.summaryResult as
            | Awaited<ReturnType<typeof prepareOutcomeAwarePostCallSummary>>
            | undefined;
          const summary = savedSummary?.content
            ? savedSummary
            : await prepareOutcomeAwarePostCallSummary({
                leadLabel,
                transcript,
                structured: structuredOutcome,
                billing: {
                  userId: user.id,
                  organisationId: user.membership.organisationId,
                  feature: "post_call_summary",
                  reference: `call:${callSessionId}`,
                },
              });
          if (!savedSummary?.content)
            await saveCallCloseoutSummary({
              workflowRunId: claim.workflowRunId,
              claimToken: claim.claimToken,
              summaryResult: summary as unknown as Record<string, unknown>,
            });
          await completeLiveCallExact({
            userId: user.id,
            organisationId: user.membership.organisationId,
            callSessionId,
            transcript,
            summary: summary.content,
            structuredOutcome,
          });
          if (
            structuredOutcome.callbackAt &&
            req.body?.commitmentsConfirmed === true
          ) {
            await persistConfirmedCommitment({
              userId: user.id,
              organisationId: user.membership.organisationId,
              title:
                structuredOutcome.nextStep || `Follow up with ${leadLabel}`,
              dueAt: new Date(structuredOutcome.callbackAt),
              timezone: user.membership.timezone,
              source: "call_commitment",
              sourceReference: `call:${callSessionId}:callback`,
              contactExternalId: identity?.contactExternalId,
              opportunityExternalId: identity?.opportunityExternalId,
            });
          }
          const planned = planTelesalesCloseout({
            organisationId: user.membership.organisationId,
            callSessionId,
            leadLabel,
            summary: summary.content,
            outcome,
            nextStep: structuredOutcome.nextStep,
            callbackAt: structuredOutcome.callbackAt,
            opportunityState: structuredOutcome.opportunityState,
            contactStatus:
              typeof req.body?.contactStatus === "string"
                ? req.body.contactStatus.trim().slice(0, 120)
                : undefined,
            communication,
            contactExternalId: identity?.contactExternalId,
            taskExternalId: identity?.taskExternalId,
            opportunityExternalId: identity?.opportunityExternalId,
            connectedSystemId: identity?.connectedSystemId,
            provider: identity?.provider,
            commitmentsConfirmed: req.body?.commitmentsConfirmed === true,
          });
          const proposed = routeConnectedSystemActions(planned, systems);
          const workflowRunId = claim.workflowRunId;
          await prepareClaimedCloseoutWorkflow({
            workflowRunId,
            claimToken: claim.claimToken,
            payload: {
              userId: user.id,
              organisationId: user.membership.organisationId,
              sourceCallSessionId: callSessionId,
              confirmedOutcome: outcome,
              commitmentsConfirmed: req.body?.commitmentsConfirmed === true,
              summaryResult: summary,
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
              postCallGenxCalls: summary.genxCalls,
              workflowRunId,
              blockedActionCount,
              autoExecutionCount: autoExecutions.length,
            })
          );
          return {
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
          };
        }
      );
      return res.json(result);
    } catch (error) {
      return sendLiveCallError(res, error);
    }
  });
}
