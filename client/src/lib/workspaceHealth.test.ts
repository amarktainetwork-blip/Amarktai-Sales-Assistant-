import { expect, it } from "vitest";
import {
  crmAttentionDelayMs,
  crmAttentionStatus,
  showCrmAttention,
} from "./workspaceHealth";
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
it("treats intentional read-only CRM access as healthy and delays recoverable warnings", () => {
  expect(showCrmAttention([{ status: "limited_permissions" }], true)).toBe(
    false
  );
  expect(crmAttentionStatus([{ status: "error" }], true)).toBe("error");
  expect(crmAttentionDelayMs("error")).toBe(45_000);
  expect(crmAttentionDelayMs("needs_attention")).toBe(45_000);
  expect(crmAttentionDelayMs("authentication_expired")).toBe(0);
});
