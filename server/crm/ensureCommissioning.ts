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
 * commissioning job. The important production boundary is that simply
 * reopening an authenticated CRM may recover discovery/read proof, but it
 * must never restart a controlled-write or readback phase automatically.
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
 * authentication into permission to write. Existing READY and
 * waiting-for-approval jobs are preserved exactly as they are. A
 * needs-attention job is only restarted automatically while it is still in a
 * discovery/read-only state.
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
