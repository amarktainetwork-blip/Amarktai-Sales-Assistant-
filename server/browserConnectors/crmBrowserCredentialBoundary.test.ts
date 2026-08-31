import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("Secure CRM Browser credential boundary", () => {
  it("has no CRM credential or verification-code submission endpoint", () => {
    const admin = read("../connectedSystemAdminRoutes.ts");
    const onboarding = read("../../client/src/pages/Onboarding.tsx");
    const connections = read("../../client/src/pages/ConnectionsV2.tsx");
    expect(admin).not.toContain("interactive-auth/verify");
    expect(admin).not.toContain("/pre-otp");
    expect(onboarding).not.toContain('type="password"');
    expect(connections).not.toContain('type="password"');
  });

  it("does not audit or log individual key payloads", () => {
    const stream = read("../liveCrmViewer.ts");
    expect(stream).not.toMatch(
      /recordAudit\([\s\S]{0,500}(?:event\.key|event\.text)/
    );
    expect(stream).not.toMatch(
      /console\.(?:log|error)\([\s\S]{0,300}dispatchKeyEvent/
    );
  });

  it("keeps discovery snapshots structural and secret-free", () => {
    const adapter = read("./browserCrmAdapter.ts");
    expect(adapter).toContain("tag: string");
    expect(adapter).toContain("role: string");
    expect(adapter).toContain("label: string");
    expect(adapter).not.toContain("resolveBrowserCredentials");
  });
});
