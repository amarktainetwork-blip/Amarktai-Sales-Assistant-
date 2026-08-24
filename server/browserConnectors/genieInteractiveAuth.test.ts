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

  it("settles browser-session snapshots before cleanup and never closes shared CDP Chromium", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toContain("browser.close()");
    expect(source.match(/browser\.disconnect\(\)/g)?.length).toBe(2);
    expect(source.match(/return await verificationRequired\(/g)?.length).toBe(2);
    expect(source.match(/return await authenticated\(/g)?.length).toBe(4);
  });
});
