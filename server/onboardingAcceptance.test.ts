import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserOperationIsAvailable,
  CORE_GENIE_TASKS,
  onboardingSellingReadiness,
} from "../client/src/lib/onboardingReadiness";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("new-user Genie commissioning journey contract", () => {
  it("keeps registration, 2FA, SetupGate and guided per-connection commissioning connected without deployment credentials or raw JSON", () => {
    const routers = read("./routers.ts");
    const layout = read("../client/src/components/DashboardLayout.tsx");
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    const administration = read("./connectedSystemAdminRoutes.ts");
    const adapter = read("./browserConnectors/browserCrmAdapter.ts");

    expect(routers).toContain("registerLocalUser(input)");
    expect(routers).toContain("createTwoFactorChallenge");
    expect(routers).toContain("consumeValidTwoFactorChallenge");
    expect(layout).toContain("<SetupGate");
    expect(layout).toContain("Continue guided setup");
    expect(onboarding).toContain('workspaceMode === "individual"');
    expect(onboarding).toContain('workspaceMode === "team"');
    expect(onboarding).toContain("confirm.mutate");
    expect(onboarding).toContain("browserCredentials.username");
    expect(onboarding).toContain("browserCredentials.password");
    expect(onboarding).toContain("Connect / test login and discover");
    expect(administration).toContain('secretKind: "browser"');
    expect(administration).toContain("saveConnectionSecret");
    expect(adapter).toContain("connection.baseUrl");
    expect(adapter).toContain("GENIE_LOGIN_CALIBRATION_REQUIRED");
    expect(onboarding).not.toContain("GENIE_USERNAME");
    expect(onboarding).not.toContain("GENIE_PASSWORD");
    expect(onboarding).not.toContain("browserProfile");
    expect(onboarding).not.toContain("operationId");
  });

  it("allows limited-permissions Genie selling when every core task alone is LIVE_PROVEN", () => {
    const operations = [
      ...CORE_GENIE_TASKS.map(key => ({ key, status: "LIVE_PROVEN" })),
      { key: "quote.create", status: "NOT_LEARNED" },
    ];
    const readiness = onboardingSellingReadiness({
      profileSaved: true,
      knowledgeConfirmed: true,
      readyNativeCrmCount: 0,
      browserSystem: { provider: "genie", status: "limited_permissions" },
      browserOperations: operations,
    });

    expect(readiness).toMatchObject({
      crmVerified: true,
      coreGenieReady: true,
      canStartSelling: true,
    });
    expect(browserOperationIsAvailable(operations, "quote.create")).toBe(false);
  });

  it("keeps missing core tasks gated and native OAuth readiness unchanged", () => {
    const partialCore = CORE_GENIE_TASKS.slice(1).map(key => ({
      key,
      status: "LIVE_PROVEN",
    }));
    expect(
      onboardingSellingReadiness({
        profileSaved: true,
        knowledgeConfirmed: true,
        readyNativeCrmCount: 0,
        browserSystem: { provider: "genie", status: "limited_permissions" },
        browserOperations: partialCore,
      }).canStartSelling
    ).toBe(false);
    expect(
      onboardingSellingReadiness({
        profileSaved: true,
        knowledgeConfirmed: true,
        readyNativeCrmCount: 1,
      }).canStartSelling
    ).toBe(true);
  });

  it("documents installation Genie values as fallback rather than a commissioning requirement", () => {
    const preflight = read("../deploy/webdock/preflight.sh");
    expect(preflight).toContain(
      "Installation-level Genie fallback is not configured. Per-connection Genie commissioning remains available in the application."
    );
    expect(preflight).not.toContain(
      "Genie live validation will remain unavailable"
    );
  });
});
