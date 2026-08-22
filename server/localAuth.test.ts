import { describe, expect, it } from "vitest";
import { isLocalAuthMode } from "./localAuth";

describe("Webdock local authentication mode", () => {
  it("activates only when explicitly configured", () => {
    const previous = process.env.AUTH_MODE;
    process.env.AUTH_MODE = "local";
    expect(isLocalAuthMode()).toBe(true);
    process.env.AUTH_MODE = "managed";
    expect(isLocalAuthMode()).toBe(false);
    process.env.AUTH_MODE = previous;
  });
});
