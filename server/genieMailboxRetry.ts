import { isTransientBrowserExecutionFailure } from "./browserConnectors/runtimeFailure";
export function isRetryableGenieMailboxRead(error: unknown) {
  return (
    isTransientBrowserExecutionFailure(error) ||
    (error instanceof Error &&
      error.message === "GENIE_MAILBOX_UNREAD_STATE_CHANGED")
  );
}
