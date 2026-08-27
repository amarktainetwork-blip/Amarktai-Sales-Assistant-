import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("final dashboard information architecture", () => {
  it("uses one dashboard visual system instead of stacked patch styles", () => {
    const app = readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-v6.css"');
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
    expect(layout).toContain("<BrandMark inverse />");
  });

  it("uses a soft slate/light workspace palette and readable message override", () => {
    const css = readFileSync(path.resolve("client/src/dashboard-v6.css"), "utf8");
    expect(css).toContain("--d-sidebar:#3a4d66");
    expect(css).toContain("--d-canvas:#f5f7fa");
    expect(css).toContain("--d-paper:#ffffff");
    expect(css).toContain("--d-blue:#3f70d8");
    expect(css).toContain('[class*="whitespace-pre-wrap"]');
    expect(css).toContain("main>div>section.mt-7.grid");
  });
});
