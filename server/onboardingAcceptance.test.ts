import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
