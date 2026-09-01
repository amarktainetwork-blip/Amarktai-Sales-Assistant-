import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses one logged-in stylesheet without restoring legacy visual generations", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-final.css"');
    expect(app).not.toContain('import "./dashboard-client-readability.css"');
    expect(app).not.toContain('import "./final-release.css"');
    expect(app).not.toContain('import "./app-final.css"');
    expect(app).not.toContain('import "./dashboard-v6.css"');
    expect(app).not.toContain('import "./dashboard-v2.css"');
    expect(app).not.toContain('import "./dashboard-v3.css"');
    expect(app).not.toContain('import "./dashboard-handover.css"');
  });

  it("keeps daily sales work simple while keeping manager CRM access visible", () => {
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const settings = readFileSync(
      path.resolve("client/src/pages/Settings.tsx"),
      "utf8"
    );
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");

    for (const label of ["Home", "Customers", "Calls", "Assistant"])
      expect(layout).toContain(`label: "${label}"`);
    expect(layout).toContain('label: "CRM"');
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
    expect(layout).toContain(">Sign out</span>");

    expect(app).toContain('<Route path="/dashboard" component={Today} />');
    expect(app).toContain('<Route path="/settings">');
    expect(app).toContain("<PersonalSetupBoundary />");

    expect(settings).toContain('title="Company setup"');
    expect(settings).toContain('title="CRM connection"');
    expect(settings).toContain('title="Company knowledge"');
    expect(settings).toContain('title="Team members"');
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

  it("uses a light navy-blue dashboard and readable workflow feedback", () => {
    const css = readFileSync(
      path.resolve("client/src/dashboard-final.css"),
      "utf8"
    );
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const feedback = readFileSync(
      path.resolve("client/src/components/WorkflowFeedback.tsx"),
      "utf8"
    );

    expect(css).toContain("--dash-canvas: #f4f6f8");
    expect(css).toContain("--dash-paper: #ffffff");
    expect(css).toContain("--dash-ink: #203047");
    expect(css).toContain("--dash-blue: #2f6fed");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("input::placeholder");

    expect(layout).toContain('bg-white text-[#26354A]');
    expect(layout).toContain('bg-[#EAF1FF] text-[#2459C2]');
    expect(layout).not.toContain('className="border-r border-[#1B2B44] bg-[#0B1B36] text-white"');
    expect(layout).not.toContain("bg-white/[.06]");

    expect(feedback).toContain("data-workflow-feedback={state.kind}");
    expect(feedback).toContain("bg-blue-50 text-blue-950");
    expect(feedback).toContain("bg-emerald-50 text-emerald-950");
    expect(feedback).toContain("bg-rose-50 text-rose-950");
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
    expect(css).toContain("background: var(--dash-paper) !important");
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
