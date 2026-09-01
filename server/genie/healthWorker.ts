import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";
import { startCompanyKnowledgeWorker } from "../companyKnowledgeJobs";
import { startAutomaticCommissioningWorker } from "../crm/automaticCommissioning";
import { startPersonalWorkLearningWorker } from "../personalWorkLearning";
import { syncReadyDelegatedMailboxes } from "../mailboxWorker";

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

let processingMailboxes = false;
async function processMailboxes() {
  if (processingMailboxes) return;
  processingMailboxes = true;
  try {
    const result = await syncReadyDelegatedMailboxes();
    if (result.checked || result.failed)
      console.log(
        JSON.stringify({
          event: "personal_mailbox_sync_cycle",
          ...result,
        })
      );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "personal_mailbox_worker_failed",
        detail:
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      })
    );
  } finally {
    processingMailboxes = false;
  }
}

const mailboxIntervalMs = Math.max(
  30_000,
  Number(process.env.PERSONAL_MAILBOX_SYNC_INTERVAL_MS || 60_000)
);
void processMailboxes();
setInterval(() => void processMailboxes(), mailboxIntervalMs);

startCompanyKnowledgeWorker();
startAutomaticCommissioningWorker();
startPersonalWorkLearningWorker();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
