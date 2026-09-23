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
    expect(css).not.toMatch(
      /\.amk-auth[^{]*\{[^}]*color:\s*#fff(?:fff)?\s*!important/i
    );
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

  it("keeps dashboard branding in the real wordmark instead of pseudo text", () => {
    const css = read("index.css");
    const layout = read("components/DashboardLayout.tsx");
    expect(css).not.toContain(
      'body:has(.amarktai-dashboard-sidebar) [data-sidebar="footer"]::after'
    );
    expect(layout).toContain("<BrandMark />");
  });

  it("uses the approved editorial public layout, unique photography and swirl system", () => {
    const css = read("index.css");
    expect(css).toMatch(
      /\.amk-shell\s*\{[^}]*width:\s*min\(1180px,\s*calc\(100% - 40px\)\)/i
    );
    expect(css).toMatch(/\.amk-photo-frame--hero\s*\{[^}]*height:\s*560px/i);
    expect(css).toMatch(/--site-bg:\s*#e8eceb/i);
    expect(css).toMatch(/--site-warm:\s*#a46f37/i);
    expect(css).toContain(".amk-swirl--blue");
    expect(css).toMatch(
      /\.amk-site main\s*\{[^}]*display:\s*block[^}]*background:\s*#e8eceb/i
    );
    expect(css).not.toContain(".amk-float-card");
  });
});
