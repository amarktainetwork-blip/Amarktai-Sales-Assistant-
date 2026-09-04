import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import AboutPage from "./AboutPage";
import ContactPage, { contactReasons } from "./ContactPage";
import HomePage from "./HomePage";
import { HowItWorksPage } from "./SecondaryPages";
import Pricing from "@/pages/Pricing";
import { accountLinks, marketingNavigation } from "./site";
import { scrollPublicRouteToTop } from "./MarketingLayout";
import NotFound from "@/pages/NotFound";
import { AI_CREDIT_ECONOMICS, PRICING_PLANS } from "@shared/pricing";

const pages = [
  ["/", HomePage, "Sell with more confidence."],
  ["/how-it-works", HowItWorksPage, "Keep your CRM. Make the sales work around it easier."],
  ["/pricing", Pricing, "SIMPLE PRICING IN SOUTH AFRICAN RAND"],
  ["/about", AboutPage, "WHY AMARKTAI"],
  ["/contact", ContactPage, "TALK TO US"],
] as const;

function render(pathname: string, Component: React.ComponentType) {
  return renderToStaticMarkup(
    <Router ssrPath={pathname}>
      <Component />
    </Router>
  );
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name);
    return statSync(target).isDirectory()
      ? sourceFiles(target)
      : /\.(tsx|ts)$/.test(target) && !/\.test\./.test(target)
        ? [target]
        : [];
  });
}

describe("final public website", () => {
  it("keeps the document CSP-clean without external font styles", () => {
    const html = readFileSync(path.resolve("client/index.html"), "utf8");
    expect(html).not.toContain("%VITE_ANALYTICS_");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });

  it.each(pages)("renders %s as a complete public page", (pathname, Component, expected) => {
    const html = render(pathname, Component);
    expect(html).toContain(expected);
    expect(html).toContain("Main navigation");
    expect(html).toContain("Amarkt");
    expect(html).toContain(">AI<");
    expect(html).toContain("Network");
    expect(html).toContain("SALES ASSISTANT");
  });

  it("keeps supplier branding out of customer-facing marketing source", () => {
    const root = path.resolve(process.cwd(), "client/src/marketing");
    const combined = sourceFiles(root).map(file => readFileSync(file, "utf8")).join("\n");
    expect(combined).not.toMatch(/\bGenX\b/i);
  });

  it("keeps semantic first-party visual fallbacks in markup while the final theme can supply curated photography", () => {
    const home = render("/", HomePage);
    const how = render("/how-it-works", HowItWorksPage);
    const about = render("/about", AboutPage);
    const contact = render("/contact", ContactPage);
    for (const html of [home, how, about, contact]) {
      expect(html).not.toContain("images.pexels.com");
      expect(html).not.toContain("images.unsplash.com");
    }
    expect(home).toContain("/images/site-hero.svg");
    expect(home).toContain("/images/site-calls.svg");
    expect(home).toContain("/images/site-intelligence.svg");
    expect(home).toContain("/images/site-team.svg");
    expect(home).toContain("amk-photo-frame");
  });

  it("leads with the conversion message and keeps the sales loop on the homepage", () => {
    const html = render("/", HomePage);
    expect(html).toContain("Sell with more confidence.");
    expect(html).toContain("Keep the CRM you already trust");
    expect(html).toContain("ONE ASSISTANT ACROSS THE SALES LOOP");
    expect(html).toContain("Start free");
    expect(html).toContain("Book a demo");
  });

  it("uses the requested public navigation order and separates product branding from company attribution", () => {
    expect(marketingNavigation.map(item => item.href)).toEqual(["/how-it-works", "/about", "/pricing", "/contact"]);
    expect(marketingNavigation[1]?.label).toBe("Why AmarktAI");
    const html = render("/", HomePage);
    for (const item of marketingNavigation) expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain(`href="${accountLinks.signIn}"`);
    expect(html).toContain(`href="${accountLinks.getStarted.replace("&", "&amp;")}"`);
    expect(html).toContain(">How It Works<");
    expect(html).toContain(">Sign In<");
    expect(html).toContain("Start Free");
    expect(html).not.toContain("Amarktai Sales Assistant");
    expect(html).toContain("Part of Amarktai Network");
  });

  it("restores scroll on public route transitions without touching dashboard routes", () => {
    const scrollTo = vi.fn();
    expect(scrollPublicRouteToTop("/how-it-works", scrollTo)).toBe(true);
    expect(scrollPublicRouteToTop("/about", scrollTo)).toBe(true);
    expect(scrollPublicRouteToTop("/contact", scrollTo)).toBe(true);
    expect(scrollPublicRouteToTop("/dashboard", scrollTo)).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it("renders the ZAR commercial source of truth without claiming checkout", () => {
    const html = render("/pricing", Pricing);
    const compactHtml = html.replaceAll("\u00a0", "").replaceAll(",", "").replaceAll(" ", "");
    for (const plan of PRICING_PLANS) {
      expect(html).toContain(plan.name);
      expect(compactHtml).toContain(`R${plan.monthlyZarCents / 100}`);
      expect(compactHtml).toContain(String(plan.includedAiCredits));
      expect(html).toContain(plan.includedUsers === 1 ? "1 user" : `Up to ${plan.includedUsers} users`);
    }
    expect(compactHtml).toContain(`1000AIcredits·R${AI_CREDIT_ECONOMICS.retailPackZarCents / 100}`);
    expect(html).not.toMatch(/Stripe|PayFast|buy now|checkout now/i);
  });

  it("renders the streamlined contact form and status region", () => {
    const html = render("/contact", ContactPage);
    for (const label of ["Name", "Email", "Company", "Phone", "Sales team size", "How can we help?", "What would you like to improve?"]) expect(html).toContain(label);
    expect(contactReasons).toEqual(["Request a demo", "Sales", "Individual setup", "Team setup", "CRM compatibility", "Support"]);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("/api/public/contact");
    expect(html).toContain("/assets/amarktai-sales-trust.svg");
    expect(html).not.toContain("images.pexels.com");
  });

  it("renders the public 404 with a valid home action", () => {
    const html = render("/404", NotFound);
    expect(html).toContain("404");
    expect(html).toContain('href="/"');
  });

  it("registers every maintained public/account link without placeholder hrefs", () => {
    const root = path.resolve(process.cwd(), "client/src");
    const app = readFileSync(path.join(root, "App.tsx"), "utf8");
    for (const pathname of [...marketingNavigation.map(item => item.href), "/", "/auth", "/404"]) expect(app).toContain(`path="${pathname}"`);
    const combined = sourceFiles(path.join(root, "marketing")).map(file => readFileSync(file, "utf8")).join("\n");
    expect(combined).not.toMatch(/href=["']#["']/);
    expect(combined).not.toContain("javascript:void");
  });

  it("uses one public and one logged-in visual system with launch safeguards", () => {
    const layout = readFileSync(path.resolve(process.cwd(), "client/src/marketing/MarketingLayout.tsx"), "utf8");
    expect(layout).toContain('import "./final-site.css"');
    expect(layout).not.toContain("public-v6.css");
    expect(layout).not.toContain("marketing-v2.css");
    expect(layout).not.toContain("launch-v3.css");

    const css = readFileSync(path.resolve(process.cwd(), "client/src/marketing/final-site.css"), "utf8");
    for (const breakpoint of ["1040px", "820px", "560px"]) expect(css).toContain(`max-width: ${breakpoint}`);
    expect(css).toContain("min-width: 320px");
    expect(css).toContain("overflow: clip");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".amk-auth");
    expect(css).toContain(".amk-photo-frame");
    expect(css).toContain("--navy: #10233d");
    expect(existsSync(path.resolve(process.cwd(), "client/src/pages/final-auth.css"))).toBe(false);
    expect(existsSync(path.resolve(process.cwd(), "client/src/marketing/visual-handover.css"))).toBe(false);

    const app = readFileSync(path.resolve(process.cwd(), "client/src/App.tsx"), "utf8");
    expect(app).toContain('import "./dashboard-final.css"');
    expect(app).not.toContain("dashboard-client-readability.css");
    expect(app).not.toContain("final-release.css");

    const dashboardCss = readFileSync(path.resolve(process.cwd(), "client/src/dashboard-final.css"), "utf8");
    expect(dashboardCss).toContain("One logged-in visual system");
    expect(dashboardCss).toContain('body:has([data-slot="sidebar-wrapper"])');
    expect(dashboardCss).toContain("--dash-blue: #2f6fed");
  });
});
