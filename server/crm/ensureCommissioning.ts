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
 * discovery/read proof, but a terminal READY result is never implicitly
 * restarted. That prevents routine viewer/session checks from competing with
 * normal background synchronization after useful operations are already live.
 * A manager can still explicitly restart commissioning when further capability
 * repair or controlled verification is intended.
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
