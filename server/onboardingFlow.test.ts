import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/pages/Onboarding.tsx", import.meta.url),
  "utf8"
);

describe("browser CRM onboarding commissioning flow", () => {
  it("keeps the normal CRM flow provider-neutral and hands advanced setup off explicitly", () => {
    expect(source).toContain("Connect the CRM you already use");
    expect(source).toContain("Connect → Discover → Test → Ready");
    expect(source).toContain("Setting up your CRM");
    expect(source).toContain("HubSpot");
    expect(source).toContain("Salesforce");
    expect(source).toContain("Pipedrive");
    expect(source).toContain("Zoho CRM");
    expect(source).toContain("Other CRM");
    expect(source).toContain("/browser");
    expect(source).toContain("/verify");
    expect(source).toContain("Advanced CRM Setup");
    expect(source).not.toContain("Teach Amarktai");
    expect(source).not.toContain("BrowserOperationMatrix");
    expect(source).not.toContain("LoginCalibration");
    expect(source).not.toContain("LIVE_PROVEN");
    expect(source).not.toContain("TEST_READY");
    expect(source).not.toContain("sidecar");
    expect(source).not.toContain("browserProfile");
    expect(source).not.toContain("GENIE_USERNAME");
    expect(source).not.toContain("GENIE_PASSWORD");
    expect(source).not.toContain("operation ID");
    expect(source).not.toContain("Open Connections");
  });
});
