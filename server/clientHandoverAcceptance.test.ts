import { describe, expect, it } from "vitest";
import fs from "node:fs";

const assistant = fs.readFileSync("server/assistantRoutes.ts", "utf8");
const today = fs.readFileSync("server/today.ts", "utf8");
const onboarding = fs.readFileSync("client/src/pages/Onboarding.tsx", "utf8");
const connections = fs.readFileSync(
  "client/src/pages/ConnectionsV2.tsx",
  "utf8"
);
const customerData = fs.readFileSync("server/customerData.ts", "utf8");
const salesWork = fs.readFileSync("server/salesWork.ts", "utf8");
const todayTaskData = fs.readFileSync("server/todayTaskData.ts", "utf8");
const syncWorker = fs.readFileSync("server/crm/syncWorker.ts", "utf8");
const crmSync = fs.readFileSync("server/crm/sync.ts", "utf8");
const managedCrmSession = fs.readFileSync(
  "server/browserConnectors/managedCrmBrowserSessionManager.ts",
  "utf8"
);
const liveCallContext = fs.readFileSync("server/liveCalls/context.ts", "utf8");
const crm = fs.readFileSync("client/src/pages/CrmWorkspace.tsx", "utf8");
const memberOnboarding = fs.readFileSync(
  "client/src/components/MemberOnboardingGate.tsx",
  "utf8"
);
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

  it("puts CRM before the personal email choice and keeps commissioning read-only", () => {
    expect(onboarding).toContain(
      '["Business", "Learn", "CRM", "Email", "Ready"]'
    );
    expect(onboarding).not.toContain("STEP 3 · YOUR OUTLOOK MAILBOX");
    expect(onboarding).toContain("to receive your email from Genie or Outlook");
    expect(compact(onboarding)).toContain("allowedWriteCapabilities: []");
  });

  it("keeps every new CRM connection review-only by default", () => {
    expect(compact(connections)).toContain("allowedWriteCapabilities: []");
    expect(connections).not.toContain('"email.send",');
    expect(connections).not.toContain('"sms.send",');
    expect(connections).not.toContain('"whatsapp.send",');
  });

  it("keeps worked leads and tasks out of the active Today queue without faking CRM completion", () => {
    expect(salesWork).toContain("completeNewLeadWorkAfterVerifiedContact");
    expect(salesWork).toContain('reason: "verified_call"');
    expect(salesWork).toContain('reason: "verified_task_completion"');
    expect(todayTaskData).toContain("excludeExternalIds");
    expect(todayTaskData).toContain(
      "notInArray(crmTasks.externalId, excluded)"
    );
  });

  it("makes confirmed follow-up commitments the next work item instead of leaving stale CRM work on Today", () => {
    expect(today).toContain("futureCommitmentContacts");
    expect(today).toContain("reminders: reminders.map");
    expect(today).toContain(
      "!futureCommitmentContacts.has(item.contactExternalId)"
    );
  });

  it("retries transient CRM contention promptly and refreshes immediately after reauthentication", () => {
    expect(syncWorker).toContain("CRM_SYNC_POLL_INTERVAL_MS = 30_000");
    expect(syncWorker).toContain("lastStartedAt: null");
    expect(syncWorker).toContain("reconcileNewLeadAlertsFromTaskHistory");
    expect(syncWorker).toContain('"authentication_expired"');
    expect(crmSync).toContain("reproveRoutineRead");
    expect(crmSync).toContain('["tasks", "task.sync"]');
    expect(crmSync).toContain('["opportunities", "opportunity.sync"]');
    expect(crmSync).toContain("externalWritePerformed: false");
    expect(managedCrmSession).toContain("lastSucceededAt: null");
    expect(managedCrmSession).toContain('"crm_reconciliation"');
  });

  it("hydrates exact Genie customer history on demand for customer and call context", () => {
    expect(customerData).toContain("refreshExactCustomerHistoryIfDue");
    expect(compact(routers)).toContain(
      compact(
        "await refreshExactCustomerHistoryIfDue(scope).catch(() => undefined)"
      )
    );
    expect(compact(liveCallContext)).toContain(
      compact("await refreshExactCustomerHistoryIfDue({")
    );
    expect(customerData).toContain(
      "CUSTOMER_HISTORY_REFRESH_TTL_MS = 5 * 60_000"
    );
  });

  it("keeps shared CRM commissioning separate and requires identity for an individual owner", () => {
    expect(crm).toContain("AmarktAI is learning");
    expect(crm).not.toContain("!crmIdentityMapped");
    expect(crm).not.toContain("<CrmIdentitySetup");
    expect(memberOnboarding).toContain('snapshot?.role === "salesperson"');
    expect(memberOnboarding).toContain('snapshot?.role === "owner"');
    expect(memberOnboarding).toContain(
      'snapshot.company.workspaceMode === "individual"'
    );
    expect(memberOnboarding).toContain("/api/team/crm-identity");
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
