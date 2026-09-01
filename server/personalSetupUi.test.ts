import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(
  new URL("../client/src/components/MemberOnboardingGate.tsx", import.meta.url),
  "utf8"
);

describe("personal setup after company setup", () => {
  it("guides the salesperson through personal identity, CRM, mailbox and safe autonomy", () => {
    for (const step of [
      "01 / About your work",
      "02 / CRM identity",
      "03 / Mailbox",
      "04 / How Amarktai may work for you",
      "05 / Ready",
    ])
      expect(setup).toContain(step);
    expect(setup).toContain("What should Amarktai call you?");
    expect(setup).toContain("Connect Microsoft mailbox");
    expect(setup).toContain("Start with review.");
    expect(setup).not.toContain('type="password"');
  });
});
