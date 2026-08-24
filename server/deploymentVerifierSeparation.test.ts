import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const platform = readFileSync(
  new URL("../deploy/webdock/verify-production.sh", import.meta.url),
  "utf8"
);
const clientAcceptance = readFileSync(
  new URL("../deploy/webdock/verify-client-acceptance.sh", import.meta.url),
  "utf8"
);
const strictVerifier = readFileSync(
  new URL("./verifyFeatures.ts", import.meta.url),
  "utf8"
);

describe("deployment and client acceptance separation", () => {
  it("allows platform readiness before CRM commissioning without weakening strict acceptance", () => {
    expect(platform).toContain("PLATFORM_READY=PASS");
    expect(platform).toContain("CLIENT_ACCEPTANCE=PENDING");
    expect(platform).not.toContain("dist/verifyFeatures.js");
    expect(clientAcceptance).toContain("dist/verifyFeatures.js");
    expect(clientAcceptance).toContain("CLIENT_ACCEPTANCE_READY=PASS");
    expect(strictVerifier).toContain("process.exit(incomplete === 0 ? 0 : 1)");
    expect(strictVerifier).toContain('event: "feature_acceptance"');
  });
});
