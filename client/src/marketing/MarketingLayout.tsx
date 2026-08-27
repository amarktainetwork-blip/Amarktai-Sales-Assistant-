import { BrandMark } from "@/components/BrandMark";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { accountLinks, marketingNavigation, publicPageMetadata } from "./site";
import "./public-v6.css";

export function scrollPublicRouteToTop(
  location: string,
  scrollTo: (options: ScrollToOptions) => void = options => window.scrollTo(options)
) {
  const pathname = location.split(/[?#]/, 1)[0];
  if (!Object.hasOwn(publicPageMetadata, pathname)) return false;
  scrollTo({ top: 0, left: 0, behavior: "auto" });
  return true;
}

export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    scrollPublicRouteToTop(location);
  }, [location]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  return (
    <div className="site-root">
      <a className="site-skip" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-shell site-header__inner">
          <Link href="/" className="site-brand" aria-label="Amarktai Sales Assistant home">
            <BrandMark large />
          </Link>
          <nav className="site-nav" aria-label="Main navigation">
            {marketingNavigation.map(item => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={location === item.href ? "page" : undefined}
                className={location === item.href ? "is-active" : ""}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="site-header__actions">
            <Link href={accountLinks.signIn} className="site-signin">Sign in</Link>
            <Link href={accountLinks.getStarted} className="site-button site-button--primary site-button--small">
              Start free <ArrowRight size={15}/>
            </Link>
            <button
              ref={menuButton}
              type="button"
              className="site-menu-button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="mobile-marketing-navigation"
              onClick={() => setMenuOpen(value => !value)}
            >
              {menuOpen ? <X/> : <Menu/>}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="mobile-marketing-navigation" className="site-mobile-nav" aria-label="Mobile navigation">
            <div className="site-shell">
              {marketingNavigation.map(item => (
                <Link key={item.href} href={item.href}>{item.label}</Link>
              ))}
              <div className="marketing-mobile-nav__account">
                <Link href={accountLinks.signIn}>Sign in</Link>
                <Link href={accountLinks.getStarted} className="site-button site-button--primary">Start free</Link>
              </div>
            </div>
          </nav>
        ) : null}
      </header>
      <main id="main-content">{children}</main>
      <footer className="site-footer">
        <div className="site-shell site-footer__top">
          <div className="site-footer__brand">
            <BrandMark large inverse />
            <p className="site-footer__network">Part of <strong>Amarktai Network</strong></p>
            <p>AI products built to remove operational friction and help businesses do better work.</p>
          </div>
          <div className="site-footer__links">
            <div>
              <h2>Sales Assistant</h2>
              <Link href="/product">Product</Link>
              <Link href="/how-it-works">How it works</Link>
              <Link href="/individuals">For individuals</Link>
              <Link href="/teams">For teams</Link>
            </div>
            <div>
              <h2>Business</h2>
              <Link href="/integrations">CRM connections</Link>
              <Link href="/pricing">Pricing</Link>
              <Link href="/about">About</Link>
              <Link href="/contact">Contact</Link>
            </div>
            <div>
              <h2>Workspace</h2>
              <Link href={accountLinks.signIn}>Sign in</Link>
              <Link href={accountLinks.getStarted}>Create account</Link>
            </div>
          </div>
        </div>
        <div className="site-shell site-footer__base">
          <p>© {new Date().getFullYear()} Amarktai. Part of Amarktai Network.</p>
          <p>Sales Assistant · South Africa</p>
        </div>
      </footer>
    </div>
  );
}
