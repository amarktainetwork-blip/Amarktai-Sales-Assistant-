import { describe, expect, it } from "vitest";
import {
  canAcceptBrowserInput,
  isLiveCrmViewerAccessAllowed,
  shouldForwardScreencastFrame,
  shouldReuseLiveCrmViewerSession,
} from "./liveCrmViewer";

const viewerToken = Buffer.from("viewer-token-for-test").toString("base64url");
const session = {
  organisationId: 18,
  connectedSystemId: 44,
  userId: 7,
  token: Buffer.from("viewer-token-for-test"),
};

describe("live CRM viewer access scope", () => {
  it("allows only the session owner in the active organisation with the exact short-lived token", () => {
    expect(
      isLiveCrmViewerAccessAllowed(session, {
        organisationId: 18,
        userId: 7,
        token: viewerToken,
      })
    ).toBe(true);
  });

  it("rejects an attempt by a different user to open the same session", () => {
    expect(
      isLiveCrmViewerAccessAllowed(session, {
        organisationId: 18,
        userId: 8,
        token: viewerToken,
      })
    ).toBe(false);
  });

  it("rejects an organisation mismatch and an invalid token", () => {
    expect(
      isLiveCrmViewerAccessAllowed(session, {
        organisationId: 19,
        userId: 7,
        token: viewerToken,
      })
    ).toBe(false);
    expect(
      isLiveCrmViewerAccessAllowed(session, {
        organisationId: 18,
        userId: 7,
        token: "wrong-token",
      })
    ).toBe(false);
  });
});

describe("live CRM stream bounds", () => {
  it("accepts input only while the human owns control", () => {
    expect(canAcceptBrowserInput("HUMAN_CONTROL")).toBe(true);
    expect(canAcceptBrowserInput("AGENT_CONTROL")).toBe(false);
    expect(canAcceptBrowserInput("IDLE")).toBe(false);
  });

  it("drops stale, oversized, hidden, and unobserved frames", () => {
    const base = {
      visible: true,
      socketCount: 1,
      now: 1_000,
      lastFrameAt: 800,
      bytes: 100_000,
    };
    expect(shouldForwardScreencastFrame(base)).toBe(true);
    expect(shouldForwardScreencastFrame({ ...base, lastFrameAt: 951 })).toBe(
      false
    );
    expect(shouldForwardScreencastFrame({ ...base, bytes: 2_000_000 })).toBe(
      false
    );
    expect(shouldForwardScreencastFrame({ ...base, visible: false })).toBe(
      false
    );
    expect(shouldForwardScreencastFrame({ ...base, socketCount: 0 })).toBe(
      false
    );
  });
});

describe("live CRM viewer reconnect", () => {
  it("replaces a cached viewer only when reconnect is explicit", () => {
    expect(
      shouldReuseLiveCrmViewerSession({
        forceReconnect: false,
        expiresAt: 2_000,
        now: 1_000,
      })
    ).toBe(true);
    expect(
      shouldReuseLiveCrmViewerSession({
        forceReconnect: true,
        expiresAt: 2_000,
        now: 1_000,
      })
    ).toBe(false);
  });
});
