import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("commercial Sales Assistant product boundaries", () => {
  it("keeps one Assistant UI with automatic routing and retry", () => {
    const app = read("../client/src/App.tsx");
    const assistant = read("../client/src/pages/Assistant.tsx");
    expect(app).toContain('<Route path="/assistant" component={Assistant} />');
    expect(app).toContain('<LegacyRedirect to="/assistant" />');
    expect(assistant).toContain("I choose the right sales tool automatically.");
    expect(assistant).toContain("async function retry()");
    expect(assistant).not.toContain("agentKey");
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

  it("completes onboarding only after confirmed knowledge, authentication and safe reads", () => {
    const crm = read("../client/src/pages/CrmWorkspace.tsx");
    const organisation = read("./organisation.ts");
    expect(crm).toContain('browserAuthenticationState !== "AUTHENTICATED"');
    expect(crm).toContain('safeReads?.status === "Ready"');
    expect(crm).toContain('discoveryStatus !== "confirmed"');
    expect(crm).toContain("mutateAsync({ step: 4, complete: true })");
    expect(organisation).toContain('profile.discoveryStatus === "confirmed"');
    expect(organisation).toContain("safeReadConnections.has(system.id)");
    expect(organisation).toMatch(
      /!\[\s*"authentication_expired",[\s\S]*?"error",?\s*\]\.includes\(system\.status\)/
    );
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
    expect(team).not.toContain("VERSIONED PLAYBOOKS");
    expect(team).not.toContain("CONNECTOR OPERATIONS");
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

  it("uses the shared friendly-error layer on primary customer workflows", () => {
    for (const page of [
      "Assistant.tsx",
      "Onboarding.tsx",
      "ConnectionsV2.tsx",
      "CrmWorkspace.tsx",
      "Knowledge.tsx",
      "TeamManagement.tsx",
    ])
      expect(read(`../client/src/pages/${page}`)).toContain(
        'from "@/lib/friendlyError"'
      );
    const errors = read("../client/src/lib/friendlyError.ts");
    expect(errors).toContain("zod");
    expect(errors).toContain("Nothing was changed");
  });
});
