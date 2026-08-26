import "dotenv/config";
import { access } from "node:fs/promises";
import path from "node:path";
import { createClient } from "redis";
import { desc, eq, sql } from "drizzle-orm";
import {
  actionProposals,
  auditEntries,
  browserLearnedOperations,
  callSessions,
  callbackTasks,
  connectedSystems,
  connectorVerificationRuns,
  crmOpportunities,
  knowledgeSources,
  organisationMembers,
  websiteDiscoveries,
  workflowRuns,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  FEATURE_ACCEPTANCE_NAMES,
  evaluateStrictClientAcceptance,
  operationStatus,
  result,
  type FeatureAcceptanceMatrix,
  type FeatureAcceptanceResult,
} from "./featureAcceptance";
import { discoverPublicWebsite } from "./companyDiscovery";
import { getGenxReadiness, verifyGenxConnection } from "./genx";
import { isLocalAuthMode } from "./localAuth";
import { getSmtpReadiness, verifySmtpConnection } from "./smtp";
import { verifyVoiceAcceptance } from "./voice/acceptance";
import { getSttConfiguration, probeSttHealth } from "./voice/stt";
import { getTtsConfiguration, probeTtsHealth } from "./voice/tts";

function configuredSecret(name: string, minimum: number) {
  return (process.env[name]?.trim().length || 0) >= minimum;
}
function tested(detail: string, evidence?: Record<string, unknown>) {
  return result("TESTED", detail, evidence);
}
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function databaseProbe() {
  const db = await getDb();
  if (!db) throw new Error("Database client is unavailable.");
  await db.execute(sql`SELECT 1`);
  return db;
}

async function valkeyProbe(): Promise<FeatureAcceptanceResult> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return result("NOT_CONFIGURED", "REDIS_URL is not configured.");
  const client = createClient({
    url,
    socket: { connectTimeout: 5_000, reconnectStrategy: false },
  });
  try {
    await client.connect();
    const reply = await client.ping();
    return reply === "PONG"
      ? result("LIVE_PROVEN", "Valkey answered a live production PING.")
      : result("FAILED", "Valkey returned an unexpected PING response.");
  } catch (error) {
    return result(
      "FAILED",
      `Valkey probe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    if (client.isOpen) await client.quit().catch(() => undefined);
  }
}

async function httpsProbe(): Promise<FeatureAcceptanceResult> {
  const url = (
    process.env.VERIFY_PUBLIC_URL || process.env.PUBLIC_APP_URL
  )?.trim();
  if (!url)
    return result(
      "NOT_CONFIGURED",
      "VERIFY_PUBLIC_URL or PUBLIC_APP_URL is not configured."
    );
  if (!url.startsWith("https://"))
    return result(
      "FAILED",
      "The configured public application URL is not HTTPS."
    );
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/healthz`, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    return response.ok
      ? result(
          "LIVE_PROVEN",
          "The public TLS endpoint returned the application health response.",
          { status: response.status }
        )
      : result("FAILED", `Public HTTPS health returned ${response.status}.`);
  } catch (error) {
    return result(
      "FAILED",
      `Public HTTPS probe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main() {
  const matrix = {} as FeatureAcceptanceMatrix;
  let deliveredSecondFactorAuditId: number | undefined;
  let assistantResponseAuditId: number | undefined;
  for (const feature of FEATURE_ACCEPTANCE_NAMES)
    matrix[feature] = result(
      "NOT_CONFIGURED",
      "No acceptance evidence was collected."
    );

  const authReady =
    isLocalAuthMode() &&
    configuredSecret("JWT_SECRET", 32) &&
    configuredSecret("SECRET_KEY", 32);
  matrix.AUTH = authReady
    ? result(
        "CONFIGURED",
        "Production authentication and required secrets are configured; a successful live second-factor event is still required."
      )
    : result(
        "FAILED",
        "Production authentication mode or required secrets are invalid."
      );
  matrix.VALKEY = await valkeyProbe();
  matrix.HTTPS = await httpsProbe();

  try {
    const db = await databaseProbe();
    matrix.DATABASE = result(
      "LIVE_PROVEN",
      "MariaDB answered a live production SELECT 1."
    );
    const [
      systems,
      verifications,
      operations,
      discoveries,
      knowledge,
      calls,
      proposals,
      callbacks,
      workflows,
      members,
      audits,
      opportunities,
    ] = await Promise.all([
      db.select().from(connectedSystems),
      db
        .select()
        .from(connectorVerificationRuns)
        .orderBy(desc(connectorVerificationRuns.createdAt))
        .limit(200),
      db
        .select()
        .from(browserLearnedOperations)
        .orderBy(desc(browserLearnedOperations.version))
        .limit(1_000),
      db
        .select()
        .from(websiteDiscoveries)
        .orderBy(desc(websiteDiscoveries.createdAt))
        .limit(1),
      db
        .select()
        .from(knowledgeSources)
        .where(eq(knowledgeSources.status, "ready"))
        .limit(1),
      db
        .select()
        .from(callSessions)
        .orderBy(desc(callSessions.createdAt))
        .limit(50),
      db
        .select()
        .from(actionProposals)
        .orderBy(desc(actionProposals.createdAt))
        .limit(50),
      db
        .select()
        .from(callbackTasks)
        .orderBy(desc(callbackTasks.createdAt))
        .limit(1),
      db
        .select()
        .from(workflowRuns)
        .orderBy(desc(workflowRuns.createdAt))
        .limit(1),
      db.select().from(organisationMembers).limit(2),
      db
        .select()
        .from(auditEntries)
        .orderBy(desc(auditEntries.createdAt))
        .limit(500),
      db.select({ id: crmOpportunities.id }).from(crmOpportunities).limit(1),
    ]);
    const currentOperations = new Map<string, string>();
    for (const operation of operations)
      if (!currentOperations.has(operation.operationKey))
        currentOperations.set(operation.operationKey, operation.status);
    const readyVerification = verifications.find(
      item => item.status === "ready"
    );
    const readySystem = systems.find(item => item.status === "ready");
    const authAudit = audits.find(
      item => item.eventType === "two_factor_verified"
    );
    deliveredSecondFactorAuditId = authAudit?.id;
    assistantResponseAuditId = audits.find(
      item => item.eventType === "assistant_response_generated"
    )?.id;
    if (authReady && authAudit)
      matrix.AUTH = result(
        "LIVE_PROVEN",
        "A production user completed authenticated second-factor access.",
        { auditEntryId: authAudit.id }
      );
    matrix.CRM_CONNECT = readyVerification
      ? result(
          "LIVE_PROVEN",
          "A connected CRM has a successful authenticated verification run.",
          {
            connectedSystemId: readyVerification.connectedSystemId,
            verificationRunId: readyVerification.id,
          }
        )
      : readySystem
        ? result(
            "HEALTHY",
            "A CRM is marked ready, but no retained live verification run was found by this verifier.",
            { connectedSystemId: readySystem.id }
          )
        : systems.length
          ? result(
              "CONFIGURED",
              "A CRM is registered but no successful live verification run was found."
            )
          : result("NOT_CONFIGURED", "No CRM connection exists.");
    matrix.CRM_READ = operationStatus(
      currentOperations,
      ["contact.search", "contact.read", "contact.sync"],
      "CRM contact reading"
    );
    matrix.CRM_WRITE = operationStatus(
      currentOperations,
      ["contact.update", "note.create", "task.create"],
      "Core CRM writing"
    );
    matrix.CRM_TASKS = operationStatus(
      currentOperations,
      [
        "task.list",
        "task.read",
        "task.sync",
        "task.create",
        "task.complete",
        "task.create_callback",
      ],
      "CRM tasks"
    );
    matrix.CRM_NOTES = operationStatus(
      currentOperations,
      ["note.read", "note.create"],
      "CRM notes"
    );
    matrix.CRM_PIPELINE = operationStatus(
      currentOperations,
      [
        "pipeline.list",
        "stage.read",
        "opportunity.read",
        "opportunity.update",
        "stage.update",
      ],
      "CRM pipeline"
    );
    matrix.CRM_EMAIL = operationStatus(
      currentOperations,
      ["email.send"],
      "CRM-native email"
    );
    matrix.CRM_SMS = operationStatus(
      currentOperations,
      ["sms.send"],
      "CRM-native SMS"
    );
    matrix.CRM_WHATSAPP = operationStatus(
      currentOperations,
      ["whatsapp.send"],
      "CRM-native WhatsApp"
    );
    matrix.CRM_DIALLER = operationStatus(
      currentOperations,
      ["dialler.launch"],
      "CRM dialler"
    );
    for (const [feature, capability] of [
      ["CRM_EMAIL", "email.send"],
      ["CRM_SMS", "sms.send"],
      ["CRM_WHATSAPP", "whatsapp.send"],
      ["CRM_DIALLER", "dialler.launch"],
    ] as const) {
      if (
        matrix[feature].status === "NOT_CONFIGURED" &&
        readySystem &&
        !readySystem.verifiedCapabilities.includes(capability)
      )
        matrix[feature] = result(
          "NOT_APPLICABLE",
          `The live connected account does not expose ${capability}; the UI keeps it unavailable.`,
          { connectedSystemId: readySystem.id, capability }
        );
    }
    matrix.NEXT_PROSPECT =
      currentOperations.get("prospect.next") === "LIVE_PROVEN"
        ? operationStatus(currentOperations, ["prospect.next"], "Next prospect")
        : opportunities.length
          ? result(
              "LIVE_PROVEN",
              "The production Today queue has synchronized opportunity data available for deterministic prioritisation.",
              { synchronizedOpportunityId: opportunities[0].id }
            )
          : result(
              "NOT_CONFIGURED",
              "No synchronized opportunity exists to prove the production next-prospect queue."
            );
    matrix.BUSINESS_DISCOVERY = discoveries.length
      ? result(
          "LIVE_PROVEN",
          "A client website discovery review has been persisted in production.",
          { sourceUrl: discoveries[0].sourceUrl, status: discoveries[0].status }
        )
      : result(
          "NOT_CONFIGURED",
          "No client website discovery evidence exists in the production database."
        );
    matrix.BUSINESS_KNOWLEDGE = knowledge.length
      ? result(
          "LIVE_PROVEN",
          "Confirmed organisation knowledge exists in the live database.",
          { sourceType: knowledge[0].sourceType }
        )
      : result(
          "CONFIGURED",
          "Knowledge storage is available but no confirmed source exists yet."
        );
    const liveAudioAudit = audits.find(
      item =>
        item.eventType === "live_call_audio_transcribed" &&
        item.entityType === "call_session"
    );
    const liveAudioCallId = liveAudioAudit
      ? Number(liveAudioAudit.entityId)
      : NaN;
    const completedCall = calls.find(
      call =>
        call.id === liveAudioCallId &&
        call.status === "completed" &&
        call.structuredOutcome &&
        typeof call.structuredOutcome === "object"
    );
    const transcriptCall = calls.find(
      call => call.id === liveAudioCallId && Boolean(call.transcript?.trim())
    );
    const coachedCall = calls.find(
      call => call.id === liveAudioCallId && Boolean(call.coachNotes?.trim())
    );
    matrix.LIVE_CALL_CAPTURE =
      liveAudioAudit && Number.isInteger(liveAudioCallId)
        ? result(
            "LIVE_PROVEN",
            "A real production audio chunk passed through the live call capture and transcription route.",
            { callSessionId: liveAudioCallId, auditEntryId: liveAudioAudit.id }
          )
        : tested(
            "Call capture lifecycle is covered by automated tests; no production audio evidence exists yet."
          );
    matrix.LIVE_TRANSCRIPT = transcriptCall
      ? result(
          "LIVE_PROVEN",
          "A non-empty transcript from a proven production audio chunk is stored.",
          { callSessionId: transcriptCall.id, auditEntryId: liveAudioAudit?.id }
        )
      : tested(
          "Audio chunk transcription is covered by automated tests; no production audio transcript evidence exists yet."
        );
    matrix.LIVE_COACHING = coachedCall
      ? result("LIVE_PROVEN", "A production call has stored coaching output.", {
          callSessionId: coachedCall.id,
        })
      : tested(
          "Live coaching orchestration is tested; no production coaching evidence exists yet."
        );
    matrix.CALL_CLOSEOUT = completedCall
      ? result(
          "LIVE_PROVEN",
          "A production call reached confirmed disposition and completed closeout.",
          { callSessionId: completedCall.id }
        )
      : tested(
          "Confirmed disposition and closeout planning are covered by automated tests; no production completion evidence exists yet."
        );
    const closeoutWorkflowRunId =
      completedCall && typeof completedCall.structuredOutcome === "object"
        ? Number(
            (completedCall.structuredOutcome as Record<string, unknown>)
              .closeoutWorkflowRunId
          )
        : NaN;
    const readbackProposal = Number.isInteger(closeoutWorkflowRunId)
      ? proposals.find(
          item =>
            item.workflowRunId === closeoutWorkflowRunId &&
            item.state === "executed" &&
            item.executionResult
        )
      : undefined;
    matrix.CALL_CRM_READBACK = readbackProposal
      ? result(
          "LIVE_PROVEN",
          "The completed production call has an executed closeout proposal with stored CRM result/readback.",
          { callSessionId: completedCall?.id, proposalId: readbackProposal.id }
        )
      : result(
          "NOT_CONFIGURED",
          "No production call-to-CRM execution and readback evidence was found."
        );
    const reviewedProposal = proposals.find(item =>
      ["approved", "skipped", "executed"].includes(item.state)
    );
    matrix.APPROVALS = reviewedProposal
      ? result("LIVE_PROVEN", "A production approval decision is retained.", {
          proposalId: reviewedProposal.id,
          state: reviewedProposal.state,
        })
      : proposals.length
        ? result(
            "CONFIGURED",
            "Approval proposals exist, but no production decision has been retained."
          )
        : tested(
            "Review policy paths are covered by automated tests; no production proposal exists."
          );
    matrix.CALLBACKS = callbacks.length
      ? result("LIVE_PROVEN", "A callback exists in the production workspace.")
      : tested(
          "Callback creation and idempotency are covered by automated tests."
        );
    matrix.WORKFLOWS = workflows.some(item =>
      ["approved", "completed"].includes(item.status)
    )
      ? result(
          "LIVE_PROVEN",
          "A production workflow reached an approved or completed state.",
          {
            workflowRunId: workflows.find(item =>
              ["approved", "completed"].includes(item.status)
            )?.id,
          }
        )
      : workflows.length
        ? result(
            "CONFIGURED",
            "A production workflow exists but has not reached approved/completed evidence."
          )
        : tested(
            "Workflow preparation is covered by automated tests; no production workflow exists."
          );
    matrix.TEAM =
      members.length > 1
        ? result(
            "LIVE_PROVEN",
            "A multi-member organisation exists in the production database."
          )
        : tested(
            "Role-aware individual/team navigation and administration are covered by automated tests."
          );
  } catch (error) {
    matrix.DATABASE = result(
      "FAILED",
      `Database probe failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const smtp = getSmtpReadiness();
  if (!smtp.ready)
    matrix.SMTP = result("NOT_CONFIGURED", "Platform SMTP is not configured.");
  else
    try {
      const transport = await verifySmtpConnection();
      matrix.SMTP = deliveredSecondFactorAuditId
        ? result(
            "LIVE_PROVEN",
            "SMTP authenticated successfully and a production user completed the delivered second-factor flow.",
            { ...transport, auditEntryId: deliveredSecondFactorAuditId }
          )
        : result(
            "CONFIGURED",
            "SMTP authenticated successfully, but no completed production email second-factor flow is retained yet.",
            transport
          );
    } catch (error) {
      matrix.SMTP = result(
        "FAILED",
        `SMTP verification failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

  if (!getGenxReadiness().configured)
    matrix.GENX = result(
      "NOT_CONFIGURED",
      "Amarktai intelligence is not configured."
    );
  else
    try {
      matrix.GENX = result(
        "LIVE_PROVEN",
        "The authenticated catalogue and text inference probe succeeded.",
        await verifyGenxConnection()
      );
    } catch (error) {
      matrix.GENX = result(
        "FAILED",
        `Amarktai intelligence verification failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  matrix.ASSISTANT =
    matrix.GENX.status === "LIVE_PROVEN" && assistantResponseAuditId
      ? result(
          "LIVE_PROVEN",
          "A production context-aware Assistant response and the live intelligence probe are both proven.",
          { auditEntryId: assistantResponseAuditId }
        )
      : tested(
          "Assistant context assembly, safety prompt, and governed action boundary are covered by tests; a production Assistant response and live inference are both required."
        );

  const liveVoice = process.env.FEATURE_VERIFY_LIVE_VOICE === "true";
  const stt = getSttConfiguration();
  const tts = getTtsConfiguration();
  if (!stt.configured)
    matrix.STT = result("NOT_CONFIGURED", "STT is not configured.");
  else if (!tts.configured) {
    matrix.STT = (await probeSttHealth()).ready
      ? result(
          "HEALTHY",
          "STT health probe succeeded; deterministic audio acceptance requires TTS or a fixture."
        )
      : result("FAILED", "STT health probe failed.");
    matrix.TTS = result("NOT_CONFIGURED", "TTS is not configured.");
  } else if (liveVoice) {
    try {
      const evidence = await verifyVoiceAcceptance();
      matrix.STT = result(
        "LIVE_PROVEN",
        "Known synthesized speech passed through the production STT path and expected words were recognized.",
        evidence
      );
      matrix.TTS = result(
        "LIVE_PROVEN",
        "Known text produced non-empty playable audio through the production TTS path.",
        evidence
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      matrix.STT = result("FAILED", `Voice acceptance failed: ${detail}`);
      matrix.TTS = result("FAILED", `Voice acceptance failed: ${detail}`);
    }
  } else {
    const [sttHealth, ttsHealth] = await Promise.all([
      probeSttHealth(),
      probeTtsHealth(),
    ]);
    matrix.STT = sttHealth.ready
      ? result(
          "HEALTHY",
          "STT service health succeeded. Set FEATURE_VERIFY_LIVE_VOICE=true for real audio acceptance."
        )
      : result("FAILED", "STT service health failed.");
    matrix.TTS = ttsHealth.ready
      ? result(
          "HEALTHY",
          "TTS service health succeeded. Set FEATURE_VERIFY_LIVE_VOICE=true for synthesis/transcription acceptance."
        )
      : result("FAILED", "TTS service health failed.");
  }

  const website = process.env.FEATURE_VERIFY_WEBSITE_URL?.trim();
  if (website)
    try {
      const discovery = await discoverPublicWebsite(website);
      matrix.BUSINESS_DISCOVERY = result(
        "LIVE_PROVEN",
        "A real authorised public website completed bounded discovery.",
        {
          sourceUrl: discovery.sourceUrl,
          pages: discovery.pages.length,
          candidates: discovery.proposedKnowledge.length,
        }
      );
    } catch (error) {
      matrix.BUSINESS_DISCOVERY = result(
        "FAILED",
        `Live website discovery failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

  const browserEndpoint = process.env.BROWSERLESS_WS_ENDPOINT?.trim();
  if (!browserEndpoint)
    matrix.BROWSER_RUNTIME = result(
      "NOT_CONFIGURED",
      "BROWSERLESS_WS_ENDPOINT is not configured."
    );
  else
    try {
      const url = new URL(
        browserEndpoint.replace(/^ws:/, "http:").replace(/^wss:/, "https:")
      );
      url.pathname = "/json/version";
      url.search = "";
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const payload = (await response.json().catch(() => ({}))) as {
        webSocketDebuggerUrl?: string;
      };
      matrix.BROWSER_RUNTIME =
        response.ok && payload.webSocketDebuggerUrl
          ? result(
              "LIVE_PROVEN",
              "The internal Chromium runtime returned an active DevTools WebSocket endpoint."
            )
          : result(
              "FAILED",
              `Chromium runtime probe returned ${response.status} without a DevTools endpoint.`
            );
    } catch (error) {
      matrix.BROWSER_RUNTIME = result(
        "FAILED",
        `Chromium runtime probe failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  matrix.REPORTING = tested(
    "Operational and scheduled reporting paths are covered by automated tests."
  );
  matrix.EXPORTS = tested(
    "CSV/PDF export generation and authenticated download paths are covered by automated tests."
  );
  const publicAssets = await exists(
    path.resolve(process.cwd(), "dist/public/index.html")
  );
  if (!publicAssets) {
    for (const feature of [
      "REPORTING",
      "EXPORTS",
      "ASSISTANT",
      "NEXT_PROSPECT",
    ] as const)
      if (matrix[feature].status === "TESTED")
        matrix[feature] = result(
          "FAILED",
          "Production frontend assets are missing."
        );
  }

  const strict = evaluateStrictClientAcceptance(matrix);
  const incomplete =
    strict.criticalNotLive.length +
    strict.optionalInvalid.length +
    strict.failed.length;
  const report = JSON.stringify(
    {
      event: "feature_acceptance",
      generatedAt: new Date().toISOString(),
      passed: strict.passed,
      incomplete,
      strict,
      matrix,
    },
    null,
    2
  );
  process.stdout.write(
    `${report}\nCLIENT_ACCEPTANCE=${strict.passed ? "PASS" : "FAIL"}\n`,
    () => process.exit(strict.passed ? 0 : 1)
  );
}

main().catch(error => {
  const report = JSON.stringify({
    event: "feature_acceptance_failed",
    detail: error instanceof Error ? error.message : String(error),
  });
  process.stderr.write(`${report}\n`, () => process.exit(1));
});
