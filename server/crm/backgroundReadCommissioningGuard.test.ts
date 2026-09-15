import { describe, expect, it } from "vitest";
import { commissioningBlocksBackgroundReads } from "./backgroundReadCommissioningGuard";

describe("background CRM read commissioning guard", () => {
  it("blocks routine browser readers while commissioning owns the connection", () => {
    expect(commissioningBlocksBackgroundReads("queued")).toBe(true);
    expect(commissioningBlocksBackgroundReads("running")).toBe(true);
  });

  it("releases routine readers after commissioning reaches a terminal or approval state", () => {
    expect(commissioningBlocksBackgroundReads("ready")).toBe(false);
    expect(commissioningBlocksBackgroundReads("needs_attention")).toBe(false);
    expect(commissioningBlocksBackgroundReads("waiting_for_approval")).toBe(false);
    expect(commissioningBlocksBackgroundReads(null)).toBe(false);
  });
});
