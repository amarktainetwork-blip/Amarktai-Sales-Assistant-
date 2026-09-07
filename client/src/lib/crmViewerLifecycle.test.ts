import { describe, expect, it } from "vitest";
import { crmViewerPhase } from "./crmViewerLifecycle";

describe("CRM viewer lifecycle", () => {
  it("distinguishes starting, interactive login, authenticated and failed states", () => {
    expect(
      crmViewerPhase({
        socketReady: true,
        frameReceived: false,
        authenticationState: "STARTING",
        failed: false,
      })
    ).toBe("starting");
    expect(
      crmViewerPhase({
        socketReady: true,
        frameReceived: true,
        authenticationState: "LOGIN_REQUIRED",
        failed: false,
      })
    ).toBe("interactive");
    expect(
      crmViewerPhase({
        socketReady: true,
        frameReceived: true,
        authenticationState: "AUTHENTICATED",
        failed: false,
      })
    ).toBe("authenticated");
    expect(
      crmViewerPhase({
        socketReady: false,
        frameReceived: false,
        authenticationState: "ERROR",
        failed: true,
      })
    ).toBe("failed");
  });
});
