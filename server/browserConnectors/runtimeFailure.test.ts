import { describe, expect, it, vi } from "vitest";
import {
  classifyBrowserRuntimeFailure,
  recordLearnedRuntimeFailure,
} from "./runtimeFailure";

describe("learned browser runtime failure truth", () => {
  it.each([
    ["TARGET_MISMATCH: wrong record", "target_mismatch"],
    ["AMBIGUOUS_TARGET: two rows", "ambiguous_target"],
    ["selector .save was not visible", "selector_drift"],
    ["deterministic click failed", "execution_failure"],
    ["EXECUTION_UNVERIFIED: postcondition mismatch", "postcondition_failure"],
    ["REAUTHENTICATION_REQUIRED", "authentication"],
    ["CDP transport timed out", "transient_transport"],
  ] as const)("classifies %s", (detail, expected) => {
    expect(classifyBrowserRuntimeFailure(detail)).toBe(expected);
  });

  it.each([
    "TARGET_MISMATCH",
    "AMBIGUOUS_TARGET",
    "selector missing",
    "click failed",
    "EXECUTION_UNVERIFIED",
  ])("records %s against only the attempted operation", async detail => {
    const record = vi.fn().mockResolvedValue({ status: "DEGRADED" });
    await recordLearnedRuntimeFailure(
      {
        organisationId: 3,
        connectedSystemId: 8,
        operationKey: "add_note",
        version: 4,
        correlationId: "corr-1",
        detail,
      },
      { record }
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 3,
        connectedSystemId: 8,
        operationKey: "add_note",
        version: 4,
        success: false,
        watchdog: true,
        evidence: expect.objectContaining({ correlationId: "corr-1" }),
      })
    );
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("records reauthentication without selector guessing and marks the connection", async () => {
    const record = vi.fn().mockResolvedValue({ status: "DEGRADED" });
    const markReauthentication = vi.fn().mockResolvedValue(undefined);
    const result = await recordLearnedRuntimeFailure(
      {
        organisationId: 3,
        connectedSystemId: 8,
        operationKey: "add_note",
        version: 4,
        correlationId: "corr-2",
        detail: "session expired; login required",
      },
      { record, markReauthentication }
    );
    expect(result.classification).toBe("authentication");
    expect(markReauthentication).toHaveBeenCalledTimes(1);
  });
});
