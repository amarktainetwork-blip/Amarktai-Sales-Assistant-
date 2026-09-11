import type { CommissioningState } from "./automaticCommissioning";
import {
  getAutomaticCommissioning,
  presentCommissioningJob,
  startAutomaticCommissioning,
} from "./automaticCommissioning";

export type CommissioningRecoveryAction =
  | "start"
  | "resume"
  | "restart_safe_reads"
  | "hold";

const SAFE_AUTOMATIC_RESTART_STATES = new Set<CommissioningState>([
  "AUTHENTICATE",
  "DISCOVER_NAVIGATION",
  "DISCOVER_CAPABILITIES",
  "TEST_SAFE_READS",
]);

/**
 * Decide what an authenticated browser session may do to its durable
 * commissioning job. Reopening an authenticated CRM may recover unfinished
 * discovery/read proof. A terminal READY + needs_attention result may also
 * restart automatically, but only when its stored capability accounting still
 * contains critical safe-read gaps. That lets first-time onboarding repair
 * selector drift without turning ordinary CRM viewer opens into endless
 * recommissioning. Fully ready jobs and every write/approval stage remain held.
 */
function hasCriticalSafeReadGaps(progress: unknown) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress))
    return false;
  const accounting = (progress as Record<string, unknown>).capabilityAccounting;
  if (
    !accounting ||
    typeof accounting !== "object" ||
    Array.isArray(accounting)
  )
    return false;
  const gaps = (accounting as Record<string, unknown>).criticalGaps;
  return Array.isArray(gaps) && gaps.length > 0;
}

export function commissioningRecoveryAction(
  job:
    | {
        status: string;
        state: CommissioningState;
        progress?: unknown;
      }
    | null
    | undefined
): CommissioningRecoveryAction {
  if (!job) return "start";
  if (job.status === "queued" || job.status === "running") return "resume";
  if (
    job.status === "needs_attention" &&
    (SAFE_AUTOMATIC_RESTART_STATES.has(job.state) ||
      (job.state === "READY" && hasCriticalSafeReadGaps(job.progress)))
  )
    return "restart_safe_reads";
  return "hold";
}

/**
 * Ensure an authenticated CRM has a commissioning lifecycle without turning
 * authentication into permission to write. Successful READY,
 * terminal READY+needs_attention, and waiting-for-approval jobs are preserved
 * exactly as they are. A needs-attention job may restart automatically only
 * while it remains in a read-only, non-terminal commissioning state. The
 * restarted lifecycle still stops before controlled writes until a manager
 * explicitly authorises a safe test record.
 */
export async function ensureAutomaticCommissioning(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const job = await getAutomaticCommissioning({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
  });
  const action = commissioningRecoveryAction(job);

  if (action === "start" || action === "restart_safe_reads")
    return startAutomaticCommissioning(input);

  if (!job) return startAutomaticCommissioning(input);

  return presentCommissioningJob(job);
}
