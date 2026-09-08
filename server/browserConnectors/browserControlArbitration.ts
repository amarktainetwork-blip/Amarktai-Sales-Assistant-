import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type BrowserControlState = "AGENT_CONTROL" | "HUMAN_CONTROL" | "IDLE";

type ControlKey = {
  organisationId: number;
  connectedSystemId: number;
  userId: number;
};

type SharedLeaseRecord = {
  token: string;
  state: Exclude<BrowserControlState, "IDLE">;
  expiresAt: number;
  pid: number;
};

type Lease = {
  state: BrowserControlState;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  sharedToken?: string;
  listeners: Set<(state: BrowserControlState) => void>;
};

const leases = new Map<string, Lease>();
const DEFAULT_LEASE_MS = 8_000;
const MIN_SHARED_LEASE_MS = 30_000;
const SHARED_LEASE_ROOT =
  process.env.CRM_BROWSER_CONTROL_LEASE_DIR ||
  (process.env.NODE_ENV === "test"
    ? join("/tmp", `amarktai-browser-control-${process.pid}`)
    : "/app/data/connector-evidence/.browser-control-leases");

function assertControlKey(input: ControlKey) {
  for (const value of [
    input.organisationId,
    input.connectedSystemId,
    input.userId,
  ])
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("CRM_BROWSER_CONTROL_SCOPE_INVALID");
}

function keyOf(input: ControlKey) {
  assertControlKey(input);
  return `${input.organisationId}:${input.connectedSystemId}:${input.userId}`;
}

function sharedLeasePath(input: ControlKey) {
  assertControlKey(input);
  return join(
    SHARED_LEASE_ROOT,
    String(input.organisationId),
    String(input.connectedSystemId),
    String(input.userId)
  );
}

function sharedRecordPath(input: ControlKey) {
  return join(sharedLeasePath(input), "lease.json");
}

function readSharedLease(input: ControlKey): SharedLeaseRecord | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(sharedRecordPath(input), "utf8")
    ) as Partial<SharedLeaseRecord>;
    if (
      typeof parsed.token !== "string" ||
      !["AGENT_CONTROL", "HUMAN_CONTROL"].includes(String(parsed.state)) ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    )
      return undefined;
    return parsed as SharedLeaseRecord;
  } catch {
    return undefined;
  }
}

function removeSharedLease(input: ControlKey, expectedToken?: string) {
  const existing = readSharedLease(input);
  if (expectedToken && existing?.token !== expectedToken) return false;
  try {
    rmSync(sharedLeasePath(input), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function acquireSharedLease(
  input: ControlKey,
  state: Exclude<BrowserControlState, "IDLE">,
  requestedTtlMs: number,
  existingToken?: string
) {
  const ttlMs = Math.max(MIN_SHARED_LEASE_MS, requestedTtlMs);
  const path = sharedLeasePath(input);
  const now = Date.now();
  const existing = readSharedLease(input);

  if (existingToken && existing?.token === existingToken) {
    const renewed = { ...existing, state, expiresAt: now + ttlMs };
    writeFileSync(sharedRecordPath(input), JSON.stringify(renewed), {
      encoding: "utf8",
      mode: 0o600,
    });
    return renewed;
  }

  if (existing && existing.expiresAt > now)
    throw new Error(
      state === "AGENT_CONTROL"
        ? "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
        : "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    );
  if (existing || !existingToken) removeSharedLease(input);

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    const concurrent = readSharedLease(input);
    if (concurrent && concurrent.expiresAt <= Date.now()) {
      removeSharedLease(input);
      return acquireSharedLease(input, state, requestedTtlMs);
    }
    throw new Error(
      state === "AGENT_CONTROL"
        ? "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
        : "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
      { cause: error }
    );
  }
  const record: SharedLeaseRecord = {
    token,
    state,
    expiresAt: now + ttlMs,
    pid: process.pid,
  };
  try {
    writeFileSync(sharedRecordPath(input), JSON.stringify(record), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw new Error("CRM_BROWSER_CONTROL_COORDINATION_UNAVAILABLE", {
      cause: error,
    });
  }
  return record;
}

function emit(lease: Lease) {
  lease.listeners.forEach(listener => listener(lease.state));
}

function clearTimer(lease: Lease) {
  if (lease.timer) clearTimeout(lease.timer);
  lease.timer = undefined;
}

function localRelease(
  input: ControlKey,
  key: string,
  lease: Lease,
  releaseShared = true
) {
  clearTimer(lease);
  if (releaseShared && lease.sharedToken)
    removeSharedLease(input, lease.sharedToken);
  lease.sharedToken = undefined;
  lease.state = "IDLE";
  lease.expiresAt = undefined;
  emit(lease);
  if (!lease.listeners.size) leases.delete(key);
}

function getLease(input: ControlKey) {
  const key = keyOf(input);
  let lease = leases.get(key);
  if (!lease) {
    lease = { state: "IDLE", listeners: new Set() };
    leases.set(key, lease);
  }
  if (lease.expiresAt && lease.expiresAt <= Date.now())
    localRelease(input, key, lease);
  return { key, lease };
}

function armRenewal(
  input: ControlKey,
  key: string,
  lease: Lease,
  state: Exclude<BrowserControlState, "IDLE">,
  requestedTtlMs: number
) {
  clearTimer(lease);
  const ttlMs = Math.max(MIN_SHARED_LEASE_MS, requestedTtlMs);
  const renewIn = Math.max(1_000, Math.floor(ttlMs / 3));
  lease.timer = setTimeout(() => {
    try {
      const shared = acquireSharedLease(
        input,
        state,
        ttlMs,
        lease.sharedToken
      );
      lease.sharedToken = shared.token;
      lease.expiresAt = shared.expiresAt;
      armRenewal(input, key, lease, state, ttlMs);
    } catch {
      // Losing the shared lease must immediately revoke local control. This
      // fails closed rather than allowing app and worker to act concurrently.
      localRelease(input, key, lease, false);
    }
  }, renewIn);
  lease.timer.unref?.();
}

function acquire(
  input: ControlKey,
  state: Extract<BrowserControlState, "AGENT_CONTROL" | "HUMAN_CONTROL">,
  ttlMs = DEFAULT_LEASE_MS
) {
  const { key, lease } = getLease(input);
  if (lease.state !== "IDLE" && lease.state !== state)
    throw new Error(
      state === "AGENT_CONTROL"
        ? "CRM_VIEWER_HUMAN_CONTROL_ACTIVE"
        : "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    );

  const shared = acquireSharedLease(
    input,
    state,
    ttlMs,
    lease.state === state ? lease.sharedToken : undefined
  );
  lease.state = state;
  lease.sharedToken = shared.token;
  lease.expiresAt = shared.expiresAt;
  armRenewal(input, key, lease, state, ttlMs);
  emit(lease);
  return { control: state, expiresAt: new Date(shared.expiresAt).toISOString() };
}

export function acquireHumanBrowserControl(
  input: ControlKey,
  ttlMs = DEFAULT_LEASE_MS
) {
  return acquire(input, "HUMAN_CONTROL", ttlMs);
}

export function acquireAiBrowserControl(
  input: ControlKey,
  ttlMs = DEFAULT_LEASE_MS
) {
  return acquire(input, "AGENT_CONTROL", ttlMs);
}

export function releaseBrowserControl(input: ControlKey) {
  const { key, lease } = getLease(input);
  localRelease(input, key, lease);
  return { control: "IDLE" as const };
}

export function browserControlState(input: ControlKey) {
  const { key, lease } = getLease(input);
  if (lease.state !== "IDLE" && lease.sharedToken) {
    const shared = readSharedLease(input);
    if (
      !shared ||
      shared.token !== lease.sharedToken ||
      shared.expiresAt <= Date.now()
    )
      localRelease(input, key, lease, false);
  }
  return lease.state;
}

export function subscribeBrowserControl(
  input: ControlKey,
  listener: (state: BrowserControlState) => void
) {
  const { key, lease } = getLease(input);
  lease.listeners.add(listener);
  listener(lease.state);
  return () => {
    lease.listeners.delete(listener);
    if (!lease.listeners.size && lease.state === "IDLE") leases.delete(key);
  };
}

export function assertBrowserOperationCanRun(input: ControlKey) {
  const state = browserControlState(input);
  if (state === "HUMAN_CONTROL")
    throw new Error("CRM_VIEWER_HUMAN_CONTROL_ACTIVE");
  if (state === "AGENT_CONTROL")
    throw new Error("CRM_VIEWER_AGENT_CONTROL_ACTIVE");
}

export function resetBrowserControlArbitrationForTests() {
  leases.forEach((lease, key) => {
    const [organisationId, connectedSystemId, userId] = key
      .split(":")
      .map(Number);
    localRelease(
      { organisationId, connectedSystemId, userId },
      key,
      lease
    );
  });
  leases.clear();
  if (process.env.NODE_ENV === "test")
    rmSync(SHARED_LEASE_ROOT, { recursive: true, force: true });
}

export const BROWSER_CONTROL_DEFAULT_LEASE_MS = DEFAULT_LEASE_MS;
export const BROWSER_CONTROL_SHARED_LEASE_MIN_MS = MIN_SHARED_LEASE_MS;
