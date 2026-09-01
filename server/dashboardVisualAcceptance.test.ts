import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses the final dashboard system without restoring legacy visual generations", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-final.css"');
    expect(app).toContain('import "./dashboard-client-readability.css"');
    expect(
      app.indexOf('import "./dashboard-client-readability.css"')
    ).toBeGreaterThan(app.indexOf('import "./dashboard-final.css"'));
    expect(app).not.toContain('import "./app-final.css"');
    expect(app).not.toContain('import "./dashboard-v6.css"');
    expect(app).not.toContain('import "./dashboard-v2.css"');
    expect(app).not.toContain('import "./dashboard-v3.css"');
    expect(app).not.toContain('import "./dashboard-handover.css"');
  });

  it("keeps the daily navigation focused and moves setup into Manage", () => {
    const layout = readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    for (const label of ["Today", "Customers", "Assistant", "Calls", "CRM"]) {
      expect(layout).toContain(`label: "${label}"`);
    }
    expect(layout).not.toContain('label: "Follow-ups"');
    expect(layout).not.toContain('label: "Automation"');
    expect(layout).not.toContain('label: "Reports"');
    expect(layout).not.toContain('label: "Approvals"');
    expect(layout).toContain('label: "Knowledge"');
    expect(layout).toContain('label: "Connections"');
    expect(layout).toContain('label: "Company"');
    expect(layout).toContain("Sales workspace");
    expect(layout).toContain("Manage");
  });

  it("uses a light neutral workspace palette with explicit high-contrast status and selected states", () => {
    const css = readFileSync(
      path.resolve("client/src/dashboard-final.css"),
      "utf8"
    );
    const readability = readFileSync(
      path.resolve("client/src/dashboard-client-readability.css"),
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
    expect(css).toContain("background: #fbfcfd !important");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("input::placeholder");

    expect(feedback).toContain("data-workflow-feedback={state.kind}");
    expect(feedback).toContain("bg-blue-50 text-blue-950");
    expect(feedback).toContain("bg-emerald-50 text-emerald-950");
    expect(feedback).toContain("bg-rose-50 text-rose-950");
    expect(readability).toContain('[data-workflow-feedback="loading"]');
    expect(readability).toContain("nav .bg-stone-900");
    expect(readability).toContain("color: #ffffff !important");
  });
});
