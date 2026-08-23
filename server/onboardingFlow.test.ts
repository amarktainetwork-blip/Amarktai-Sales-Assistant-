import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/Onboarding.tsx", import.meta.url),
  "utf8"
);

describe("browser CRM onboarding commissioning flow", () => {
  it("keeps authentication, mapping, guided training and readiness inside onboarding", () => {
    expect(source).toContain("Entrepreneurs Circle GenieAI");
    expect(source).toContain("/browser");
    expect(source).toContain("/business-mapping");
    expect(source).toContain("BrowserOperationMatrix");
    expect(source).toContain("Continue to automation rules");
    expect(source).not.toContain("Open Connections");
  });
});
