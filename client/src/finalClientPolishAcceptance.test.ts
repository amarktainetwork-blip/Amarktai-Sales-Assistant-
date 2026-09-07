import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), "client/src", file), "utf8");

describe("final client-facing handover polish", () => {
  it("keeps final polish in the canonical public, dashboard and base stylesheets", () => {
    const app = read("App.tsx");
    expect(app).toContain('import "./dashboard-final.css";');
    expect(app).not.toContain("handover-final.css");
  });

  it("keeps onboarding hero legible inside the dashboard route shell", () => {
    const css = read("index.css");
    expect(css).toContain('> main.amk-auth--setup .amk-auth__visual .amk-auth__message h1');
    expect(css).toMatch(/main\.amk-auth--setup[\s\S]*\.amk-auth__message h1[\s\S]*color:\s*#ffffff\s*!important/);
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
    const refresh = read("lib/refreshSalesDay.ts");
    expect(today).toContain("async function refreshDay()");
    expect(today).toContain("refreshInFlight.current");
    expect(today).toContain("refreshSalesDay({");
    expect(refresh).toContain('fetcher("/api/mailbox/sync"');
    expect(today).toContain("utils.sales.today.invalidate()");
    expect(today).toContain("utils.sales.customers.invalidate()");
    expect(today).toContain('toast.success("Your sales day is up to date.")');
  });

  it("keeps AmarktAI as one conversation surface", () => {
    const css = read("dashboard-final.css");
    expect(css).toContain("[data-assistant-workspace]");
    expect(css).toContain('[data-assistant-workspace] > div[class*="grid"] > aside');
    expect(css).toMatch(/aside[\s\S]*display:\s*none\s*!important/);
  });

  it("moves dashboard copyright into the sidebar footer", () => {
    const css = read("dashboard-final.css");
    expect(css).toContain('body:has(.amarktai-dashboard-sidebar)::after');
    expect(css).toContain('body:has(.amarktai-dashboard-sidebar) [data-sidebar="footer"]::after');
    expect(css).toContain("Part of Amarktai Network");
    expect(css).toMatch(/body:has\(\.amarktai-dashboard-sidebar\)::after[\s\S]*content:\s*none\s*!important/);
  });

  it("widens public pages and gives approved photography more presence", () => {
    const css = read("marketing/final-site.css");
    expect(css).toContain("width: min(1320px, calc(100% - 72px))");
    expect(css).toContain(".amk-photo-frame--hero { height: 640px; }");
    expect(css).toContain(".amk-photo-frame--page { height: 560px; }");
  });
});
