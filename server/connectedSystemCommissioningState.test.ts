import { describe, expect, it } from "vitest";
import { connectionStatusWhenStarting } from "./connectedSystems";

describe("browser CRM commissioning lifecycle", () => {
  it("starts a fresh browser CRM in connecting rather than disconnected", () => {
    expect(connectionStatusWhenStarting({ connectionMethod: "browser" })).toBe(
      "connecting"
    );
  });

  it("restarts disconnected or errored browser CRM commissioning", () => {
    expect(
      connectionStatusWhenStarting({
        connectionMethod: "browser",
        currentStatus: "disconnected",
      })
    ).toBe("connecting");
    expect(
      connectionStatusWhenStarting({
        connectionMethod: "browser",
        currentStatus: "error",
      })
    ).toBe("connecting");
  });

  it("does not downgrade an already progressing or verified browser CRM", () => {
    expect(
      connectionStatusWhenStarting({
        connectionMethod: "browser",
        currentStatus: "testing",
      })
    ).toBe("testing");
    expect(
      connectionStatusWhenStarting({
        connectionMethod: "browser",
        currentStatus: "ready",
      })
    ).toBe("ready");
  });

  it("leaves non-browser connection lifecycle semantics unchanged", () => {
    expect(connectionStatusWhenStarting({ connectionMethod: "oauth" })).toBe(
      "disconnected"
    );
    expect(
      connectionStatusWhenStarting({
        connectionMethod: "oauth",
        currentStatus: "ready",
      })
    ).toBe("ready");
  });
});
