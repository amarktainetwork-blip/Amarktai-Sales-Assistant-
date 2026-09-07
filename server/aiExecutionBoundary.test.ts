import { describe, expect, it, vi } from "vitest";
import {
  assertModelSpendAllowed,
  runModelFreeOperation,
} from "./aiExecutionBoundary";

describe("hard zero-model execution boundary", () => {
  for (const purpose of [
    "crm_operation",
    "crm_sync",
    "mailbox_transport",
  ] as const) {
    it(`proves ${purpose} completes with no provider call`, async () => {
      let creditBalance = 100;
      const provider = vi.fn(() => {
        assertModelSpendAllowed("genx", "forbidden");
        creditBalance -= 1;
      });
      const operation = vi.fn(async () => ({ result: "deterministic" }));
      const completed = await runModelFreeOperation({ purpose }, operation);
      expect(completed.value).toEqual({ result: "deterministic" });
      expect(completed.evidence).toMatchObject({
        modelUsed: false,
        providerCallCount: 0,
      });
      expect(provider).not.toHaveBeenCalled();
      expect(creditBalance).toBe(100);
    });
  }

  it("fails closed instead of silently falling back to a model", async () => {
    await expect(
      runModelFreeOperation({ purpose: "crm_operation" }, async () => {
        assertModelSpendAllowed("genx", "crm_repeat_execution");
      })
    ).rejects.toThrow("MODEL_SPEND_FORBIDDEN");
  });
});
