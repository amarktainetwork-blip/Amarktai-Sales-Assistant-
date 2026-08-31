import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluatePreOtpSignals,
  PRE_OTP_CHECKS,
  presentPreOtpReadiness,
  type PreOtpSignals,
} from "./preOtpReadiness";

function all(value: boolean) {
  return Object.fromEntries(
    PRE_OTP_CHECKS.map(check => [check, value])
  ) as PreOtpSignals;
}

describe("Genie pre-OTP hard gate", () => {
  it("passes only when all 19 non-MFA checks pass", () => {
    expect(PRE_OTP_CHECKS).toHaveLength(19);
    expect(evaluatePreOtpSignals(all(true))).toBe(true);
    for (const check of PRE_OTP_CHECKS) {
      const signals = all(true);
      signals[check] = false;
      expect(evaluatePreOtpSignals(signals), check).toBe(false);
    }
  });

  it("returns the four customer-facing readiness states and safe diagnostics", () => {
    const readiness = presentPreOtpReadiness(all(true));
    expect(readiness.ready).toBe(true);
    expect(readiness.labels).toEqual({
      browserReady: "Browser ready",
      genieLoginReachable: "Genie login reachable",
      secureSignInReady: "Secure sign-in ready",
      sessionHandoffReady: "Session handoff ready",
    });
    expect(readiness.states).toEqual({
      browserReady: true,
      genieLoginReachable: true,
      secureSignInReady: true,
      sessionHandoffReady: true,
    });
    expect(readiness.advancedDiagnostics).toHaveLength(19);
    expect(JSON.stringify(readiness)).not.toMatch(
      /password|username|token|cookie/i
    );
  });

  it("fails closed before management elevation", () => {
    const signals = all(false);
    const readiness = presentPreOtpReadiness(
      signals,
      "Management verification is required."
    );
    expect(readiness.ready).toBe(false);
    expect(Object.values(readiness.states).every(value => !value)).toBe(true);
  });

  it("waits for the rendered login controls and keeps every CDP readiness/consume client disposable without closing shared Chromium", () => {
    const readinessSource = readFileSync(
      new URL("./preOtpReadiness.ts", import.meta.url),
      "utf8"
    );
    const routeSource = readFileSync(
      new URL("../connectedSystemAdminRoutes.ts", import.meta.url),
      "utf8"
    );
    const verifierSource = readFileSync(
      new URL("../verifyGeniePreOtp.ts", import.meta.url),
      "utf8"
    );
    expect(readinessSource).toContain("LOGIN_RENDER_TIMEOUT_MS = 15_000");
    expect(readinessSource).toContain("waitForLoginControls");
    expect(readinessSource).toContain("locator.nth(index).isVisible()");
    expect(readinessSource).toContain('input[placeholder*="email" i]');
    expect(readinessSource).toContain('input[placeholder*="password" i]');
    expect(readinessSource).toContain("PRE_OTP_STALE_GENIE_PAGE_PRESENT");
    expect(readinessSource).not.toContain("browser.close()");
    expect(readinessSource).not.toContain("context.close()");
    expect(routeSource).toContain('phase: "full"');
    expect(routeSource).toContain('phase: "check"');
    expect(routeSource).toContain('phase: "consume"');
    expect(verifierSource).toContain("process.execArgv");
    expect(verifierSource).toContain("PRE_OTP_READY=PASS");
  });
});
