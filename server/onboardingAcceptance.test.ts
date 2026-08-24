import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserOperationIsAvailable,
  CORE_GENIE_TASKS,
  humanBrowserCapabilityStatus,
  humanizeCrmFailure,
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
    expect(onboarding).toContain("Check CRM setup");
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
      nativeSystems: [],
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
        nativeSystems: [],
        browserSystem: { provider: "genie", status: "limited_permissions" },
        browserOperations: partialCore,
      }).canStartSelling
    ).toBe(false);
    expect(
      onboardingSellingReadiness({
        profileSaved: true,
        knowledgeConfirmed: true,
        nativeSystems: [
          {
            provider: "hubspot",
            status: "limited_permissions",
            verifiedCapabilities: [
              "contacts.read",
              "tasks.read",
              "tasks.write",
              "notes.write",
              "opportunities.read",
            ],
          },
        ],
      }).canStartSelling
    ).toBe(true);
  });

  it("presents browser truth and technical failures in everyday language", () => {
    expect(
      humanBrowserCapabilityStatus(
        [{ key: "quote.create", status: "NOT_LEARNED" }],
        ["quote.create"]
      )
    ).toBe("Needs setup");
    expect(
      humanBrowserCapabilityStatus(
        [{ key: "quote.create", status: "LIVE_PROVEN" }],
        ["quote.create"]
      )
    ).toBe("Ready");
    expect(
      humanizeCrmFailure("GENIE_LOGIN_CALIBRATION_REQUIRED: selector missing")
    ).toBe(
      "We reached your CRM but couldn't confidently identify its sign-in form."
    );
    expect(
      humanizeCrmFailure(
        "OPERATION_NOT_LIVE_PROVEN: 'whatsapp.send' is TEST_READY"
      )
    ).toBe("WhatsApp still needs to be tested.");
  });

  it("keeps technical commissioning out of the normal onboarding screen", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    expect(onboarding).toContain("Connect the CRM you already use");
    expect(onboarding).toContain("Connect → Discover → Test → Ready");
    expect(onboarding).toContain("Advanced CRM Setup");
    for (const technicalTerm of [
      "Teach Amarktai",
      "LIVE_PROVEN",
      "TEST_READY",
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      "OPERATION_NOT_LIVE_PROVEN",
      "browserProfile",
      "sidecar",
    ])
      expect(onboarding).not.toContain(technicalTerm);
  });

  it("keeps the standard CRM choice provider-neutral and capability selection automatic", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    for (const provider of [
      '"genie"',
      '"hubspot"',
      '"salesforce"',
      '"pipedrive"',
      '"zoho"',
      '"custom_browser"',
    ])
      expect(onboarding).toContain(provider);
    expect(onboarding).toContain(
      "You do not need to choose technical permissions manually."
    );
    expect(onboarding).not.toContain("capabilityOptions");
    expect(onboarding).not.toContain("toggleCapability");
  });

  it("routes invited salespeople through identity confirmation without company onboarding", () => {
    const layout = read("../client/src/components/DashboardLayout.tsx");
    expect(layout).toContain("/api/team/crm-identity");
    expect(layout).toContain("Confirm who you are in the CRM.");
    expect(layout).toContain("you will not repeat company onboarding");
    expect(layout).toContain("Your manager is finishing company setup.");
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
