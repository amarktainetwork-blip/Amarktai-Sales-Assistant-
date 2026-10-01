import { describe, expect, it } from "vitest";
import { terminalCommissioningRecoveryStatus } from "./automaticCommissioning";

describe("terminal CRM commissioning recovery", () => {
  const ready = {
    completedAt: new Date("2026-10-01T12:04:30Z"),
    lastError: null,
    progress: {
      humanStatus: "Ready",
      capabilityAccounting: { complete: true },
    },
  };
  it("preserves a genuinely proven completed release", () => {
    expect(terminalCommissioningRecoveryStatus(ready)).toBe("ready");
  });
  it("never promotes a completed but failed or partial run", () => {
    expect(
      terminalCommissioningRecoveryStatus({
        ...ready,
        lastError: "initial sync failed",
      })
    ).toBe("needs_attention");
    expect(
      terminalCommissioningRecoveryStatus({
        ...ready,
        progress: {
          humanStatus: "Core functions need setup",
          capabilityAccounting: { complete: false },
        },
      })
    ).toBe("needs_attention");
    expect(
      terminalCommissioningRecoveryStatus({ ...ready, completedAt: null })
    ).toBe("needs_attention");
  });
});
