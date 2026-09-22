import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { MarketingArtwork } from "@/marketing/MarketingArtwork";
import { accountLinks } from "@/marketing/site";
import { PRICING_PLANS } from "@shared/pricing";

function money(cents: number) {
  return `R${(cents / 100).toLocaleString("en-ZA")}`;
}

export default function Pricing() {
  return (
    <MarketingLayout>
      <section className="amk-pricing-hero amk-swirl amk-swirl--warm">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">SIMPLE PRICING IN SOUTH AFRICAN RAND</p>
            <h1>Start small. Prove the time saved. Scale when you are ready.</h1>
            <p className="amk-lead">
              Start with one salesperson or bring the team. <BrandName /> works
              around the CRM you already use, so adoption does not begin with a
              costly system replacement.
            </p>
          </div>
          <MarketingArtwork variant="pricing" compact />
        </div>
      </section>

      <section className="amk-pricing-section amk-swirl amk-swirl--blue">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">CHOOSE THE STARTING POINT</p>
              <h2>Pay for the workspace. Prove the workflow.</h2>
            </div>
            <p>
              Start with the smallest workspace that fits. Prove the saved time,
              the learned workflow and the sales experience first, then expand
              only when the team is ready.
            </p>
          </div>

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
                      .slice(0, 5)
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

      <section className="amk-final-cta amk-swirl amk-swirl--violet">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow">NOT SURE WHERE TO START?</p>
            <h2>Show us the team, the CRM and one process that wastes time.</h2>
            <p>We will help you choose the smallest useful starting point.</p>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">
              Talk to us
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
