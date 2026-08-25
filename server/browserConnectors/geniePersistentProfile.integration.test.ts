import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("persistent Genie profile architecture", () => {
  it("boots Genie through a persistent CDP package and preserves the tested auth core", () => {
    const wrapper = readFileSync(
      new URL("./genieInteractiveAuth.ts", import.meta.url),
      "utf8"
    );
    const core = readFileSync(
      new URL("./genieInteractiveAuthCore.ts", import.meta.url),
      "utf8"
    );
    const sessions = readFileSync(
      new URL("./browserSession.ts", import.meta.url),
      "utf8"
    );

    expect(wrapper).toContain('persistenceMode: "persistent_cdp"');
    expect(wrapper).toContain("claimPersistentGenieProfile(input.connection)");
    expect(wrapper).toContain("beginCore");
    expect(wrapper).toContain("completeCore");
    expect(core).toContain("fillVerificationCode");
    expect(core).toContain("retainLiveChallenge");
    expect(sessions).toContain("input.browser.contexts()");
    expect(sessions).toContain("borrowPersistentContext");
    expect(sessions).toContain("persistentBorrowedContexts");
  });

  it("persists the Chromium user-data directory in the full Webdock profile", () => {
    const compose = readFileSync(
      new URL("../../deploy/webdock/docker-compose.yml", import.meta.url),
      "utf8"
    );
    const dockerfile = readFileSync(
      new URL("../../deploy/browser/Dockerfile", import.meta.url),
      "utf8"
    );

    expect(compose).toContain("browser_profile:/home/chrome/profile");
    expect(compose).toContain("browser_profile:");
    expect(dockerfile).toContain("--user-data-dir=/home/chrome/profile");
  });
});
