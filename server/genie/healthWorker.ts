import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";

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
setInterval(() => void check(), intervalMs).unref();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
