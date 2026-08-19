import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { isLocalAuthMode } from "../localAuth";
import { ENV } from "./env";

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

const SERVICE = "webdevtoken.v1.WebDevService";

const validateCallbackPath = (path: string): void => {
  if (!path || !path.startsWith("/api/scheduled/")) throw new TRPCError({ code: "BAD_REQUEST", message: "callback path must start with /api/scheduled/" });
};

const buildEndpoint = (rpc: string): string => {
  if (!ENV.forgeApiUrl) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Heartbeat service URL is not configured." });
  if (!ENV.forgeApiKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Heartbeat service API key is not configured." });
  const normalizedBase = ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`;
  return new URL(`${SERVICE}/${rpc}`, normalizedBase).toString();
};

const callForge = async <T>(rpc: string, body: Record<string, unknown>, userSession: string): Promise<T> => {
  const headers: Record<string, string> = { accept: "application/json", authorization: `Bearer ${ENV.forgeApiKey}`, "content-type": "application/json", "connect-protocol-version": "1" };
  if (userSession) headers["x-manus-user-session"] = userSession;
  let response: Response;
  try {
    response = await fetch(buildEndpoint(rpc), { method: "POST", headers, body: JSON.stringify(body) });
  } catch (error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Heartbeat ${rpc} network error: ${String(error)}` });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const status = response.status;
    let code: TRPCError["code"] = "INTERNAL_SERVER_ERROR";
    if (status === 401) code = "UNAUTHORIZED";
    else if (status === 403) code = "FORBIDDEN";
    else if (status === 404) code = "NOT_FOUND";
    else if (status === 400 || status === 422) code = "BAD_REQUEST";
    else if (status === 409) code = "CONFLICT";
    else if (status === 429) code = "TOO_MANY_REQUESTS";
    throw new TRPCError({ code, message: `Heartbeat ${rpc} failed (${status})${detail ? `: ${detail}` : ""}` });
  }
  return (await response.json()) as T;
};

const stringifyPayload = (payload: unknown): string => payload == null ? "{}" : typeof payload === "string" ? payload : JSON.stringify(payload);

/**
 * On Webdock/local-auth deployments the durable report rows are owned by MariaDB and
 * `reportSchedulerWorker.ts` evaluates their cron expressions. We still return a local
 * task UID to preserve the existing application contract without depending on Manus.
 */
export async function createHeartbeatJob(job: HeartbeatJob, userSession: string): Promise<{ taskUid: string; nextExecutionAt?: string | null }> {
  validateCallbackPath(job.path);
  if (isLocalAuthMode()) return { taskUid: `local_${randomUUID()}`, nextExecutionAt: null };
  return callForge("CreateHeartbeatJob", { name: job.name, cronExpression: job.cron, callbackPath: job.path, callbackMethod: job.method ?? "POST", callbackPayload: stringifyPayload(job.payload), description: job.description ?? "" }, userSession);
}

export async function updateHeartbeatJob(taskUid: string, patch: HeartbeatJobUpdate, userSession: string): Promise<{ nextExecutionAt?: string | null }> {
  if (patch.path !== undefined) validateCallbackPath(patch.path);
  if (isLocalAuthMode()) return { nextExecutionAt: null };
  const body: Record<string, unknown> = { taskUid };
  if (patch.cron !== undefined) body.cronExpression = patch.cron;
  if (patch.path !== undefined) body.callbackPath = patch.path;
  if (patch.method !== undefined) body.callbackMethod = patch.method;
  if (patch.payload !== undefined) body.callbackPayload = stringifyPayload(patch.payload);
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.enable !== undefined) body.enable = patch.enable;
  return callForge("UpdateHeartbeatJob", body, userSession);
}

export async function deleteHeartbeatJob(taskUid: string, userSession: string): Promise<void> {
  if (isLocalAuthMode()) return;
  await callForge("DeleteHeartbeatJob", { taskUid }, userSession);
}

export async function listHeartbeatJobs(userSession: string, pagination?: { page?: number; pageSize?: number }): Promise<{ total: number; actorUserId: string; jobs: HeartbeatJobInfo[] }> {
  if (isLocalAuthMode()) return { total: 0, actorUserId: "local", jobs: [] };
  const body: Record<string, unknown> = {};
  if (pagination?.page !== undefined) body.page = pagination.page;
  if (pagination?.pageSize !== undefined) body.pageSize = pagination.pageSize;
  return callForge("ListHeartbeatJobs", body, userSession);
}
