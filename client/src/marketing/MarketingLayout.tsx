import { BrandMark } from "@/components/BrandMark";
import { BrandName } from "@/components/BrandName";
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
          <div className="amk-brand"><BrandMark large /></div>
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
              {marketingNavigation.map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}
              <Link href={accountLinks.signIn}>Sign In</Link>
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start Free</Link>
            </div>
          </nav>
        ) : null}
      </header>

      <main id="main-content">{children}</main>

      <footer className="amk-footer">
        <div className="amk-shell amk-footer__top">
          <div className="amk-footer__brand">
            <BrandMark large inverse />
            <h2>Give your salespeople a better way to work around the CRM they already use.</h2>
            <p><BrandName /> Sales Assistant helps with preparation, customer context, conversations and follow-through — while important actions stay visible and reviewable.</p>
          </div>
          <div className="amk-footer__links">
            <div>
              <span>Product</span>
              <Link href="/how-it-works">How It Works</Link>
              <Link href="/about">Why AmarktAI</Link>
              <Link href="/pricing">Pricing</Link>
            </div>
            <div>
              <span>Get started</span>
              <Link href={accountLinks.getStarted}>Start Free</Link>
              <Link href="/contact">Book a Demo</Link>
              <Link href={accountLinks.signIn}>Sign In</Link>
            </div>
          </div>
        </div>
        <div className="amk-shell amk-footer__base">
          <p>© {new Date().getFullYear()} <BrandName /> Sales Assistant · AmarktAI Network</p>
          <p>Keep your CRM. Make the sales day easier.</p>
        </div>
      </footer>
    </div>
  );
}
