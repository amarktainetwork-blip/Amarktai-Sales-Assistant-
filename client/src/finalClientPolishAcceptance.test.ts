import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), "client/src", file), "utf8");

describe("final client-facing handover polish", () => {
  it("loads the final handover stylesheet after the dashboard stylesheet", () => {
    const app = read("App.tsx");
    const dashboardIndex = app.indexOf('import "./dashboard-final.css";');
    const handoverIndex = app.indexOf('import "./handover-final.css";');
    expect(dashboardIndex).toBeGreaterThanOrEqual(0);
    expect(handoverIndex).toBeGreaterThan(dashboardIndex);
  });

  it("keeps company setup in customer language", () => {
    const onboarding = read("pages/Onboarding.tsx");
    expect(onboarding).toContain("Set up AmarktAI for your business.");
    expect(onboarding).toContain("Let AmarktAI learn your public website.");
    expect(onboarding).toContain("Sign in to your CRM and finish the connection.");
    expect(onboarding).not.toContain("prove the required CRM reads");
    expect(onboarding).not.toContain("governed write operations");
    expect(onboarding).not.toContain("backend-verified");
  });

  it("makes Home refresh the live mailbox-backed sales day", () => {
    const today = read("pages/Today.tsx");
    expect(today).toContain("async function refreshDay()");
    expect(today).toContain('fetch("/api/mailbox/sync"');
    expect(today).toContain("utils.sales.today.invalidate()");
    expect(today).toContain("utils.sales.customers.invalidate()");
    expect(today).toContain('toast.success("Your sales day is up to date.")');
  });

  it("keeps AmarktAI as one conversation surface", () => {
    const css = read("handover-final.css");
    expect(css).toContain("[data-assistant-workspace]");
    expect(css).toContain('[data-assistant-workspace] > div[class*="grid"] > aside');
    expect(css).toMatch(/aside[\s\S]*display:\s*none\s*!important/);
  });

  it("moves dashboard copyright into the sidebar footer", () => {
    const css = read("handover-final.css");
    expect(css).toContain('body:has(.amarktai-dashboard-sidebar)::after');
    expect(css).toContain('body:has(.amarktai-dashboard-sidebar) [data-sidebar="footer"]::after');
    expect(css).toContain("Part of Amarktai Network");
    expect(css).toMatch(/body:has\(\.amarktai-dashboard-sidebar\)::after[\s\S]*content:\s*none\s*!important/);
  });

  it("widens public pages and gives approved photography more presence", () => {
    const css = read("handover-final.css");
    expect(css).toContain("width: min(1320px, calc(100% - 72px))");
    expect(css).toContain(".amk-photo-frame--hero { height: 640px !important; }");
    expect(css).toContain(".amk-photo-frame--page { height: 560px !important; }");
  });
});
