import { runGenieHealthCheck } from "./genie/bridge";
import { getGenieReadiness } from "./genie/config";
import { getGenxReadiness, verifyGenxConnection } from "./genx";
import { getOutlookReadiness } from "./outlook";
import { verifySmtpTransport } from "./smtp";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const smtp = await verifySmtpTransport();
  const genxConfigured = getGenxReadiness().ready;
  const genx = genxConfigured ? await verifyGenxConnection() : { ready: false as const, reason: "not_configured" as const };
  const genieConfig = getGenieReadiness();
  const genie = genieConfig.configured ? await runGenieHealthCheck() : null;
  const outlook = getOutlookReadiness();
  const outlookSenderValid = !outlook.ready || EMAIL.test(process.env.OUTLOOK_SENDER_EMAIL ?? "");
  const result = {
    smtp,
    genx: { configured: genxConfigured, ...genx },
    genie: genie ? { configured: true, ready: genie.success } : { configured: false, ready: false },
    outlook: { configured: outlook.ready, senderValid: outlookSenderValid },
  };
  console.log(JSON.stringify(result));
  if (!smtp.ready || (genxConfigured && !genx.ready) || (genie && !genie.success) || !outlookSenderValid) process.exitCode = 1;
}

main().catch(error => {
  console.error("Integration verification failed safely", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
