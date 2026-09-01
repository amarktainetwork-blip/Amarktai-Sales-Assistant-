import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const onboarding = readFileSync(
  new URL("../client/src/pages/Onboarding.tsx", import.meta.url),
  "utf8"
);
const connections = readFileSync(
  new URL("../client/src/pages/ConnectionsV2.tsx", import.meta.url),
  "utf8"
);

describe("universal CRM onboarding", () => {
  it("offers known presets and a first-class unknown CRM route", () => {
    for (const label of [
      "Genie",
      "HubSpot",
      "Salesforce",
      "Pipedrive",
      "Zoho CRM",
      "Other CRM",
    ])
      expect(onboarding).toContain(label);
    expect(onboarding).toContain("sign in directly");
    expect(connections).toMatch(
      /Amarktai never asks for\s+or records the password or verification code/
    );
    expect(connections).toContain("https://crm.example.com/");
  });

  it("contains no CRM credential form or old interactive-auth endpoint", () => {
    expect(onboarding).not.toContain('type="password"');
    expect(onboarding).not.toContain("/interactive-auth/");
    expect(onboarding).not.toContain("/pre-otp");
    expect(connections).not.toContain('type="password"');
  });
});
