export type BrowserControlState = "AGENT_CONTROL" | "HUMAN_CONTROL" | "IDLE";

type ControlKey = {
  organisationId: number;
  connectedSystemId: number;
  userId: number;
};

type Lease = {
  state: BrowserControlState;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<(state: BrowserControlState) => void>;
};

const leases = new Map<string, Lease>();
const DEFAULT_LEASE_MS = 8_000;

function keyOf(input: ControlKey) {
  return `${input.organisationId}:${input.connectedSystemId}:${input.userId}`;
}

function emit(lease: Lease) {
  lease.listeners.forEach(listener => listener(lease.state));
}

function clearTimer(lease: Lease) {
  if (lease.timer) clearTimeout(lease.timer);
  lease.timer = undefined;
}

function releaseLease(key: string, lease: Lease) {
  clearTimer(lease);
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
    releaseLease(key, lease);
  return { key, lease };
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
  clearTimer(lease);
  lease.state = state;
  lease.expiresAt = Date.now() + ttlMs;
  lease.timer = setTimeout(() => releaseLease(key, lease), ttlMs);
  emit(lease);
  return { control: state, expiresAt: new Date(lease.expiresAt).toISOString() };
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
  releaseLease(key, lease);
  return { control: "IDLE" as const };
}

export function browserControlState(input: ControlKey) {
  return getLease(input).lease.state;
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
  leases.forEach((lease, key) => releaseLease(key, lease));
  leases.clear();
}

export const BROWSER_CONTROL_DEFAULT_LEASE_MS = DEFAULT_LEASE_MS;
