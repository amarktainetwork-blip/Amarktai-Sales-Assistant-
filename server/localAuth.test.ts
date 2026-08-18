import { describe, expect, it } from "vitest";
import { DEVELOPMENT_PREVIEW_OPEN_ID, isDevelopmentPreviewMode, isDevelopmentPreviewUser, isLocalAuthMode } from "./localAuth";

describe("Webdock local authentication mode", () => {
  it("activates only when explicitly configured", () => {
    const previous = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "local";
    expect(isLocalAuthMode()).toBe(true);
    process.env.AUTH_MODE = "managed";
    expect(isLocalAuthMode()).toBe(false);
    process.env.AUTH_MODE = previous;
  });
  it("enables preview access only during development", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    expect(isDevelopmentPreviewMode()).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isDevelopmentPreviewMode()).toBe(false);
    process.env.NODE_ENV = previous;
  });
  it("recognises the disposable preview identity only in development", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    expect(isDevelopmentPreviewUser({ openId: DEVELOPMENT_PREVIEW_OPEN_ID })).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isDevelopmentPreviewUser({ openId: DEVELOPMENT_PREVIEW_OPEN_ID })).toBe(false);
    process.env.NODE_ENV = previous;
  });
});
