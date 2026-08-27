import { BrandMark } from "@/components/BrandMark";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { accountLinks, marketingNavigation, publicPageMetadata } from "./site";
import "./final-site.css";

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
    <div className="amk-site">
      <a className="amk-skip" href="#main-content">Skip to content</a>
      <header className="amk-header">
        <div className="amk-shell amk-header__inner">
          <div className="amk-brand">
            <BrandMark large />
          </div>
          <nav className="amk-nav" aria-label="Main navigation">
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
          <div className="amk-header__actions">
            <Link href={accountLinks.signIn} className="amk-signin">Sign In</Link>
            <Link href={accountLinks.getStarted} className="amk-button amk-button--primary amk-button--small">
              Start Free <ArrowRight size={15} />
            </Link>
            <button
              ref={menuButton}
              type="button"
              className="amk-menu-button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="amk-mobile-navigation"
              onClick={() => setMenuOpen(value => !value)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="amk-mobile-navigation" className="amk-mobile-nav" aria-label="Mobile navigation">
            <div className="amk-shell amk-mobile-nav__inner">
              {marketingNavigation.map(item => (
                <Link key={item.href} href={item.href}>{item.label}</Link>
              ))}
              <Link href={accountLinks.signIn}>Sign In</Link>
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start Free</Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main id="main-content">{children}</main>

      <footer className="amk-footer">
        <div className="amk-shell amk-footer__top">
          <div>
            <BrandMark large inverse />
            <p className="amk-footer__statement">Amarktai Sales Assistant is part of the Amarktai Network.</p>
            <p className="amk-footer__copy">AI products designed to remove operational friction and help people do better work.</p>
          </div>
          <nav className="amk-footer__nav" aria-label="Footer navigation">
            <Link href="/about">About</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/contact">Contact</Link>
            <Link href={accountLinks.signIn}>Sign in</Link>
          </nav>
        </div>
        <div className="amk-shell amk-footer__base">
          <p>© {new Date().getFullYear()} Amarktai Sales Assistant. Part of the Amarktai Network.</p>
          <p>Amarktai Sales Assistant · South Africa</p>
        </div>
      </footer>
    </div>
  );
}
