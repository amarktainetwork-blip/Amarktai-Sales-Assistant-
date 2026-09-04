import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(
  new URL("../client/src/components/MemberOnboardingGate.tsx", import.meta.url),
  "utf8"
);
const app = readFileSync(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8"
);
const onboardingRoutes = readFileSync(
  new URL("./userOnboardingRoutes.ts", import.meta.url),
  "utf8"
);

describe("personal setup after secure access", () => {
  it("is mounted across the authenticated workspace so identity cannot be skipped", () => {
    expect(app).toContain('import MemberOnboardingGate from "@/components/MemberOnboardingGate"');
    expect(app).toContain("function PersonalSetupBoundary()");
    expect(app).toContain("<MemberOnboardingGate />");
    expect(app).toContain("<PersonalSetupBoundary />");
  });

  it("guides the user through identity, CRM, Outlook and safe autonomy in the secure setup visual system", () => {
    for (const step of [
      "STEP 1 · ABOUT YOU",
      "STEP 2 · CRM IDENTITY",
      "STEP 3 · YOUR MAILBOX",
      "START WITH REVIEW",
      "PERSONAL SETUP COMPLETE",
    ])
      expect(setup).toContain(step);
    expect(setup).toContain("What should AmarktAI call you?");
    expect(setup).toContain("main result you want from AmarktAI");
    expect(setup).toContain("how you prefer to work");
    expect(setup).toContain("Connect Outlook");
    expect(setup).toContain("Start with review.");
    expect(setup).toContain("Assistant identity, memory, CRM context");
    expect(setup).toContain('className="amk-auth fixed inset-0');
    expect(setup).not.toContain('type="password"');
  });

  it("does not require a personal mailbox before shared company setup is complete", () => {
    expect(setup).toMatch(
      /snapshot\?\.company\.complete\s*&&\s*snapshot\.mailbox\.configured\s*&&\s*!snapshot\.mailbox\.connected/
    );
    expect(onboardingRoutes).toMatch(
      /current\.company\.complete\s*&&\s*current\.mailbox\.configured\s*&&\s*!current\.mailbox\.connected/
    );
    expect(onboardingRoutes).not.toContain(
      "if (current.mailbox.configured && !current.mailbox.connected)"
    );
  });
});
