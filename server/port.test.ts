import { describe, expect, it } from "vitest";
import { getConfiguredPort } from "./port";

describe("configured production port", () => {
  it("uses exactly the configured valid port", () => {
    expect(getConfiguredPort("3000")).toBe(3000);
    expect(getConfiguredPort("4217")).toBe(4217);
  });

  it("rejects invalid ports instead of searching for another port", () => {
    expect(() => getConfiguredPort("0")).toThrow("PORT must be a valid TCP port.");
    expect(() => getConfiguredPort("not-a-port")).toThrow("PORT must be a valid TCP port.");
  });
});
