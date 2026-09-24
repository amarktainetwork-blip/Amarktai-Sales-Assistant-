import { describe, expect, it } from "vitest";
import {
  connectionStatusAfterVerification,
  isTransientConnectionVerificationFailure,
} from "./connectedSystems";

describe("connected system health stability", () => {
  it("keeps a proven read connection healthy during internal browser contention", () => {
    expect(
      connectionStatusAfterVerification({
        currentStatus: "ready",
        testStatus: "failed",
        summary: "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
      })
    ).toBe("ready");
    expect(
      connectionStatusAfterVerification({
        currentStatus: "limited_permissions",
        testStatus: "failed",
        summary: "CRM_WORKER_BUSY",
      })
    ).toBe("limited_permissions");
  });

  it("does not hide genuine connection failures", () => {
    expect(
      connectionStatusAfterVerification({
        currentStatus: "ready",
        testStatus: "failed",
        summary: "AUTHENTICATION_EXPIRED",
      })
    ).toBe("needs_attention");
    expect(
      connectionStatusAfterVerification({
        currentStatus: "ready",
        testStatus: "failed",
        summary: "selector drift on contacts page",
      })
    ).toBe("needs_attention");
    expect(
      connectionStatusAfterVerification({
        currentStatus: "connecting",
        testStatus: "failed",
        summary: "CRM_VIEWER_AGENT_CONTROL_ACTIVE",
      })
    ).toBe("needs_attention");
  });

  it("classifies only retryable transport/control failures as transient", () => {
    expect(
      isTransientConnectionVerificationFailure(
        "CRM_VIEWER_AGENT_CONTROL_ACTIVE"
      )
    ).toBe(true);
    expect(
      isTransientConnectionVerificationFailure(
        "GENIE_CONTACT_SEARCH_HTTP_ERROR: HTTP 520"
      )
    ).toBe(true);
    expect(
      isTransientConnectionVerificationFailure("AUTHENTICATION_EXPIRED")
    ).toBe(false);
  });
});
