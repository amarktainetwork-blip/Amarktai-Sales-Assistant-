import { describe, expect, it, vi } from "vitest";
import {
  canAcceptBrowserInput,
  dispatchPlaywrightInput,
  isLiveCrmViewerAccessAllowed,
  shouldForwardScreencastFrame,
  shouldReuseLiveCrmViewerSession,
} from "./liveCrmViewer";
import { readFileSync } from "node:fs";

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

  it("uses Playwright page mouse and keyboard input", async () => {
    const page = {
      mouse: {
        move: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
        wheel: vi.fn(async () => undefined),
      },
      keyboard: {
        insertText: vi.fn(async () => undefined),
        down: vi.fn(async () => undefined),
        up: vi.fn(async () => undefined),
      },
    };
    await dispatchPlaywrightInput(page as never, {
      kind: "mouse",
      type: "mousePressed",
      x: 120,
      y: 90,
      button: "left",
      clickCount: 1,
    });
    await dispatchPlaywrightInput(page as never, {
      kind: "key",
      type: "keyDown",
      text: "hello",
    });
    expect(page.mouse.move).toHaveBeenCalledWith(120, 90);
    expect(page.mouse.down).toHaveBeenCalledWith({
      button: "left",
      clickCount: 1,
    });
    expect(page.keyboard.insertText).toHaveBeenCalledWith("hello");
  });
});

describe("live CRM viewer reconnect", () => {
  it("releases browser control when the final human viewer disconnects", () => {
    const source = readFileSync(
      new URL("./liveCrmViewer.ts", import.meta.url),
      "utf8"
    );
    expect(source).toMatch(
      /if \(!session\.sockets\.size\) \{[\s\S]*releaseBrowserControl\(controlScope\(session\)\)/
    );
  });

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
