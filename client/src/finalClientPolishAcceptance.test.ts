import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), "client/src", file), "utf8");

describe("final client-facing handover polish", () => {
  it("keeps all client polish in one canonical stylesheet", () => {
    const app = read("App.tsx");
    const css = read("index.css");
    expect(app).not.toContain("dashboard-final.css");
    expect(app).not.toContain("handover-final.css");
    expect(css).toContain(".amk-site");
    expect(css).toContain(".amk-auth");
    expect(css).toContain(".amarktai-dashboard-sidebar");
  });

  it("uses one auth shell with a true 50/50 image split on laptops", () => {
    const css = read("index.css");
    expect(css).toContain("@media (min-width: 900px)");
    expect(css).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/
    );
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

  it("makes Today refresh the live mailbox-backed sales day", () => {
    const today = read("pages/Today.tsx");
    const refresh = read("lib/refreshSalesDay.ts");
    expect(today).toContain("async function refreshDay()");
    expect(today).toContain("refreshInFlight.current");
    expect(today).toContain("refreshSalesDay({");
    expect(refresh).toContain('fetcher("/api/mailbox/sync"');
    expect(today).toContain("utils.sales.today.invalidate()");
    expect(today).toContain("utils.sales.customerDirectory.invalidate()");
    expect(today).toContain('toast.success("Your sales day is up to date.")');
  });

  it("keeps exact customer context through the AmarktAI conversation", () => {
    const assistant = read("pages/Assistant.tsx");
    expect(assistant).toContain("trpc.sales.customerDirectory.useQuery");
    expect(assistant).toContain("trpc.sales.customerDetail.useQuery");
    expect(assistant).toContain('params.get("contactId")');
    expect(assistant).toContain("/customers?contactId=");
    expect(assistant).toContain("data-assistant-conversation");
    expect(read("index.css")).not.toContain(
      "[data-assistant-conversation] { display: none"
    );
  });

  it("returns signed-out workspace users to the public home page", () => {
    const layout = read("components/DashboardLayout.tsx");
    const app = read("App.tsx");
    expect(layout).toContain('window.location.replace("/")');
    expect(layout).toContain('window.location.assign("/")');
    expect(layout).not.toContain("function SignedOut()");
    expect(app).toContain('navigate("/", { replace: true })');
  });

  it("moves dashboard copyright into the sidebar footer", () => {
    const css = read("index.css");
    expect(css).toContain(
      'body:has(.amarktai-dashboard-sidebar) [data-sidebar="footer"]::after'
    );
    expect(css).toContain("Part of Amarktai Network");
  });

  it("uses the approved dark editorial public layout and photography", () => {
    const css = read("index.css");
    expect(css).toContain(".amk-shell{width:min(1180px,calc(100% - 40px))");
    expect(css).toContain(".amk-photo-frame--hero{height:570px");
    expect(css).toContain("--site-bg:#0D1114");
    expect(css).toContain("--site-warm:#C79A62");
    expect(css).not.toContain(".amk-float-card");
  });
});
