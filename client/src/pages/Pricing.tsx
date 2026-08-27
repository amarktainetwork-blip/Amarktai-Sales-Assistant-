import { Sparkles } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { accountLinks } from "@/marketing/site";
import { AI_CREDIT_ECONOMICS, PRICING_PLANS } from "@shared/pricing";

function money(cents: number) {
  return `R${(cents / 100).toLocaleString("en-ZA")}`;
}

export default function Pricing() {
  return (
    <MarketingLayout>
      <section className="amk-pricing">
        <div className="amk-shell">
          <div className="amk-pricing__head">
            <p className="amk-eyebrow">PRICING IN SOUTH AFRICAN RAND</p>
            <h1>Start with the workspace. Use AI where it adds value.</h1>
            <p>Subscriptions cover the core sales workspace. Included AI credits are used for reasoning-heavy work such as website understanding, drafting and conversation intelligence. Routine deterministic CRM operations should not quietly consume the AI balance.</p>
          </div>

          <div className="amk-price-table" role="table" aria-label="Amarktai Network Sales Assistant plans">
            <div className="amk-price-row amk-price-row--head" role="row">
              <span>Plan</span><span>Price</span><span>Included</span><span>Best for</span><span></span>
            </div>
            {PRICING_PLANS.map(plan => (
              <div className="amk-price-row" role="row" key={plan.key}>
                <div className="amk-price-name">
                  <strong>{plan.name}</strong>
                  <span>{plan.features.slice(0, 2).join(" · ")}</span>
                </div>
                <div className="amk-price-value">
                  {money(plan.monthlyZarCents)}{plan.monthlyZarCents ? <small>/mo</small> : null}
                </div>
                <div className="amk-price-meta">
                  {plan.includedUsers === 1 ? "1 user" : `Up to ${plan.includedUsers} users`}<br/>
                  {plan.includedAiCredits.toLocaleString("en-ZA")} AI credits
                </div>
                <div className="amk-price-features">{plan.features.slice(2).join(" · ") || plan.features.join(" · ")}</div>
                <Link href={plan.key === "team" ? "/contact" : accountLinks.getStarted} className={plan.key === "professional" ? "amk-button amk-button--primary" : "amk-button amk-button--secondary"}>
                  {plan.key === "trial" ? "Start trial" : plan.key === "team" ? "Talk to us" : "Get started"}
                </Link>
              </div>
            ))}
          </div>

          <section className="amk-price-credit">
            <div>
              <p className="amk-eyebrow"><Sparkles size={14}/> AI CREDIT TOP-UPS</p>
              <h2>1,000 AI credits · {money(AI_CREDIT_ECONOMICS.retailPackZarCents)}</h2>
            </div>
            <div>
              <p>Top up only when you need more model-powered reasoning. Company website learning, drafting and conversation intelligence use AI credits; deterministic CRM sync and ordinary record operations should not.</p>
              <Link href="/contact" className="amk-text-link">Questions about team pricing?</Link>
            </div>
          </section>
        </div>
      </section>
    </MarketingLayout>
  );
}
