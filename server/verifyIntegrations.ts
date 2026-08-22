import "dotenv/config";
import { verifyGenxConnection } from "./genx";
import { createOutlookApplicationToken, getOutlookReadiness } from "./outlook";
import { getSmtpReadiness, verifySmtpConnection } from "./smtp";

function configured(value: string | undefined) { return Boolean(value?.trim()); }

async function main() {
  const results: Record<string, unknown> = {};
  let failed = false;

  if (!getSmtpReadiness().ready) {
    results.smtp = { status: "FAILED", reason: "NOT_CONFIGURED" };
    failed = true;
  } else {
    try { results.smtp = { status: "VERIFIED", ...(await verifySmtpConnection()) }; }
    catch (error) { results.smtp = { status: "FAILED", reason: error instanceof Error ? error.message.slice(0, 240) : "verification_failed" }; failed = true; }
  }

  try { results.genx = { status: "VERIFIED", ...(await verifyGenxConnection()) }; }
  catch (error) { results.genx = { status: "FAILED", reason: error instanceof Error ? error.message.slice(0, 240) : "verification_failed" }; failed = true; }

  const outlook = getOutlookReadiness();
  if (!outlook.ready) results.outlook = { status: "NOT_CONFIGURED" };
  else {
    try {
      const token = await createOutlookApplicationToken();
      results.outlook = { status: token ? "TOKEN_VERIFIED" : "FAILED", senderConfigured: outlook.senderConfigured };
      if (!token) failed = true;
    } catch (error) {
      results.outlook = { status: "FAILED", reason: error instanceof Error ? error.message.slice(0, 240) : "verification_failed" };
      failed = true;
    }
  }

  const sttConfigured = configured(process.env.STT_TRANSCRIPTIONS_URL) && configured(process.env.STT_MODEL);
  results.stt = { status: sttConfigured ? "CONFIGURED_REQUIRES_AUDIO_ACCEPTANCE" : "NOT_CONFIGURED" };
  results.sms = { status: configured(process.env.SMS_WEBHOOK_URL) ? "CONFIGURED_REQUIRES_LIVE_ACCEPTANCE" : "NOT_CONFIGURED" };
  results.whatsapp = { status: configured(process.env.WHATSAPP_WEBHOOK_URL) ? "CONFIGURED_REQUIRES_LIVE_ACCEPTANCE" : "NOT_CONFIGURED" };

  console.log(JSON.stringify({ event: "production_integration_verification", passed: !failed, results }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ event: "production_integration_verification_failed", detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
  process.exitCode = 1;
});
