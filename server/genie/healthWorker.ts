import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";
import { processNextOutlookInbound } from "../communications/outlookInboundQueue";

const intervalMs = Number(
  process.env.CRM_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000
);

async function check() {
  try {
    const result = await runGenieOperationWatchdog();
    console.log(
      JSON.stringify({
        event: "crm_operation_watchdog",
        provider: "genie",
        ...result,
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "crm_operation_watchdog_failed",
        provider: "genie",
        detail:
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      })
    );
  }
}

void check();
setInterval(() => void check(), intervalMs);

let processingOutlook = false;
async function processOutlook() {
  if (processingOutlook) return;
  processingOutlook = true;
  try {
    for (let count = 0; count < 20; count += 1) {
      const result = await processNextOutlookInbound();
      if (!result.processed && !("id" in result)) break;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "outlook_inbound_worker_failed",
        detail:
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      })
    );
  } finally {
    processingOutlook = false;
  }
}
void processOutlook();
setInterval(
  () => void processOutlook(),
  Math.max(2_000, Number(process.env.OUTLOOK_INBOUND_POLL_MS || 5_000))
);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
