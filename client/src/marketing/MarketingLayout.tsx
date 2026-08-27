import { BrandMark } from "@/components/BrandMark";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { accountLinks, marketingNavigation, publicPageMetadata } from "./site";
import "./marketing.css";
import "./marketing-v2.css";
import "./launch-v3.css";

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
    <div className="marketing-site">
      <a className="marketing-skip" href="#main-content">Skip to content</a>
      <header className="marketing-header">
        <div className="marketing-header__inner">
          <Link href="/" className="marketing-brand" aria-label="Amarktai Sales Assistant home">
            <BrandMark large />
          </Link>
          <nav className="marketing-nav" aria-label="Main navigation">
            {marketingNavigation.map(item => (
              <MarketingNavLink key={item.href} {...item} active={location === item.href} />
            ))}
          </nav>
          <div className="marketing-header__actions">
            <Link href={accountLinks.signIn} className="marketing-sign-in">Sign in</Link>
            <Link href={accountLinks.getStarted} className="marketing-button marketing-button--primary marketing-button--compact">
              Start free <ArrowRight size={15} />
            </Link>
            <button
              ref={menuButton}
              type="button"
              className="marketing-menu-button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="mobile-marketing-navigation"
              onClick={() => setMenuOpen(value => !value)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-marketing-navigation" className="marketing-mobile-nav" aria-label="Mobile navigation">
            {marketingNavigation.map(item => (
              <MarketingNavLink key={item.href} {...item} active={location === item.href} />
            ))}
            <div className="marketing-mobile-nav__account">
              <Link href={accountLinks.signIn}>Sign in</Link>
              <Link href={accountLinks.getStarted} className="marketing-button marketing-button--primary">
                Start free <ArrowRight size={16} />
              </Link>
            </div>
          </nav>
        )}
      </header>
      <main id="main-content">{children}</main>
      <MarketingFooter />
    </div>
  );
}

function MarketingNavLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={active ? "is-active" : ""}>
      {label}
    </Link>
  );
}

function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container marketing-footer__grid">
        <div className="marketing-footer__brand">
          <BrandMark large inverse />
          <p>A focused AI sales workspace that works beside the CRM your business already trusts.</p>
        </div>
        <nav aria-label="Product links">
          <h2>Product</h2>
          <Link href="/product">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/integrations">CRM connections</Link>
        </nav>
        <nav aria-label="Company links">
          <h2>Company</h2>
          <Link href="/contact">Contact</Link>
          <Link href={accountLinks.signIn}>Sign in</Link>
          <Link href={accountLinks.getStarted}>Start free</Link>
        </nav>
      </div>
      <div className="marketing-container marketing-footer__base">
        <p>Amarktai Network · Sales Assistant</p>
        <p>© {new Date().getFullYear()} Amarktai Network</p>
      </div>
    </footer>
  );
}
