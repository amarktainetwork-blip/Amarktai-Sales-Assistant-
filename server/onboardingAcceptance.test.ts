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

describe("new-user browser CRM commissioning journey contract", () => {
  it("keeps registration, 2FA and guided per-connection setup connected without deployment credentials or raw JSON", () => {
    const routers = read("./routers.ts");
    const layout = read("../client/src/components/DashboardLayout.tsx");
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    const companySetup = read("../client/src/pages/CompanySetup.tsx");
    const administration = read("./connectedSystemAdminRoutes.ts");
    const adapter = read("./browserConnectors/browserCrmAdapter.ts");

    expect(routers).toContain("registerLocalUser(input)");
    expect(routers).toContain("createTwoFactorChallenge");
    expect(routers).toContain("consumeValidTwoFactorChallenge");
    expect(layout).toContain("storedCompanyComplete");
    expect(layout).toContain("<WorkspaceSetupPending");
    expect(layout).toContain("Continue setup");
    expect(onboarding).toContain('chooseMode("individual")');
    expect(onboarding).toContain('chooseMode("team")');
    expect(companySetup).toContain("confirm.mutate");
    expect(onboarding).toContain("sign in directly");
    expect(onboarding).toContain("navigate(`/crm/${id}`)");
    expect(onboarding).not.toContain('type="password"');
    expect(administration).not.toContain("interactive-auth/verify");
    expect(adapter).toContain("connection.baseUrl");
    expect(adapter).toContain("isBrowserSessionPackage");
    expect(onboarding).not.toContain("GENIE_USERNAME");
    expect(onboarding).not.toContain("GENIE_PASSWORD");
    expect(onboarding).not.toContain("browserProfile");
    expect(onboarding).not.toContain("operationId");
  });

  it("allows limited-permissions browser CRM selling when every core task alone is LIVE_PROVEN", () => {
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
    expect(onboarding).toContain("Connect your CRM.");
    expect(onboarding).toContain("Connect {provider.label}");
    expect(onboarding).toContain("Secure CRM workspace");
    for (const technicalTerm of [
      "Teach AmarktAI",
      "LIVE_PROVEN",
      "TEST_READY",
      "GENIE_LOGIN_CALIBRATION_REQUIRED",
      "OPERATION_NOT_LIVE_PROVEN",
      "browserProfile",
      "sidecar",
    ])
      expect(onboarding).not.toContain(technicalTerm);
  });

  it("turns interrupted website responses into a safe customer message", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    expect(onboarding).toContain("Learning paused before it finished.");
    expect(onboarding).toContain("Nothing new was trusted.");
    expect(onboarding).not.toContain("Failed to execute 'json' on 'Response'");
    expect(onboarding).not.toContain("Unexpected end of JSON input");
  });

  it("requires deliberate knowledge selection and exposes complete-site coverage", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    const companySetup = read("../client/src/pages/CompanySetup.tsx");
    const database = read("./db.ts");
    expect(companySetup).toContain("buildBusinessBasicsApproval");
    expect(companySetup).toContain("setCorrections");
    expect(companySetup).toContain("Sources");
    expect(companySetup).toContain("discovery.sourceUrl");
    expect(companySetup).toContain('target="_blank"');
    expect(companySetup).toContain("knowledgeIndexes: basics.map");
    expect(onboarding).toMatch(/before anything becomes\s+trusted knowledge/);
    expect(database).toContain('completeness?.status === "incomplete"');
    expect(database).toContain(
      "Retry company learning before approving any facts"
    );
  });

  it("polls durable company-learning phases instead of holding one synthesis request", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    const router = read("./routers.ts");
    const jobs = read("./companyKnowledgeJobs.ts");
    expect(onboarding).toContain("companyLearningStatus.useQuery");
    expect(onboarding).toContain("refetchInterval: 3_000");
    expect(router).toContain("startCompanyKnowledgeJob");
    expect(router).toContain("retryCompanyKnowledgeJob");
    for (const phase of [
      "Scanning website",
      "Building company corpus",
      "Understanding company",
      "Checking products and pricing",
      "Auditing company knowledge",
      "Verifying sources",
      "Ready for review",
    ])
      expect(jobs).toContain(phase);
    expect(jobs).toContain("discoverySnapshot");
    expect(jobs).toContain("analysisDraft");
    expect(jobs).toContain("auditDraft");
  });

  it("shows the human-controlled CRM browser path", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    const workspace = read("../client/src/pages/CrmWorkspace.tsx");
    expect(onboarding).toContain("sign in directly");
    expect(workspace).toContain("Check my sign-in");
    expect(workspace).toContain("Take control");
    expect(workspace).toContain("Give control to AmarktAI");
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
    expect(onboarding).toContain("sign in directly");
    expect(onboarding).not.toContain("capabilityOptions");
    expect(onboarding).not.toContain("toggleCapability");
  });

  it("routes invited salespeople through identity confirmation without company onboarding", () => {
    const layout = read("../client/src/components/DashboardLayout.tsx");
    expect(layout).toContain("/api/team/crm-identity");
    expect(layout).toContain("Which salesperson record is yours?");
    expect(layout).toContain(
      "When setup is proven, your customers, tasks, opportunities and call context will be available here automatically."
    );
    expect(layout).toContain("Your AmarktAI workspace is being prepared.");
  });

  it("does not require installation-level CRM credentials", () => {
    const preflight = read("../deploy/webdock/preflight.sh");
    expect(preflight).toContain("optional Genie preset URL");
    expect(preflight).not.toContain("GENIE_PASSWORD");
  });
});
