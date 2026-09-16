import { it, expect } from "vitest";
import { isTransientCrmSyncFailure } from "./sync";
it("does not hide permanent failures when another resource had transient contention", () => {
  const mixed = Object.assign(
    new Error(
      "CRM_SYNC_PARTIAL_FAILURE: tasks: CRM_VIEWER_AGENT_CONTROL_ACTIVE; contacts: TARGET_MISMATCH"
    ),
    { transient: false }
  );
  expect(isTransientCrmSyncFailure(mixed)).toBe(false);
  const retry = Object.assign(
    new Error(
      "CRM_SYNC_PARTIAL_FAILURE: tasks: CRM_VIEWER_AGENT_CONTROL_ACTIVE"
    ),
    { transient: true }
  );
  expect(isTransientCrmSyncFailure(retry)).toBe(true);
  expect(
    isTransientCrmSyncFailure(new Error("CRM_BROWSER_CONTROL_LEASE_LOST"))
  ).toBe(true);
});
