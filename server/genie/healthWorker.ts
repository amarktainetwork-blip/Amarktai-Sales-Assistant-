import { writeFileSync } from "node:fs";
import "dotenv/config";
import { runGenieOperationWatchdog } from "./operationWatchdog";
import { startCompanyKnowledgeWorker } from "../companyKnowledgeJobs";
import { startAutomaticCommissioningWorker } from "../crm/automaticCommissioning";
import { startPersonalWorkLearningWorker } from "../personalWorkLearning";
import {
  armPersonalMailboxSyncWatchdog,
  personalMailboxSyncTimeoutMs,
  syncReadyDelegatedMailboxes,
} from "../mailboxWorker";
import {
  runConnectionScopedCrmSyncCycle,
  startConnectionScopedCrmSyncWorker,
} from "../crm/syncWorker";
import { runNewLeadWatchCycle, startNewLeadWatcher } from "../crm/leadWatcher";
import { runBackgroundBrowserReadLane } from "../crm/backgroundReadLane";
import { reconcileAllAbandonedLiveCalls } from "../liveCalls/store";

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
  const timeoutMs = personalMailboxSyncTimeoutMs();
  const clearWatchdog = armPersonalMailboxSyncWatchdog({
    timeoutMs,
    onTimeout: () => {
      console.error(
        JSON.stringify({
          event: "personal_mailbox_worker_stalled",
          timeoutMs,
          action: "recycle_worker",
        })
      );
      process.exit(75);
    },
  });
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
    clearWatchdog();
    processingMailboxes = false;
  }
}

const mailboxIntervalMs = Math.max(
  30_000,
  Number(process.env.PERSONAL_MAILBOX_SYNC_INTERVAL_MS || 30_000)
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

let processingAbandonedCalls = false;
async function reconcileAbandonedCalls() {
  if (processingAbandonedCalls) return;
  processingAbandonedCalls = true;
  try {
    const result = await reconcileAllAbandonedLiveCalls();
    if (result.checkpointed)
      console.log(
        JSON.stringify({
          event: "abandoned_live_calls_reconciled",
          ...result,
        })
      );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "abandoned_live_calls_reconciliation_failed",
        detail:
          error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      })
    );
  } finally {
    processingAbandonedCalls = false;
  }
}

const abandonedCallIntervalMs = Math.max(
  60_000,
  Number(process.env.LIVE_CALL_RECONCILE_INTERVAL_MS || 60_000)
);
setTimeout(() => {
  void reconcileAbandonedCalls();
  setInterval(() => void reconcileAbandonedCalls(), abandonedCallIntervalMs);
}, 20_000);

startCompanyKnowledgeWorker();
startAutomaticCommissioningWorker();
startPersonalWorkLearningWorker();
const customerHistorySafetyIntervalMs = Math.max(
  120_000,
  Number(process.env.CRM_CUSTOMER_HISTORY_INTERVAL_MS || 120_000)
);
startNewLeadWatcher(customerHistorySafetyIntervalMs, () =>
  runBackgroundBrowserReadLane("crm_customer_history_safety", () =>
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

const workerMemoryLimitMb = Math.max(
  512,
  Number(process.env.WORKER_MEMORY_RECYCLE_MB || 1_200)
);
let workerMemoryOverLimitChecks = 0;
const workerMemoryGuard = setInterval(() => {
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  if (rssMb <= workerMemoryLimitMb) {
    workerMemoryOverLimitChecks = 0;
    return;
  }
  workerMemoryOverLimitChecks += 1;
  console.warn(
    JSON.stringify({
      event: "worker_memory_pressure",
      rssMb: Math.round(rssMb),
      limitMb: workerMemoryLimitMb,
      consecutiveChecks: workerMemoryOverLimitChecks,
      action: workerMemoryOverLimitChecks >= 3 ? "recycle" : "observe",
    })
  );
  if (workerMemoryOverLimitChecks >= 3) process.exit(75);
}, 60_000);
workerMemoryGuard.unref();

// A fresh event-loop heartbeat distinguishes a live worker from a stuck process.
const heartbeat = () =>
  writeFileSync("/tmp/amarktai-worker-heartbeat", String(Date.now()));
heartbeat();
setInterval(heartbeat, 15_000).unref();
