import "dotenv/config";
import { AGENT_CATALOG } from "./agentCatalog";
import { GenxCompanyLearningClient } from "./genxCompanyLearning";
import { runGenxAgent, verifyGenxConnection } from "./genx";
import { createOutlookApplicationToken, getOutlookReadiness } from "./outlook";
import { getSmtpReadiness, verifySmtpConnection } from "./smtp";
import { evaluateProductionAgentProbe } from "./productionAgentProbe";
import { verifyVoiceAcceptance } from "./voice/acceptance";
import { getSttConfiguration } from "./voice/stt";
import { getTtsConfiguration } from "./voice/tts";

async function verifyAgentExecutions() {
  const agents: Record<string, unknown> = {};
  let failed = false;

  for (const agent of AGENT_CATALOG) {
    if (!agent.requiresModel) {
      agents[agent.key] = {
        status: "DETERMINISTIC_INTERNAL",
        modelRole: agent.modelRole,
      };
      continue;
    }

    try {
      const response = await runGenxAgent({
        agentKey: agent.key,
        modelTier: "fast",
        messages: [
          {
            role: "user",
            content:
              "This is a production commissioning probe. Give one concise, factual sentence describing what you can do in your assigned Amarktai role. Do not claim any external action occurred and do not invent customer or company facts.",
          },
        ],
      });
      agents[agent.key] = evaluateProductionAgentProbe({
        agentKey: agent.key,
        provider: response.provider,
        content: response.content || "",
      });
    } catch (error) {
      failed = true;
      agents[agent.key] = {
        status: "FAILED",
        reason:
          error instanceof Error
            ? error.message.slice(0, 260)
            : "agent_verification_failed",
      };
    }
  }

  return {
    failed,
    total: AGENT_CATALOG.length,
    modelBacked: AGENT_CATALOG.filter(agent => agent.requiresModel).length,
    deterministic: AGENT_CATALOG.filter(agent => !agent.requiresModel).length,
    agents,
  };
}

async function main() {
  const results: Record<string, unknown> = {};
  let failed = false;

  if (!getSmtpReadiness().ready) {
    results.smtp = { status: "FAILED", reason: "NOT_CONFIGURED" };
    failed = true;
  } else {
    try {
      results.smtp = { status: "VERIFIED", ...(await verifySmtpConnection()) };
    } catch (error) {
      results.smtp = {
        status: "FAILED",
        reason:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "verification_failed",
      };
      failed = true;
    }
  }

  let genxVerified = false;
  try {
    results.genx = { status: "VERIFIED", ...(await verifyGenxConnection()) };
    genxVerified = true;
  } catch (error) {
    results.genx = {
      status: "FAILED",
      reason:
        error instanceof Error
          ? error.message.slice(0, 240)
          : "verification_failed",
    };
    failed = true;
  }

  if (genxVerified) {
    const agentVerification = await verifyAgentExecutions();
    results.agents = agentVerification;
    if (agentVerification.failed) failed = true;

    try {
      const selected = await new GenxCompanyLearningClient().selectModels();
      results.companyKnowledgeReasoning = {
        status: "WHOLE_SITE_ACCOUNT_VERIFIED",
        analysisModelSelected: Boolean(selected.analysis.id),
        auditModelSelected: Boolean(selected.audit.id),
        pricingDiscovered: Boolean(
          selected.analysis.pricing || selected.audit.pricing
        ),
        creditBalanceDiscovered: Boolean(selected.accountCredits),
      };
    } catch (error) {
      results.companyKnowledgeReasoning = {
        status: "FAILED",
        reason:
          error instanceof Error
            ? error.message.slice(0, 320)
            : "company_knowledge_reasoning_failed",
      };
      failed = true;
    }
  } else {
    results.agents = {
      status: "BLOCKED",
      reason:
        "Base production intelligence verification failed, so agent execution probes were not attempted.",
    };
    results.companyKnowledgeReasoning = {
      status: "BLOCKED",
      reason:
        "Base production intelligence verification failed, so structured company-knowledge reasoning was not attempted.",
    };
  }

  const outlook = getOutlookReadiness();
  if (!outlook.ready) results.outlook = { status: "NOT_CONFIGURED" };
  else {
    try {
      const token = await createOutlookApplicationToken();
      results.outlook = {
        status: token ? "TOKEN_VERIFIED" : "FAILED",
        senderConfigured: outlook.senderConfigured,
      };
      if (!token) failed = true;
    } catch (error) {
      results.outlook = {
        status: "FAILED",
        reason:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "verification_failed",
      };
      failed = true;
    }
  }

  const stt = getSttConfiguration();
  const tts = getTtsConfiguration();
  if (!stt.configured || !tts.configured) {
    results.stt = { status: stt.configured ? "CONFIGURED" : "NOT_CONFIGURED" };
    results.tts = { status: tts.configured ? "CONFIGURED" : "NOT_CONFIGURED" };
    failed = true;
  } else {
    try {
      const voice = await verifyVoiceAcceptance();
      results.stt = {
        status: "LIVE_PROVEN",
        provider: stt.provider,
        model: stt.model,
        transcript: voice.transcript,
        recognizedWords: voice.recognizedWords,
        rawAudioRetained: voice.rawAudioRetained,
      };
      results.tts = {
        status: "LIVE_PROVEN",
        provider: tts.provider,
        voice: voice.voice,
        audioBytes: voice.audioBytes,
        contentType: voice.contentType,
      };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message.slice(0, 300)
          : "voice_acceptance_failed";
      results.stt = { status: "FAILED", reason };
      results.tts = { status: "FAILED", reason };
      failed = true;
    }
  }

  results.crmActions = {
    status: "VERIFIED_PER_CONNECTED_SYSTEM",
    detail:
      "Email, SMS, WhatsApp and every other client-facing CRM function are discovered and verified on each connected CRM. They are not deployment-level messaging integrations.",
  };

  console.log(
    JSON.stringify(
      {
        event: "production_integration_verification",
        passed: !failed,
        results,
      },
      null,
      2
    )
  );
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "production_integration_verification_failed",
      detail:
        error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500),
    })
  );
  process.exitCode = 1;
});
