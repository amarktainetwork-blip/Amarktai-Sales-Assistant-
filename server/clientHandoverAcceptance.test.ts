import { describe, expect, it } from "vitest";
import fs from "node:fs";

const assistant = fs.readFileSync("server/assistantRoutes.ts", "utf8");
const today = fs.readFileSync("server/today.ts", "utf8");
const onboarding = fs.readFileSync("client/src/pages/Onboarding.tsx", "utf8");
const crm = fs.readFileSync("client/src/pages/CrmWorkspace.tsx", "utf8");
const companySetup = fs.readFileSync(
  "client/src/pages/CompanySetup.tsx",
  "utf8"
);
const routers = fs.readFileSync("server/routers.ts", "utf8");
const db = fs.readFileSync("server/db.ts", "utf8");
const approvalPolicy = fs.readFileSync(
  "shared/companyKnowledgeApprovalPolicy.ts",
  "utf8"
);
const companyLearningRuntime = fs.readFileSync(
  "server/companyKnowledgePartialBatchRuntime.ts",
  "utf8"
);

function compact(value: string) {
  return value.replace(/\s+/g, " ");
}

describe("client handover acceptance guards", () => {
  it("routes ordinary sales questions through evidence plus GenX", () => {
    expect(assistant).not.toContain(
      "directAssistantAction(query) || deterministicTodayAnswer(query, today)"
    );
    expect(assistant).toContain("governedEvidence");
    expect(assistant).toContain(
      "agentKey: isGovernedEvidenceAgent(route.agentKey)"
    );
  });

  it("keeps personal Today salesperson-scoped for managers too", () => {
    expect(today).not.toContain("canViewTeamData");
    expect(today).not.toContain("unrestricted || ownerIds.has");
    expect(today).toContain("requiresOwnerMapping: ownerIds.size === 0");
  });

  it("scopes personal Customers by signed-in user", () => {
    expect(compact(routers)).toContain(
      compact("return listPersonalCrmCustomers({ userId: ctx.user.id")
    );
  });

  it("puts Outlook before read-only CRM commissioning", () => {
    expect(onboarding).toContain(
      '["Business", "Learn", "Email", "CRM", "Ready"]'
    );
    expect(onboarding).toContain("/api/mailbox/microsoft/start");
    expect(compact(onboarding)).toContain("allowedWriteCapabilities: []");
  });

  it("shows CRM learning and requires salesperson identity mapping", () => {
    expect(crm).toContain("AmarktAI is learning");
    expect(crm).toContain("/api/team/crm-identity");
    expect(crm).toContain("!crmIdentityMapped");
  });

  it("keeps company knowledge review in a standalone onboarding shell", () => {
    expect(companySetup).toContain("data-company-knowledge-review-shell");
    expect(companySetup).toContain("min-h-screen bg-[#F4F7FB]");
    expect(companySetup).toContain("data-company-knowledge-report");
  });

  it("does not force another paid crawl just to approve individually grounded facts", () => {
    expect(db).not.toContain(
      "This company-knowledge pack is incomplete. Retry company learning before approving any facts."
    );
    expect(db).toContain("const coverageIncomplete = completeness?.status");
    expect(companySetup).toContain("you do not need to");
    expect(companySetup).toContain("rerun the paid website crawl");
  });

  it("prioritises career programmes and rejects placeholder offering names", () => {
    expect(approvalPolicy).toContain('type === "career_programme"');
    expect(approvalPolicy).toContain("10_000");
    expect(approvalPolicy).toContain("svg|image|icon|untitled|other|more");
    expect(companyLearningRuntime).toContain(
      "Career programmes are first-class sales entities"
    );
  });
});
