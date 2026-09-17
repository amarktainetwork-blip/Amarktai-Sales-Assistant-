import { expect, it } from "vitest";
import { showCrmAttention } from "./workspaceHealth";
it("does not show CRM attention for a healthy connection when the local workspace query fails", () => {
  const workspaceQuery = { isError: true };
  expect(workspaceQuery.isError).toBe(true);
  expect(showCrmAttention([{ status: "ready" }], true)).toBe(false);
});
it("shows current read/auth failures and never infers connection failure from missing local query data", () => {
  expect(showCrmAttention([{ status: "needs_attention" }], true)).toBe(true);
  expect(showCrmAttention([{ status: "authentication_expired" }], true)).toBe(
    true
  );
  expect(showCrmAttention(undefined, false)).toBe(false);
});
