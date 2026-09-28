import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LIVE_CALL_ABANDON_GRACE_MS,
  shouldCheckpointAbandonedLiveCall,
} from "./store";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const client = readFileSync(
  new URL("../../client/src/pages/LiveCalls.tsx", import.meta.url),
  "utf8"
);

describe("live call recoverable lifecycle", () => {
  it("only checkpoints genuinely stale in-progress sessions", () => {
    const nowMs = new Date("2026-09-28T12:00:00.000Z").valueOf();
    expect(
      shouldCheckpointAbandonedLiveCall({
        status: "in_progress",
        updatedAt: new Date(nowMs - LIVE_CALL_ABANDON_GRACE_MS - 1),
        nowMs,
      })
    ).toBe(true);
    expect(
      shouldCheckpointAbandonedLiveCall({
        status: "in_progress",
        updatedAt: new Date(nowMs - LIVE_CALL_ABANDON_GRACE_MS + 1),
        nowMs,
      })
    ).toBe(false);
    expect(
      shouldCheckpointAbandonedLiveCall({
        status: "ready_for_review",
        updatedAt: new Date(nowMs - LIVE_CALL_ABANDON_GRACE_MS * 4),
        nowMs,
      })
    ).toBe(false);
  });

  it("uses in-progress -> ready-for-review -> completed without allowing a late stop downgrade", () => {
    expect(storeSource).toContain('if (session.status === "completed")');
    expect(storeSource).toContain('status: "completed"');
    expect(client).toContain('status: "ready_for_review" | "completed"');
  });

  it("persists the canonical Review workflow id before marking closeout completed", () => {
    const workflowIndex = routes.indexOf("await prepareClaimedCloseoutWorkflow");
    const completeIndex = routes.indexOf("await completeLiveCallExact");
    expect(routes).toContain("closeoutWorkflowRunId: claim.workflowRunId");
    expect(workflowIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(workflowIndex);
  });

  it("reconciles abandoned sessions without fabricating outcomes", () => {
    expect(routes).toContain("reconcileAbandonedLiveCallsForUser");
    expect(routes).toContain("/api/live-calls/readiness");
    expect(client).toContain('navigator.sendBeacon("/api/live-calls/stop"');
    expect(client).toContain("checkpointSessionForReview(activeSessionId, \"\")");
  });
});
