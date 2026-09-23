import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses the single canonical client stylesheet without restoring legacy generations", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    const css = readFileSync(path.resolve("client/src/index.css"), "utf8");
    expect(app).not.toContain('import "./dashboard-final.css"');
    expect(existsSync(path.resolve("client/src/dashboard-final.css"))).toBe(
      false
    );
    expect(css).toContain(".amarktai-dashboard-sidebar");
    expect(css.toLowerCase()).toContain("--dash-canvas: #e9e7e2");
    expect(app).not.toContain('import "./workspace-handover.css"');
    expect(app).not.toContain('import "./dashboard-client-readability.css"');
    expect(app).not.toContain('import "./final-release.css"');
    expect(app).not.toContain('import "./app-final.css"');
    expect(app).not.toContain('import "./dashboard-v6.css"');
    expect(app).not.toContain('import "./dashboard-v2.css"');
    expect(app).not.toContain('import "./dashboard-v3.css"');
    expect(app).not.toContain('import "./dashboard-handover.css"');
    for (const obsolete of [
      "workspace-handover.css",
      "dashboard-v2.css",
      "dashboard-v3.css",
      "dashboard-v6.css",
      "dashboard-handover.css",
    ])
      expect(existsSync(path.resolve("client/src", obsolete))).toBe(false);
  });

  it("keeps daily sales work simple while keeping manager CRM setup visible", () => {
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const settings = readFileSync(
      path.resolve("client/src/pages/Settings.tsx"),
      "utf8"
    );
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");

    for (const label of [
      "Today",
      "Customers",
      "Inbox",
      "Calls",
      "AmarktAI",
      "Review",
    ])
      expect(layout).toContain(`label: "${label}"`);
    expect(layout).toContain('label: "CRM"');
    expect(layout).toContain('path: "/crm"');
    expect(layout).toContain('label: "Settings"');
    expect(layout).not.toContain('label: "Connections"');
    expect(layout).not.toContain('label: "Knowledge"');
    expect(layout).not.toContain('label: "Company"');
    expect(layout).not.toContain('label: "Follow-ups"');
    expect(layout).not.toContain('label: "Automation"');
    expect(layout).not.toContain('label: "Reports"');
    expect(layout).not.toContain('label: "Approvals"');
    expect(layout).not.toContain("DropdownMenuContent");
    expect(layout).toContain('aria-label="Sign out"');
    expect(layout).toMatch(/>\s*Sign out\s*<\/span>/);

    expect(app).toContain('<Route path="/dashboard" component={Today} />');
    expect(app).toContain('<Route path="/settings" component={Settings} />');
    expect(app).toContain("<PersonalSetupBoundary />");

    for (const section of [
      "Profile",
      "Workspace",
      "CRM & mailbox",
      "Skills",
      "Notifications",
      "Permissions",
      "Security",
      "Templates",
      "Company",
      "Team",
      "Knowledge",
    ])
      expect(settings).toContain(`label: "${section}"`);
    expect(settings).toContain("<ReadOnlySkillList />");
    expect(settings).toContain('fetch("/api/skills"');
  });

  it("keeps the salesperson flow action-first instead of repeating decorative banners", () => {
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const today = readFileSync(
      path.resolve("client/src/pages/Today.tsx"),
      "utf8"
    );
    const customers = readFileSync(
      path.resolve("client/src/pages/Customers.tsx"),
      "utf8"
    );
    const review = readFileSync(
      path.resolve("client/src/pages/Reviews.tsx"),
      "utf8"
    );
    const assistant = readFileSync(
      path.resolve("client/src/pages/Assistant.tsx"),
      "utf8"
    );

    expect(layout).not.toContain("data-new-lead-alert");
    expect(layout).toContain(
      "storedCompanyComplete && crmAttention && crmProblem"
    );
    expect(today).not.toContain("Daily loop");
    expect(today).not.toContain("Work the hottest customer");
    expect(today).toContain("Immediate work is clear.");
    expect(today).toContain("AmarktAI prepares admin");
    for (const tab of ["Now", "Queue", "Schedule", "Replies"])
      expect(today).toContain(`"${tab}"`);
    expect(today).toContain('role="tablist"');
    expect(today).toContain('className="amk-day__body"');
    expect(today).toContain('activeTab === "now"');
    expect(today).toContain('activeTab === "queue"');
    expect(today).toContain('activeTab === "schedule"');
    expect(today).toContain('activeTab === "replies"');
    expect(customers).not.toContain("Know the person before you call.");
    expect(customers).toContain("Customer context");
    expect(review).not.toContain(
      "Only stop here when AmarktAI needs your decision."
    );
    expect(review).toContain("data-review-bundle");
    expect(review).toContain("Customer interaction");
    expect(review).toContain("bundle.entries.map");
    expect(review).toContain("Back to Today");
    expect(assistant).not.toContain("Give me the admin around the call.");
    expect(assistant).toContain("Your sales assistant is ready");
    expect(assistant).toContain('label="Why now"');
    expect(assistant).toContain(
      "Draft first. Customer-facing actions remain reviewable."
    );
  });

  it("gives team managers factual workload and follow-up exceptions", () => {
    const page = readFileSync(
      path.resolve("client/src/pages/TeamIntelligence.tsx"),
      "utf8"
    );
    const service = readFileSync(
      path.resolve("server/teamIntelligence.ts"),
      "utf8"
    );

    for (const signal of [
      "Activity today",
      "New leads",
      "Unanswered",
      "Overdue",
      "Stale deals",
      "No next step",
      "Pipeline at risk",
    ])
      expect(page).toContain(signal);
    for (const field of [
      "activitiesToday",
      "newLeadsWaiting",
      "unansweredCustomers",
      "openWorkItems",
    ])
      expect(service).toContain(field);
  });

  it("keeps client exports accessible without adding another primary navigation area", () => {
    const settings = readFileSync(
      path.resolve("client/src/pages/Settings.tsx"),
      "utf8"
    );
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );

    expect(settings).toContain("Reports & exports");
    expect(settings).toMatch(
      /kind:\s*"operational_report"[\s\S]*format:\s*"csv"/
    );
    expect(settings).toMatch(
      /kind:\s*"conversation_log"[\s\S]*format:\s*"pdf"/
    );
    expect(settings).toContain("Sales activity CSV");
    expect(settings).toContain("Call log PDF");
    expect(layout).not.toContain('label: "Reports"');
  });

  it("uses CRM-derived pipeline currency instead of inventing USD", () => {
    const teamPage = readFileSync(
      path.resolve("client/src/pages/TeamIntelligence.tsx"),
      "utf8"
    );
    const teamService = readFileSync(
      path.resolve("server/teamIntelligence.ts"),
      "utf8"
    );

    expect(teamPage).not.toContain('currency: "USD"');
    expect(teamPage).toContain("pipelineCurrency");
    expect(teamPage).toContain("pipelineHasMixedCurrencies");
    expect(teamService).toContain("currencyCode(opportunity.currency)");
    expect(teamService).toContain("pipelineCurrenciesByPerson");
    expect(teamService).toContain("pipelineHasMixedCurrencies");
  });

  it("uses a calm low-glare dashboard palette", () => {
    const css = readFileSync(path.resolve("client/src/index.css"), "utf8");
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );

    expect(css.toLowerCase()).toContain("--dash-canvas: #e9e7e2");
    expect(css.toLowerCase()).toContain("--dash-paper: #f7f5f0");
    expect(css.toLowerCase()).toContain("--dash-ink: #202b30");
    expect(css.toLowerCase()).toContain("--dash-blue: #526f7d");
    expect(css).not.toContain("--handover-blue");
    expect(css).not.toContain("--handover-canvas");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("input::placeholder");

    expect(layout).toContain('SidebarInset className="bg-[#E9E7E2]"');
    expect(layout).toContain("bg-[#E2EBE6]");
    expect(layout).toContain("bg-[#EFEDE7] text-[#202B30]");
    expect(layout).not.toContain(
      'className="amarktai-dashboard-sidebar bg-[#101619]'
    );
  });

  it("keeps the call workflow and does not rely on a deleted override layer", () => {
    const calls = readFileSync(
      path.resolve("client/src/pages/LiveCalls.tsx"),
      "utf8"
    );
    const css = readFileSync(path.resolve("client/src/index.css"), "utf8");
    expect(calls).toContain("data-call-workflow");
    expect(css.toLowerCase()).not.toContain("#0e2142");
    expect(css).toContain("background: var(--dash-paper)");
    for (const step of [
      "PRE-CALL BRIEF",
      "CALL AUDIO",
      "LIVE TRANSCRIPT",
      "CALL OUTCOME",
      "FOLLOW-UP",
    ])
      expect(calls).toContain(step);
  });
});
