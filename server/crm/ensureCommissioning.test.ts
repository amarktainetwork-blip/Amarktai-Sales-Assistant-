import { describe, expect, it } from "vitest";
import { commissioningRecoveryAction } from "./ensureCommissioning";

describe("authenticated CRM commissioning recovery", () => {
  it("starts commissioning when an authenticated CRM has no durable job", () => {
    expect(commissioningRecoveryAction(null)).toBe("start");
  });

  it("resumes already queued or running work without replacing the job", () => {
    expect(
      commissioningRecoveryAction({
        status: "queued",
        state: "DISCOVER_CAPABILITIES",
      })
    ).toBe("resume");
    expect(
      commissioningRecoveryAction({
        status: "running",
        state: "TEST_SAFE_READS",
      })
    ).toBe("resume");
  });

  it("may recover a needs-attention job while it is read-only or after terminal core-readiness failure", () => {
    for (const state of [
      "AUTHENTICATE",
      "DISCOVER_NAVIGATION",
      "DISCOVER_CAPABILITIES",
      "TEST_SAFE_READS",
      "READY",
    ] as const) {
      expect(
        commissioningRecoveryAction({ status: "needs_attention", state })
      ).toBe("restart_safe_reads");
    }
  });

  it("never restarts approval, controlled writes, readback or publication from browser reopen", () => {
    for (const state of [
      "AWAIT_SAFE_TEST_RECORD",
      "TEST_CONTROLLED_WRITES",
      "VERIFY_READBACK",
      "PUBLISH_PROVEN_OPERATIONS",
    ] as const) {
      expect(
        commissioningRecoveryAction({ status: "needs_attention", state })
      ).toBe("hold");
    }
    expect(
      commissioningRecoveryAction({
        status: "waiting_for_approval",
        state: "AWAIT_SAFE_TEST_RECORD",
      })
    ).toBe("hold");
    expect(
      commissioningRecoveryAction({ status: "ready", state: "READY" })
    ).toBe("hold");
  });

  it("does not silently restart explicitly failed or cancelled jobs", () => {
    expect(
      commissioningRecoveryAction({
        status: "failed",
        state: "DISCOVER_NAVIGATION",
      })
    ).toBe("hold");
    expect(
      commissioningRecoveryAction({
        status: "cancelled",
        state: "TEST_SAFE_READS",
      })
    ).toBe("hold");
  });
});
