import { writeFileSync } from "node:fs";
import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";
import { startCompanyKnowledgeWorker } from "../companyKnowledgeJobs";
import { startAutomaticCommissioningWorker } from "../crm/automaticCommissioning";
import { startPersonalWorkLearningWorker } from "../personalWorkLearning";
import { syncReadyDelegatedMailboxes } from "../mailboxWorker";
import {
  runConnectionScopedCrmSyncCycle,
  startConnectionScopedCrmSyncWorker,
} from "../crm/syncWorker";
import { runNewLeadWatchCycle, startNewLeadWatcher } from "../crm/leadWatcher";
import { runBackgroundBrowserReadLane } from "../crm/backgroundReadLane";

const intervalMs = Number(
  process.env.CRM_HEALTH_INTERVAL_MS || 24 * 60 * 60 * 1000
);

function startupDelay(
  raw: string | undefined,
  fallbackMs: number,
  minimumMs: number
) {
  const parsed = Number(raw || fallbackMs);
  return Number.isFinite(parsed) && parsed >= minimumMs
    ? Math.floor(parsed)
    : fallbackMs;
}

async function check() {
  try {
    const result = await runBackgroundBrowserReadLane(
      "crm_operation_watchdog",
      () => runGenieOperationWatchdog()
    );
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

const watchdogInitialDelayMs = startupDelay(
  process.env.CRM_WATCHDOG_INITIAL_DELAY_MS,
  45_000,
  30_000
);
setTimeout(() => {
  void check();
  setInterval(() => void check(), intervalMs);
}, watchdogInitialDelayMs);

let processingMailboxes = false;
async function processMailboxes() {
  if (processingMailboxes) return;
  processingMailboxes = true;
  try {
    const result = await runBackgroundBrowserReadLane(
      "personal_mailbox_sync",
      () => syncReadyDelegatedMailboxes()
    );
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
const mailboxInitialDelayMs = startupDelay(
  process.env.PERSONAL_MAILBOX_INITIAL_DELAY_MS,
  15_000,
  5_000
);
setTimeout(() => {
  void processMailboxes();
  setInterval(() => void processMailboxes(), mailboxIntervalMs);
}, mailboxInitialDelayMs);

startCompanyKnowledgeWorker();
startAutomaticCommissioningWorker();
startPersonalWorkLearningWorker();
startNewLeadWatcher(undefined, () =>
  runBackgroundBrowserReadLane("crm_new_lead_watch", () =>
    runNewLeadWatchCycle()
  )
);
const crmSyncInitialDelayMs = startupDelay(
  process.env.CRM_SYNC_INITIAL_DELAY_MS,
  30_000,
  10_000
);
setTimeout(
  () =>
    startConnectionScopedCrmSyncWorker(undefined, () =>
      runBackgroundBrowserReadLane("crm_reconciliation", () =>
        runConnectionScopedCrmSyncCycle()
      )
    ),
  crmSyncInitialDelayMs
);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

// A fresh event-loop heartbeat distinguishes a live worker from a stuck process.
const heartbeat = () =>
  writeFileSync("/tmp/amarktai-worker-heartbeat", String(Date.now()));
heartbeat();
setInterval(heartbeat, 15_000).unref();
