import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyGenieInitialRenderState,
  genieInteractiveAuthIsFresh,
  validateGenieVerificationCode,
} from "./genieInteractiveAuth";

describe("Genie interactive authentication", () => {
  it("accepts normal verification codes without persisting or transforming them", () => {
    expect(validateGenieVerificationCode("123456")).toBe("123456");
    expect(validateGenieVerificationCode("AB12-CD34")).toBe("AB12-CD34");
  });

  it("rejects empty, oversized, and unsafe verification values", () => {
    expect(() => validateGenieVerificationCode("")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
    expect(() => validateGenieVerificationCode("123456<script>")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
    expect(() => validateGenieVerificationCode("123456789012345678901")).toThrow(
      "GENIE_VERIFICATION_CODE_INVALID"
    );
  });

  it("expires pending interactive authentication after fifteen minutes", () => {
    const createdAt = "2026-08-24T20:00:00.000Z";
    const pending = {
      browserSession: {},
      challengeUrl: "https://genie.entrepreneurscircle.org/verify",
      challengeId: "challenge-1",
      createdAt,
    };
    expect(
      genieInteractiveAuthIsFresh(
        pending,
        new Date("2026-08-24T20:14:59.000Z").getTime()
      )
    ).toBe(true);
    expect(
      genieInteractiveAuthIsFresh(
        pending,
        new Date("2026-08-24T20:15:01.000Z").getTime()
      )
    ).toBe(false);
  });

  it("waits while a client-rendered Genie login form is still appearing", () => {
    expect(
      classifyGenieInitialRenderState({
        usernameVisible: false,
        passwordVisible: false,
        submitVisible: false,
        interactive: false,
        ready: false,
        sessionAvailable: false,
        urlChanged: false,
      })
    ).toBe("waiting");

    expect(
      classifyGenieInitialRenderState({
        usernameVisible: true,
        passwordVisible: true,
        submitVisible: true,
        interactive: false,
        ready: false,
        sessionAvailable: false,
        urlChanged: false,
      })
    ).toBe("login");
  });

  it("does not mistake a generic login-page shell for an authenticated CRM", () => {
    expect(
      classifyGenieInitialRenderState({
        usernameVisible: false,
        passwordVisible: false,
        submitVisible: false,
        interactive: false,
        ready: true,
        sessionAvailable: false,
        urlChanged: false,
      })
    ).toBe("waiting");

    expect(
      classifyGenieInitialRenderState({
        usernameVisible: false,
        passwordVisible: false,
        submitVisible: false,
        interactive: false,
        ready: true,
        sessionAvailable: true,
        urlChanged: false,
      })
    ).toBe("authenticated");
  });

  it("prioritises the Genie verification challenge over other page markers", () => {
    expect(
      classifyGenieInitialRenderState({
        usernameVisible: false,
        passwordVisible: false,
        submitVisible: false,
        interactive: true,
        ready: true,
        sessionAvailable: true,
        urlChanged: true,
      })
    ).toBe("verification");
  });

  it("keeps the exact live Genie challenge instead of reopening MFA from storageState", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );
    const complete = source.split(
      "export async function completeGenieInteractiveAuthentication"
    )[1];

    expect(source.match(/await retainLiveChallenge\(/g)?.length).toBe(2);
    expect(source).toContain("const liveChallenges = new Map");
    expect(source).toContain("challengeId = randomUUID()");
    expect(complete).toContain(
      "const live = liveChallenges.get(input.pending.challengeId)"
    );
    expect(complete).not.toContain("createContext(");
    expect(complete).not.toContain("gotoAuthorised(");
  });

  it("keeps one shared CDP connection so retained MFA contexts are not disposed on request cleanup", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );
    const closeHandle = source
      .split("async function closeBrowserHandle")[1]
      .split("async function disposeLiveChallenge")[0];
    const createContext = source
      .split("async function createContext")[1]
      .split("function blockedNavigationError")[0];

    expect(source).toContain("let sharedCdpBrowser: Browser | undefined");
    expect(source).toContain("async function getSharedCdpBrowser()");
    expect(source.match(/connectOverCDP\(/g)?.length ?? 0).toBe(1);
    expect(createContext).toContain("const browser = await getSharedCdpBrowser()");
    expect(closeHandle).toContain("handle.context.close()");
    expect(closeHandle).not.toContain("browser.close()");
    expect(source).toContain("genie_cdp_browser_disconnected");
  });

  it("waits for actual OTP controls and preserves a live challenge on transient verifier errors", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );
    const waitForChallenge = source
      .split("async function waitForVerificationChallenge")[1]
      .split("async function authenticated")[0];
    const complete = source.split(
      "export async function completeGenieInteractiveAuthentication"
    )[1];

    expect(waitForChallenge).toContain(
      "hasVisible(input.page, GENIE_MFA_SELECTOR)"
    );
    expect(waitForChallenge).toContain("GENIE_VERIFICATION_CONTROLS_NOT_READY");
    expect(source).toContain("async function waitForVerificationFields");
    expect(complete).toContain("let keepForRetry = true");
    expect(complete).toContain(
      "The live challenge remains available for another Verify attempt."
    );
  });

  it("settles approved session snapshots before browser cleanup", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );

    expect(source.match(/return await authenticated\(/g)?.length).toBe(4);
    expect(source).toContain("return await authenticated(live.page, live.context)");
    expect(source).toContain("await disposeLiveChallenge(live.challengeId)");
  });
});
