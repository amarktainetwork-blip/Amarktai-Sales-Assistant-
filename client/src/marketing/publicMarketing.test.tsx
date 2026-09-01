import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
  ["/", HomePage, "Give them a better sales day."],
  ["/how-it-works", HowItWorksPage, "Keep your CRM."],
  ["/pricing", Pricing, "PRICING IN SOUTH AFRICAN RAND"],
  ["/about", AboutPage, "ABOUT AMARKTAI NETWORK"],
  ["/contact", ContactPage, "TALK TO AMARKTAI NETWORK"],
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

  it.each(pages)(
    "renders %s as a complete public page",
    (pathname, Component, expected) => {
      const html = render(pathname, Component);
      expect(html).toContain(expected);
      expect(html).toContain("Main navigation");
      expect(html).toContain("Amarktai Network");
      expect(html).toContain("Sales Assistant");
    }
  );

  it("keeps supplier branding out of customer-facing marketing source", () => {
    const root = path.resolve(process.cwd(), "client/src/marketing");
    const combined = sourceFiles(root)
      .map(file => readFileSync(file, "utf8"))
      .join("\n");
    expect(combined).not.toMatch(/\bGenX\b/i);
  });

  it("uses the approved replacement photography and removes rejected illustration assets", () => {
    const html = render("/", HomePage);
    expect(html).toContain("images.pexels.com/photos/7679563");
    expect(html).toContain("images.pexels.com/photos/8000530");
    expect(html).toContain("images.pexels.com/photos/14596539");
    expect(html).not.toContain("images.pexels.com/photos/8837770");
    expect(html).not.toContain("images.pexels.com/photos/8068833");
    expect(html).not.toContain("/images/site-hero.svg");
    expect(html).not.toContain("/images/site-intelligence.svg");
    expect(html).not.toContain("/images/site-calls.svg");
    expect(html).not.toContain("/images/site-team.svg");
    const howItWorks = render("/how-it-works", HowItWorksPage);
    expect(howItWorks).toContain("images.pexels.com/photos/8000530");
    expect(howItWorks).toContain("images.pexels.com/photos/14596539");
    expect(howItWorks).not.toContain("images.pexels.com/photos/8068833");
  });

  it("uses the requested public navigation order", () => {
    expect(marketingNavigation.map(item => item.href)).toEqual([
      "/how-it-works",
      "/about",
      "/pricing",
      "/contact",
    ]);
    const html = render("/", HomePage);
    for (const item of marketingNavigation)
      expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain(`href="${accountLinks.signIn}"`);
    expect(html).toContain(
      `href="${accountLinks.getStarted.replace("&", "&amp;")}"`
    );
    expect(html).toContain(">How It Works<");
    expect(html).toContain(">Sign In<");
    expect(html).toContain("Start Free");
    expect(html).toContain(
      "Amarktai Sales Assistant brings business knowledge, customer context, conversation help and follow-through into one personal sales workspace."
    );
    expect(html).toContain(
      `© ${new Date().getFullYear()} Amarktai Sales Assistant. Part of the Amarktai Network.`
    );
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
    const compactHtml = html
      .replaceAll("\u00a0", "")
      .replaceAll(",", "")
      .replaceAll(" ", "");
    for (const plan of PRICING_PLANS) {
      expect(html).toContain(plan.name);
      expect(compactHtml).toContain(`R${plan.monthlyZarCents / 100}`);
      expect(compactHtml).toContain(String(plan.includedAiCredits));
      expect(html).toContain(
        plan.includedUsers === 1
          ? "1 user"
          : `Up to ${plan.includedUsers} users`
      );
    }
    expect(compactHtml).toContain(
      `1000AIcredits·R${AI_CREDIT_ECONOMICS.retailPackZarCents / 100}`
    );
    expect(html).not.toMatch(/Stripe|PayFast|buy now|checkout now/i);
  });

  it("renders the streamlined contact form and status region", () => {
    const html = render("/contact", ContactPage);
    for (const label of [
      "Name",
      "Email",
      "Company",
      "Phone",
      "Sales team size",
      "How can we help?",
      "What would you like to improve?",
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
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("/api/public/contact");
    expect(html).not.toContain("We can help with");
    expect(html).not.toContain("20–2,000 characters");
  });

  it("renders the public 404 with a valid home action", () => {
    const html = render("/404", NotFound);
    expect(html).toContain("404");
    expect(html).toContain('href="/"');
  });

  it("registers the maintained public and account routes without placeholder links", () => {
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

  it("uses one public visual system and final launch safeguards", () => {
    const layout = readFileSync(
      path.resolve(process.cwd(), "client/src/marketing/MarketingLayout.tsx"),
      "utf8"
    );
    expect(layout).toContain('import "./final-site.css"');
    expect(layout).not.toContain("public-v6.css");
    expect(layout).not.toContain("marketing-v2.css");
    expect(layout).not.toContain("launch-v3.css");
    const css = readFileSync(
      path.resolve(process.cwd(), "client/src/marketing/final-site.css"),
      "utf8"
    );
    for (const breakpoint of ["1040px", "820px", "560px"])
      expect(css).toContain(`max-width: ${breakpoint}`);
    expect(css).toContain("min-width: 320px");
    expect(css).toContain("overflow: clip");
    expect(css).toContain("prefers-reduced-motion: reduce");
    const app = readFileSync(
      path.resolve(process.cwd(), "client/src/App.tsx"),
      "utf8"
    );
    expect(app).toContain('import "./final-release.css"');
    const finalRelease = readFileSync(
      path.resolve(process.cwd(), "client/src/final-release.css"),
      "utf8"
    );
    expect(finalRelease).toContain("body:has(.z-\\[250\\])");
    expect(finalRelease).toContain("[data-sonner-toast]");
    expect(finalRelease).toContain("radial-gradient");
  });
});
