import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./routes.ts", import.meta.url),
  "utf8"
);

describe("live call closeout commissioning boundary", () => {
  it("prepares Review proposals but never auto-executes external actions", () => {
    expect(source).not.toContain("executeAutoPreapprovedActions");
    expect(source).not.toContain("getAutomationPolicy");
    expect(source).toContain(
      "Post-call external actions are prepared for Review only"
    );
    expect(source).toContain(
      "const autoExecutions: Array<Record<string, unknown>> = []"
    );
    expect(source).toContain("autoEligible: false");
  });
});
