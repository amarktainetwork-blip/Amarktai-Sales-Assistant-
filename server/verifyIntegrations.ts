import "dotenv/config";
import { verifyGenxConnection } from "./genx";
import { createOutlookApplicationToken, getOutlookReadiness } from "./outlook";
import { getSmtpReadiness, verifySmtpConnection } from "./smtp";
import { verifyVoiceAcceptance } from "./voice/acceptance";
import { getSttConfiguration } from "./voice/stt";
import { getTtsConfiguration } from "./voice/tts";

function configured(value: string | undefined) {
  return Boolean(value?.trim());
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

  try {
    results.genx = { status: "VERIFIED", ...(await verifyGenxConnection()) };
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
      const reason = error instanceof Error ? error.message.slice(0, 300) : "voice_acceptance_failed";
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
