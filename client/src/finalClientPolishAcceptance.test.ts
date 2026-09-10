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

  it("uses one auth shell with form priority on laptops", () => {
    const css = read("index.css");
    expect(css).toContain("@media (min-width: 1440px) and (min-height: 900px)");
    expect(css).toMatch(/\.amk-auth__visual\s*\{\s*display: none/);
    expect(css).toMatch(/\.amk-auth\.fixed\s*\{[^}]*overflow-y: auto/);
    expect(css).not.toContain("color: #ffffff !important");
    expect(css).not.toContain("content: url(");
  });

  it("keeps company setup in customer language", () => {
    const onboarding = read("pages/Onboarding.tsx");
    expect(onboarding).toContain("Tell us about your business.");
    expect(onboarding).toContain("Learn about your company.");
    expect(onboarding).toContain("Connect your CRM.");
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

  it("keeps customer context actions reachable in the conversation", () => {
    const assistant = read("pages/Assistant.tsx");
    expect(assistant).toContain("Customer details and actions");
    expect(assistant).toContain("<details");
    expect(assistant).toContain("data-assistant-conversation");
    expect(read("dashboard-final.css")).not.toContain("display: none !important");
  });

  it("moves dashboard copyright into the sidebar footer", () => {
    const css = read("dashboard-final.css");
    expect(css).toContain('body:has(.amarktai-dashboard-sidebar) [data-sidebar="footer"]::after');
    expect(css).toContain("Part of Amarktai Network");
  });

  it("widens public pages and gives approved photography more presence", () => {
    const css = read("marketing/final-site.css");
    expect(css).toContain("width: min(1320px, calc(100% - 72px))");
    expect(css).toContain("aspect-ratio: 4 / 5");
    expect(css).not.toContain(".amk-photo-frame::after");
    expect(css).not.toContain(".amk-float-card");
  });
});
