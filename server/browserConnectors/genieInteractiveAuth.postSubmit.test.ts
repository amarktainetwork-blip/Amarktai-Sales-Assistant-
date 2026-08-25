import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Genie post-login MFA handoff", () => {
  it("does not treat a disappeared password field as authenticated without a proven CRM-ready marker", () => {
    const source = readFileSync(
      new URL("./genieInteractiveAuthCore.ts", import.meta.url),
      "utf8"
    );
    const begin = source
      .split("export async function beginGenieInteractiveAuthentication")[1]
      .split("export async function completeGenieInteractiveAuthentication")[0];

    expect(begin).toContain("Date.now() - passwordGoneAt >= 1_500 &&");
    expect(begin).toContain("(await readySelector(handle.page))");
    expect(begin).toContain("await pageSuggestsInteractiveAuth(handle.page)");
  });
});
