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
    expect(source).toContain("CRM username / email");
    expect(source).toContain("CRM password (encrypted at rest)");
    expect(source).toContain("Connect / test login and discover");
    expect(source).toContain("LoginCalibration");
    expect(source).not.toContain("GENIE_USERNAME");
    expect(source).not.toContain("GENIE_PASSWORD");
    expect(source).not.toContain("operation ID");
    expect(source).not.toContain("Open Connections");
  });
});
