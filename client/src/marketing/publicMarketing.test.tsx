import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import ContactPage, { contactReasons } from "./ContactPage";
import HomePage from "./HomePage";
import {
  HowItWorksPage,
  IndividualsPage,
  IntegrationsPage,
  PricingPage,
  ProductPage,
  TeamsPage,
} from "./SecondaryPages";
import { accountLinks, marketingNavigation } from "./site";
import { scrollPublicRouteToTop } from "./MarketingLayout";
import NotFound from "@/pages/NotFound";
import { AI_CREDIT_ECONOMICS, PRICING_PLANS } from "@shared/pricing";

const pages = [
  ["/", HomePage, "Your sales day"],
  ["/product", ProductPage, "Everything the sales day needs"],
  ["/how-it-works", HowItWorksPage, "From setup to selling"],
  ["/individuals", IndividualsPage, "Spend more time selling"],
  ["/teams", TeamsPage, "One consistent workspace"],
  ["/integrations", IntegrationsPage, "Keep your CRM"],
  ["/pricing", PricingPage, "Simple plans"],
  ["/contact", ContactPage, "Talk to Amarktai"],
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

describe("public marketing website", () => {
  it("does not emit unresolved optional analytics placeholders", () => {
    const html = readFileSync(path.resolve("client/index.html"), "utf8");
    expect(html).not.toContain("%VITE_ANALYTICS_");
  });
  it.each(pages)(
    "renders %s as a real public page",
    (pathname, Component, expected) => {
      const html = render(pathname, Component);
      expect(html).toContain(expected);
      expect(html).toContain("Main navigation");
      expect(html).toContain("Amarktai Network");
    }
  );

  it("keeps desktop, mobile and footer destinations on valid routes", () => {
    const html = render("/", HomePage);
    for (const item of marketingNavigation)
      expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain(`href="${accountLinks.signIn}"`);
    expect(html).toContain(
      `href="${accountLinks.getStarted.replace("&", "&amp;")}"`
    );
    const layout = readFileSync(
      path.resolve(process.cwd(), "client/src/marketing/MarketingLayout.tsx"),
      "utf8"
    );
    expect(layout).toContain('aria-label="Mobile navigation"');
    expect(layout).toContain("marketingNavigation.map");
    expect(layout).toContain("marketing-mobile-nav__account");
  });

  it("restores scroll on public route transitions without touching dashboard routes", () => {
    const scrollTo = vi.fn();
    expect(scrollPublicRouteToTop("/product", scrollTo)).toBe(true);
    expect(scrollPublicRouteToTop("/contact", scrollTo)).toBe(true);
    expect(scrollTo).toHaveBeenNthCalledWith(1, {
      top: 0,
      left: 0,
      behavior: "auto",
    });
    expect(scrollTo).toHaveBeenNthCalledWith(2, {
      top: 0,
      left: 0,
      behavior: "auto",
    });
    expect(scrollPublicRouteToTop("/dashboard", scrollTo)).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("renders the shared commercial source of truth without claiming checkout", () => {
    const html = render("/pricing", PricingPage);
    const compactHtml = html.replaceAll("\u00a0", "").replaceAll(",", "");
    for (const plan of PRICING_PLANS) {
      expect(html).toContain(plan.name);
      expect(html).toContain(`$${plan.monthlyUsdCents / 100}`);
      expect(compactHtml).toContain(
        `${plan.includedAiCredits} included AI credits`
      );
      expect(html).toContain(
        plan.includedUsers === 1
          ? "1 included user"
          : `Up to ${plan.includedUsers} included users`
      );
    }
    expect(html).toContain(
      `1,000 AI credits for $${AI_CREDIT_ECONOMICS.retailPackUsdCents / 100}`
    );
    expect(html).toContain("Routine CRM work does not consume AI credits");
    expect(html).toContain("Plans for real sales work");
    expect(html).not.toMatch(/Stripe|PayFast|buy now|checkout now/i);
  });

  it("renders the full labelled contact form and inline status region", () => {
    const html = render("/contact", ContactPage);
    for (const label of [
      "Name",
      "Email",
      "Company",
      "Phone",
      "Team size",
      "Reason for contacting us",
      "Message",
    ])
      expect(html).toContain(label);
    expect(contactReasons).toEqual([
      "Request a demo",
      "Sales",
      "Individual setup",
      "Team setup",
      "CRM compatibility",
      "Support",
    ]);
    for (const reason of contactReasons) expect(html).toContain(reason);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("/api/public/contact");
  });

  it("renders the public 404 with a valid home action", () => {
    const html = render("/404", NotFound);
    expect(html).toContain("404");
    expect(html).toContain('href="/"');
  });

  it("registers every public and account route without placeholder links", () => {
    const root = path.resolve(process.cwd(), "client/src");
    const app = readFileSync(path.join(root, "App.tsx"), "utf8");
    for (const pathname of [
      ...marketingNavigation.map(item => item.href),
      "/",
      "/auth",
      "/404",
    ])
      expect(app).toContain(`path="${pathname}"`);
    const combined = sourceFiles(path.join(root, "marketing"))
      .map(file => readFileSync(file, "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/href=["']#["']/);
    expect(combined).not.toContain("javascript:void");
  });

  it("defines compact mobile, tablet, laptop and wide-screen-safe layout boundaries", () => {
    const css = readFileSync(
      path.resolve(process.cwd(), "client/src/marketing/marketing.css"),
      "utf8"
    );
    for (const breakpoint of ["1120px", "820px", "560px"])
      expect(css).toContain(`max-width: ${breakpoint}`);
    expect(css).toContain("min-width: 320px");
    expect(css).toContain("grid-template-columns: 1fr");
    expect(css).toContain("overflow: clip");
    expect(css).toContain("width: min(1180px, calc(100% - 40px))");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
