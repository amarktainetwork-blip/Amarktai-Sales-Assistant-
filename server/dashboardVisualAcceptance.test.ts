import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses one dashboard visual system instead of stacked patch styles", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-final.css"');
    expect(app).not.toContain('import "./app-final.css"');
    expect(app).not.toContain('import "./dashboard-v6.css"');
    expect(app).not.toContain('import "./dashboard-v2.css"');
    expect(app).not.toContain('import "./dashboard-v3.css"');
    expect(app).not.toContain('import "./dashboard-handover.css"');
  });

  it("keeps the daily navigation focused and moves setup into Manage", () => {
    const layout = readFileSync(path.resolve("client/src/components/DashboardLayout.tsx"), "utf8");
    for (const label of ["Today", "Customers", "Assistant", "Calls", "CRM"]) {
      expect(layout).toContain(`label: "${label}"`);
    }
    expect(layout).not.toContain('label: "Follow-ups"');
    expect(layout).not.toContain('label: "Automation"');
    expect(layout).not.toContain('label: "Reports"');
    expect(layout).not.toContain('label: "Approvals"');
    expect(layout).toContain('label: "Knowledge"');
    expect(layout).toContain('label: "Connections"');
    expect(layout).toContain('label: "Settings"');
    expect(layout).toContain("Daily work");
    expect(layout).toContain("Manage");
  });

  it("uses a light neutral workspace palette and readable message override", () => {
    const css = readFileSync(path.resolve("client/src/dashboard-final.css"), "utf8");
    expect(css).toContain("--dash-canvas: #f4f6f8");
    expect(css).toContain("--dash-paper: #ffffff");
    expect(css).toContain("--dash-ink: #203047");
    expect(css).toContain("--dash-blue: #2f6fed");
    expect(css).toContain("background: #fbfcfd !important");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("input::placeholder");
  });
});
