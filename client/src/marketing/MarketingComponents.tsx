import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, CircleCheck } from "lucide-react";
import { Link } from "wouter";
import { accountLinks } from "./site";

export function PageHero({
  eyebrow,
  title,
  copy,
  primary = "Get Started",
  primaryHref = accountLinks.getStarted,
  secondary,
  secondaryHref,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  copy: string;
  primary?: string;
  primaryHref?: string;
  secondary?: string;
  secondaryHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="marketing-page-hero">
      <div className="marketing-container marketing-page-hero__grid">
        <div className="marketing-page-hero__copy marketing-reveal">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1>{title}</h1>
          <p>{copy}</p>
          <div className="marketing-actions">
            <Link
              href={primaryHref}
              className="marketing-button marketing-button--primary"
            >
              {primary}
              <ArrowRight size={17} />
            </Link>
            {secondary && secondaryHref && (
              <Link
                href={secondaryHref}
                className="marketing-button marketing-button--secondary"
              >
                {secondary}
              </Link>
            )}
          </div>
        </div>
        {children && (
          <div className="marketing-page-hero__visual marketing-reveal marketing-reveal--delay">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="marketing-eyebrow">
      <span />
      {children}
    </p>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  copy,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={`marketing-section-header marketing-section-header--${align}`}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2>{title}</h2>
      {copy && <p>{copy}</p>}
    </div>
  );
}

export function FeatureCard({
  icon: Icon,
  title,
  copy,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  copy: string;
  detail?: string;
}) {
  return (
    <article className="marketing-card">
      <span className="marketing-icon">
        <Icon size={21} />
      </span>
      {detail && <p className="marketing-card__detail">{detail}</p>}
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

export function NumberedCard({
  number,
  title,
  copy,
}: {
  number: string;
  title: string;
  copy: string;
}) {
  return (
    <article className="marketing-step-card">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </article>
  );
}

export function TickList({ items }: { items: readonly string[] }) {
  return (
    <ul className="marketing-tick-list">
      {items.map(item => (
        <li key={item}>
          <span>
            <Check size={14} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function CTASection({
  eyebrow = "Ready when you are",
  title,
  copy,
  primary = "Get Started",
  primaryHref = accountLinks.getStarted,
  secondary = "Contact Us",
  secondaryHref = "/contact",
}: {
  eyebrow?: string;
  title: string;
  copy: string;
  primary?: string;
  primaryHref?: string;
  secondary?: string;
  secondaryHref?: string;
}) {
  return (
    <section className="marketing-cta">
      <div className="marketing-container marketing-cta__inner">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
        <div className="marketing-actions">
          <Link
            href={primaryHref}
            className="marketing-button marketing-button--light"
          >
            {primary}
            <ArrowRight size={17} />
          </Link>
          <Link
            href={secondaryHref}
            className="marketing-button marketing-button--ghost"
          >
            {secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function BrowserWindow({
  children,
  label = "Amarktai · Today",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div
      className="marketing-browser-window"
      aria-label={`${label} product preview`}
    >
      <div className="marketing-browser-window__bar">
        <span />
        <span />
        <span />
        <p>{label}</p>
      </div>
      <div className="marketing-browser-window__body">{children}</div>
    </div>
  );
}

export function MiniStatus({
  label,
  copy,
  active = false,
}: {
  label: string;
  copy: string;
  active?: boolean;
}) {
  return (
    <div className={`marketing-mini-status ${active ? "is-active" : ""}`}>
      <CircleCheck size={17} />
      <div>
        <strong>{label}</strong>
        <small>{copy}</small>
      </div>
    </div>
  );
}
