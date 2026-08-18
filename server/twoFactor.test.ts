import { describe, expect, it } from "vitest";
import { compareVerificationCode, createVerificationChallenge } from "./twoFactor";

describe("two-factor challenge helpers", () => {
  it("accepts only the code issued for the same user", () => {
    const challenge = createVerificationChallenge(42);
    expect(compareVerificationCode(42, challenge.code, challenge.codeHash)).toBe(true);
    expect(compareVerificationCode(43, challenge.code, challenge.codeHash)).toBe(false);
    expect(compareVerificationCode(42, "000000", challenge.codeHash)).toBe(challenge.code === "000000");
  });

  it("sets a ten-minute expiry window", () => {
    const now = Date.now();
    const challenge = createVerificationChallenge(42);
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(now + 9 * 60 * 1000);
    expect(challenge.expiresAt.getTime()).toBeLessThanOrEqual(now + 10 * 60 * 1000 + 1000);
  });
});
