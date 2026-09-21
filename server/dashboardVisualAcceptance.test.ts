import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses one canonical dashboard stylesheet without restoring legacy generations", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-final.css"');
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

    for (const label of ["Today", "Customers", "Calls", "AmarktAI", "Review"])
      expect(layout).toContain(`label: "${label}"`);
    expect(layout).toContain('label: "CRM setup"');
    expect(layout).toContain('path: "/connections"');
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
    expect(app).toContain('<Route path="/settings">');
    expect(app).toContain("<PersonalSetupBoundary />");

    expect(settings).toContain('title="Company setup"');
    expect(settings).toContain('title="CRM connection"');
    expect(settings).toContain('title="Company knowledge"');
    expect(settings).toContain('title="Team members"');
  });

  it("keeps the salesperson flow action-first instead of repeating decorative banners", () => {
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const today = readFileSync(path.resolve("client/src/pages/Today.tsx"), "utf8");
    const customers = readFileSync(
      path.resolve("client/src/pages/Customers.tsx"),
      "utf8"
    );
    const review = readFileSync(path.resolve("client/src/pages/Reviews.tsx"), "utf8");
    const assistant = readFileSync(
      path.resolve("client/src/pages/Assistant.tsx"),
      "utf8"
    );

    expect(layout).not.toContain("data-new-lead-alert");
    expect(layout).toContain("storedCompanyComplete && crmAttention && crmProblem");
    expect(today).not.toContain("Daily loop");
    expect(today).not.toContain("Work the hottest customer");
    expect(today).toContain("Immediate work is clear.");
    expect(today).toContain("AmarktAI prepares admin");
    expect(customers).not.toContain("Know the person before you call.");
    expect(customers).toContain("Customer context");
    expect(review).not.toContain("Only stop here when AmarktAI needs your decision.");
    expect(review).toContain("Back to Today");
    expect(assistant).not.toContain("Give me the admin around the call.");
    expect(assistant).toContain("Your sales assistant is ready");
    expect(assistant).toContain('label="Why now"');
    expect(assistant).toContain("Draft first. Customer-facing actions remain reviewable.");
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
    expect(settings).toContain('kind: "operational_report", format: "csv"');
    expect(settings).toContain('kind: "conversation_log", format: "pdf"');
    expect(settings).toContain("Download sales activity CSV");
    expect(settings).toContain("Download call log PDF");
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
    const css = readFileSync(
      path.resolve("client/src/dashboard-final.css"),
      "utf8"
    );
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );

    expect(css).toContain("--dash-canvas: #f2f0eb");
    expect(css).toContain("--dash-paper: #fbfaf7");
    expect(css).toContain("--dash-ink: #30363c");
    expect(css).toContain("--dash-blue: #526d9d");
    expect(css).toContain("--handover-blue: #526d9d");
    expect(css).toContain("--handover-canvas: #f2f0eb");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("input::placeholder");

    expect(layout).toContain('SidebarInset className="bg-[#F3F2EF]"');
    expect(layout).toContain("bg-[#ECEBE6]");
    expect(layout).not.toContain(
      'className="border-r border-[#1B2B44] bg-[#0B1B36] text-white"'
    );
    expect(layout).not.toContain("bg-white/[.06]");
  });

  it("keeps the call workflow and does not rely on a deleted override layer", () => {
    const calls = readFileSync(
      path.resolve("client/src/pages/LiveCalls.tsx"),
      "utf8"
    );
    const css = readFileSync(
      path.resolve("client/src/dashboard-final.css"),
      "utf8"
    );
    expect(calls).toContain("data-call-workflow");
    expect(css).toContain('[class*="bg-[#0E2142]"]');
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
