import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_BROWSER_OPERATIONS, coreBrowserCommissioningReady } from "./crm/commissioningReadiness";

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

  it("uses the production read-only commissioning contract", () => {
    const statuses = new Map(CORE_BROWSER_OPERATIONS.map(key => [key, "LIVE_PROVEN"]));
    expect(coreBrowserCommissioningReady(statuses)).toBe(true);
    for (const key of CORE_BROWSER_OPERATIONS) {
      expect(coreBrowserCommissioningReady(new Map([...statuses].filter(([candidate]) => candidate !== key)))).toBe(false);
      expect(coreBrowserCommissioningReady(new Map([...statuses, [key, "TEST_READY"]]))).toBe(false);
    }
    expect(CORE_BROWSER_OPERATIONS).toEqual(["contact.search", "contact.read", "contact.sync"]);
  });

  it("keeps technical commissioning out of the normal onboarding screen", () => {
    const onboarding = read("../client/src/pages/Onboarding.tsx");
    expect(onboarding).toContain("Connect the CRM your team already uses.");
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
    expect(onboarding).toContain("Website learning paused before it finished.");
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
expect(onboarding).toMatch(
      /Nothing becomes trusted\s+company knowledge until you confirm it/
    );
    expect(database).toContain('completeness?.status === "incomplete"');
    expect(database).not.toContain(
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
    expect(read("../client/src/components/MemberOnboardingGate.tsx")).toContain("/api/team/crm-identity");
    expect(layout).not.toContain("SalespersonIdentityGate");
    expect(read("../client/src/components/MemberOnboardingGate.tsx")).toContain("Confirm who you are in the CRM.");
    expect(layout).toContain("Your AmarktAI workspace is being prepared.");
  });

  it("does not require installation-level CRM credentials", () => {
    const preflight = read("../deploy/webdock/preflight.sh");
    expect(preflight).toContain("optional Genie preset URL");
    expect(preflight).not.toContain("GENIE_PASSWORD");
  });
});
