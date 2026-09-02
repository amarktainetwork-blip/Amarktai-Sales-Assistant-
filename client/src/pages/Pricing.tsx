import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { accountLinks } from "@/marketing/site";
import { AI_CREDIT_ECONOMICS, PRICING_PLANS } from "@shared/pricing";

function money(cents: number) {
  return `R${(cents / 100).toLocaleString("en-ZA")}`;
}

export default function Pricing() {
  return (
    <MarketingLayout>
      <section className="amk-pricing-hero">
        <div className="amk-shell amk-pricing-hero__inner">
          <p className="amk-eyebrow">SIMPLE PRICING IN SOUTH AFRICAN RAND</p>
          <h1>Start small. Add more intelligence when your sales team needs it.</h1>
          <p className="amk-lead">The subscription pays for the Sales Assistant workspace. Included AI credits cover the intelligence-heavy work. Normal CRM syncing, reminders and ordinary record handling are designed not to quietly burn through your AI balance.</p>
        </div>
      </section>

      <section className="amk-pricing-section">
        <div className="amk-shell">
          <div className="amk-plan-grid">
            {PRICING_PLANS.map(plan => {
              const featured = plan.key === "professional";
              return (
                <article className={`amk-plan-card${featured ? " is-featured" : ""}`} key={plan.key}>
                  {featured ? <div className="amk-plan-card__badge">Most popular</div> : null}
                  <div className="amk-plan-card__top">
                    <div>
                      <h2>{plan.name}</h2>
                      <p>{plan.features[0] ?? "AmarktAI Sales Assistant workspace"}</p>
                    </div>
                    <div className="amk-plan-card__price">
                      <strong>{money(plan.monthlyZarCents)}</strong>
                      {plan.monthlyZarCents ? <span>/month</span> : <span>to start</span>}
                    </div>
                  </div>
                  <div className="amk-plan-card__meta">
                    <span>{plan.includedUsers === 1 ? "1 user" : `Up to ${plan.includedUsers} users`}</span>
                    <span>{plan.includedAiCredits.toLocaleString("en-ZA")} AI credits included</span>
                  </div>
                  <ul className="amk-plan-card__features">
                    {plan.features.map(feature => <li key={feature}><CheckCircle2 size={17} /> {feature}</li>)}
                  </ul>
                  <Link href={plan.key === "team" ? "/contact" : accountLinks.getStarted} className={featured ? "amk-button amk-button--primary amk-plan-card__cta" : "amk-button amk-button--secondary amk-plan-card__cta"}>
                    {plan.key === "trial" ? "Start free" : plan.key === "team" ? "Talk to us" : "Get started"} <ArrowRight size={16} />
                  </Link>
                </article>
              );
            })}
          </div>

          <section className="amk-credit-panel">
            <div>
              <p className="amk-eyebrow"><Sparkles size={14} /> OPTIONAL AI CREDIT TOP-UPS</p>
              <h2>1,000 AI credits · {money(AI_CREDIT_ECONOMICS.retailPackZarCents)}</h2>
              <p>Top up only when your team needs more AI-powered analysis, drafting, conversation help or deeper company learning.</p>
            </div>
            <div className="amk-credit-panel__notes">
              <div><CheckCircle2 size={18} /><span><strong>Core sales workflow stays usable</strong><small>Ordinary CRM syncing, reminders, standard reporting and approved record handling are not meant to charge an AI credit every time.</small></span></div>
              <div><CheckCircle2 size={18} /><span><strong>Intelligence use stays visible</strong><small><BrandName /> is designed so expensive AI work is separate from normal workflow activity.</small></span></div>
            </div>
          </section>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">NOT SURE WHICH PLAN FITS?</p>
            <h2>Tell us your team size and CRM.</h2>
            <p>We will help you choose the simplest starting point without overselling you.</p>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">Talk to us</Link>
            <Link href={accountLinks.getStarted} className="amk-button amk-button--outline-light">Start free</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
