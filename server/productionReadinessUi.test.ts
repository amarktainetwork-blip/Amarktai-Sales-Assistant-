import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("commercial Sales Assistant product boundaries", () => {
  it("keeps one AmarktAI UI with automatic routing and retry", () => {
    const app = read("../client/src/App.tsx");
    const assistant = read("../client/src/pages/Assistant.tsx");
    expect(app).toContain('<Route path="/assistant" component={Assistant} />');
    expect(app).toContain('<LegacyRedirect to="/assistant" />');
    expect(assistant).toContain("data-assistant-workspace");
    expect(assistant).toContain('aria-label="AmarktAI"');
    expect(assistant).toContain("Good ");
    expect(assistant).toContain("async function retry()");
    expect(assistant).not.toContain("agentKey");
  });

  it("keeps legacy engineering consoles out of the production router", () => {
    const app = read("../client/src/App.tsx");
    expect(app).not.toContain('from "./pages/Workspace"');
    expect(app).not.toContain('from "./pages/Reports"');
    expect(app).toContain(
      '<Route path="/reports">{() => <LegacyRedirect to="/team" />}</Route>'
    );
    for (const route of ["/workspace", "/workflows", "/automation"])
      expect(app).toContain(`<Route path="${route}">`);
  });

  it("keeps management routes out of salesperson access", () => {
    const app = read("../client/src/App.tsx");
    const layout = read("../client/src/components/DashboardLayout.tsx");
    for (const route of [
      "TeamIntelligence",
      "TeamManagement",
      "ConnectionsV2",
      "CompanySetup",
      "Knowledge",
    ])
      expect(app).toMatch(
        new RegExp(
          `<ManagementOnly>\\s*<${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
        )
      );
    expect(app).toContain('navigate("/assistant", { replace: true })');
    expect(layout).toContain("if (!canManage) return []");
  });

  it("completes setup only after final CRM commissioning READY and server core-operation proof", () => {
    const crm = read("../client/src/pages/CrmWorkspace.tsx");
    const organisation = read("./organisation.ts");
    expect(crm).toContain('browserAuthenticationState !== "AUTHENTICATED"');
    expect(crm).toContain('body.job?.state === "READY"');
    expect(crm).toContain('body.job?.status === "ready"');
    expect(crm).toContain("!commissioningReady");
    expect(crm).not.toContain('safeReads?.status === "Ready"');
    expect(crm).toContain('discoveryStatus !== "confirmed"');
    expect(crm).toContain("mutateAsync({ step: 4, complete: true })");
    expect(organisation).toContain('profile.discoveryStatus === "confirmed"');
    expect(organisation).toContain("browserOperationReadinessForSystem");
    expect(organisation).toContain("coreBrowserCommissioningReady(statuses)");
    expect(organisation).not.toContain("safeReadConnections.has(system.id)");
  });

  it("keeps customer CRM surfaces free of capability and commissioning dumps", () => {
    const connections = read("../client/src/pages/ConnectionsV2.tsx");
    const crm = read("../client/src/pages/CrmWorkspace.tsx");
    const calls = read("../client/src/pages/LiveCalls.tsx");
    const team = read("../client/src/pages/TeamManagement.tsx");
    expect(connections).not.toContain("CRM functions");
    expect(connections).not.toContain("system.lastHealthSummary");
    expect(crm).not.toContain("readyCapabilities");
    expect(calls).not.toContain("Advanced commissioning identifiers");
    expect(calls).not.toContain("SALESPERSON-CONFIRMED CLOSEOUT");
    expect(calls).not.toContain("Auto safe");
    expect(team).not.toContain("VERSIONED PLAYBOOKS");
    expect(team).not.toContain("CONNECTOR OPERATIONS");
  });

  it("keeps CRM authentication between the customer and the real CRM", () => {
    const auth = read("../client/src/pages/Auth.tsx");
    const crm = read("../client/src/pages/CrmWorkspace.tsx");
    expect(auth).toContain("CRM sign-in stays between you and your CRM");
    expect(auth).not.toContain("CRM credentials stay server-side");
    expect(auth).not.toContain(
      "Credentials and connection secrets remain on the server"
    );
    expect(crm).toContain("Sign in directly to");
    expect(crm).not.toContain("Request Genie verification code");
    expect(crm).not.toContain("pendingInteractiveAuth");
  });

  it("keeps CRM writes behind an explicit customer review and apply step", () => {
    const reviews = read("../client/src/pages/Reviews.tsx");
    const assistantRoutes = read("./assistantRoutes.ts");
    expect(assistantRoutes).toContain('path: "/reviews"');
    expect(reviews).toContain("Approve change");
    expect(reviews).toContain("Apply approved change");
    expect(reviews).toContain("executeApprovedCrmAction");
    expect(reviews).not.toContain(">actionType<");
    expect(reviews).not.toContain("Operation contract");
    expect(reviews).not.toContain("Workflow Studio");
  });

  it("makes approved company knowledge correctable and organisation-scoped", () => {
    const page = read("../client/src/pages/Knowledge.tsx");
    const router = read("./routers.ts");
    const database = read("./db.ts");
    expect(page).toContain("View source");
    expect(page).toContain("saveEdit");
    expect(page).toContain('source.visibility !== "organisation"');
    expect(router).toContain("update: managementProcedure");
    expect(database).toContain('visibility: "organisation"');
    expect(database).toContain(
      "eq(knowledgeSources.organisationId, input.organisationId)"
    );
    expect(database).toContain(
      'eq(knowledgeSources.visibility, "organisation")'
    );
  });

  it("uses the shared friendly-error layer on customer workflows", () => {
    for (const page of [
      "Assistant.tsx",
      "Auth.tsx",
      "Customers.tsx",
      "Onboarding.tsx",
      "ConnectionsV2.tsx",
      "CrmWorkspace.tsx",
      "Knowledge.tsx",
      "LiveCalls.tsx",
      "Reviews.tsx",
      "TeamIntelligence.tsx",
      "TeamManagement.tsx",
    ])
      expect(read(`../client/src/pages/${page}`)).toContain(
        'from "@/lib/friendlyError"'
      );
    const errors = read("../client/src/lib/friendlyError.ts");
    expect(errors).toContain("zod");
    expect(errors).toContain("playwright");
    expect(errors).toContain("cdp");
    expect(errors).toContain("Nothing was changed");
  });
});
