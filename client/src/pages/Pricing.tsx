import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { accountLinks } from "@/marketing/site";
import { PRICING_PLANS } from "@shared/pricing";

function money(cents: number) {
  return `R${(cents / 100).toLocaleString("en-ZA")}`;
}

export default function Pricing() {
  return (
    <MarketingLayout>
      <section className="amk-pricing-hero">
        <div className="amk-shell amk-pricing-hero__inner">
          <p className="amk-eyebrow">SIMPLE PRICING IN SOUTH AFRICAN RAND</p>
          <h1>Choose the workspace that fits the team you have today.</h1>
          <p className="amk-lead">
            Start with one salesperson or bring the team. Your CRM stays the
            system of record, and important actions remain reviewable.
          </p>
        </div>
      </section>

      <section className="amk-pricing-section">
        <div className="amk-shell">
          <div className="amk-pricing-list">
            {PRICING_PLANS.map(plan => {
              const featured = plan.key === "professional";
              const paid = plan.monthlyZarCents > 0;
              return (
                <article
                  className={`amk-pricing-row${featured ? " is-featured" : ""}`}
                  key={plan.key}
                >
                  <div className="amk-pricing-row__name">
                    <span>
                      {featured
                        ? "POPULAR"
                        : plan.key === "trial"
                          ? "START HERE"
                          : "PLAN"}
                    </span>
                    <h2>{plan.name}</h2>
                    <p>
                      {plan.includedUsers === 1
                        ? "1 user"
                        : `Up to ${plan.includedUsers} users`}
                    </p>
                  </div>
                  <div className="amk-pricing-row__price">
                    <strong>{money(plan.monthlyZarCents)}</strong>
                    <span>{paid ? "per month" : "14-day trial"}</span>

                  </div>
                  <ul className="amk-pricing-row__features">
                    {plan.features
                      .filter(feature => !/AI-assisted tasks/i.test(feature))
                      .slice(1, 5)
                      .map(feature => (
                        <li key={feature}>
                          <CheckCircle2 size={16} /> {feature}
                        </li>
                      ))}
                  </ul>
                  <div className="amk-pricing-row__action">
                    <Link
                      href={
                        plan.key === "trial"
                          ? accountLinks.getStarted
                          : "/contact"
                      }
                      className={
                        featured
                          ? "amk-button amk-button--primary"
                          : "amk-button amk-button--secondary"
                      }
                    >
                      {plan.key === "trial"
                        ? "Start free"
                        : plan.key === "team"
                          ? "Talk to us"
                          : `Choose ${plan.name}`}
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>

        </div>
      </section>

      <section className="amk-final-cta amk-final-cta--light">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow">NEED HELP CHOOSING?</p>
            <h2>Tell us your team size and the CRM you already use.</h2>
            <p>We will help you choose the simplest starting point.</p>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--primary">
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
