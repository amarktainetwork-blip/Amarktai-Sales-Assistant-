import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type HeartbeatJob = {
  name: string;
  /** 6-field cron with seconds (`sec min hour dom mon dow`), UTC. */
  cron: string;
  path: string;
  method?: "POST" | "PUT";
  payload?: unknown;
  description?: string;
};

export type HeartbeatJobUpdate = Partial<Omit<HeartbeatJob, "name">> & { enable?: boolean };
export type HeartbeatJobInfo = {
  taskUid: string;
  name: string;
  userId: string;
  description: string;
  cronExpression: string;
  callbackPath: string;
  callbackMethod: string;
  callbackPayload: string;
  isEnable: boolean;
  createdAt?: string | null;
  lastExecutedAt?: string | null;
  nextExecutionAt?: string | null;
};

function validateCallbackPath(path: string): void {
  if (!path || !path.startsWith("/api/scheduled/")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "callback path must start with /api/scheduled/" });
  }
}

/**
 * Compatibility boundary for legacy callers. The self-hosted reporter worker
 * evaluates durable report rows in MariaDB; no remote task service is used.
 */
export async function createHeartbeatJob(job: HeartbeatJob, _userSession: string): Promise<{ taskUid: string; nextExecutionAt: null }> {
  validateCallbackPath(job.path);
  return { taskUid: `local_${randomUUID()}`, nextExecutionAt: null };
}

export async function updateHeartbeatJob(_taskUid: string, patch: HeartbeatJobUpdate, _userSession: string): Promise<{ nextExecutionAt: null }> {
  if (patch.path !== undefined) validateCallbackPath(patch.path);
  return { nextExecutionAt: null };
}

export async function deleteHeartbeatJob(_taskUid: string, _userSession: string): Promise<void> {
  return;
}

export async function listHeartbeatJobs(_userSession: string, _pagination?: { page?: number; pageSize?: number }): Promise<{ total: number; actorUserId: string; jobs: HeartbeatJobInfo[] }> {
  return { total: 0, actorUserId: "self_hosted", jobs: [] };
}
