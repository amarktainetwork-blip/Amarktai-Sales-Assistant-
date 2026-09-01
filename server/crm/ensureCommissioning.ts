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
  // READY + needs_attention is a terminal failed-core-readiness result, not a
  // successfully commissioned CRM. A fresh authenticated browser session may
  // safely restart discovery/read proof from the beginning. Any discovered
  // writes will still stop at AWAIT_SAFE_TEST_RECORD and require explicit
  // manager authorisation before controlled execution.
  "READY",
]);

/**
 * Decide what an authenticated browser session may do to its durable
 * commissioning job. The important production boundary is that simply
 * reopening an authenticated CRM may recover discovery/read proof, but it
 * must never resume a controlled-write or readback phase automatically.
 */
export function commissioningRecoveryAction(
  job:
    | {
        status: string;
        state: CommissioningState;
      }
    | null
    | undefined
): CommissioningRecoveryAction {
  if (!job) return "start";
  if (job.status === "queued" || job.status === "running") return "resume";
  if (
    job.status === "needs_attention" &&
    SAFE_AUTOMATIC_RESTART_STATES.has(job.state)
  )
    return "restart_safe_reads";
  return "hold";
}

/**
 * Ensure an authenticated CRM has a commissioning lifecycle without turning
 * authentication into permission to write. Successful READY and
 * waiting-for-approval jobs are preserved exactly as they are. A
 * needs-attention job may restart automatically while it is in a read-only
 * state or when a previous terminal READY result failed core readiness. The
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
