import { expect, it } from "vitest";
import { isRetryableGenieMailboxRead } from "./genieMailboxRetry";
import { browserOperationStatusAfterResult } from "./browserConnectors/learnedOperations";
import { isTransientBrowserExecutionFailure } from "./browserConnectors/runtimeFailure";
it.each([
  "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
  "CRM_VIEWER_HUMAN_CONTROL_ACTIVE",
  "GENIE_MAILBOX_UNREAD_STATE_CHANGED",
  "GENIE_CONTACT_SEARCH_HTTP_ERROR: Contacts search returned HTTP 503.",
  "GENIE_CONTACT_SEARCH_HTTP_ERROR: Contacts search page 17 returned HTTP 520.",
])(
  "defers %s without converting a proven read to a failed definition",
  detail => {
    expect(isRetryableGenieMailboxRead(Error(detail))).toBe(true);
    if (isTransientBrowserExecutionFailure(detail))
      expect(
        browserOperationStatusAfterResult({
          currentStatus: "LIVE_PROVEN",
          success: false,
          publish: false,
          watchdog: true,
          transient: true,
        })
      ).toBe("LIVE_PROVEN");
  }
);
it("does not suppress identity or authentication failures", () => {
  expect(isRetryableGenieMailboxRead(Error("CRM_OWNER_SCOPE_VIOLATION"))).toBe(
    false
  );
  expect(isRetryableGenieMailboxRead(Error("HTTP 401"))).toBe(false);
});
