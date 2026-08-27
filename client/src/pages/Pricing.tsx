import { Check, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { accountLinks } from "@/marketing/site";
import {
  AI_CREDIT_ECONOMICS,
  AI_CREDIT_FEATURES,
  PRICING_PLANS,
  ZERO_AI_CREDIT_FEATURES,
} from "@shared/pricing";

function money(cents: number) {
  return `R${(cents / 100).toLocaleString("en-ZA")}`;
}

export default function Pricing() {
  return (
    <MarketingLayout>
      <section className="launch-pricing-page">
        <div className="launch-container">
          <div className="launch-pricing-page__head">
            <p className="launch-eyebrow">PRICING IN SOUTH AFRICAN RAND</p>
            <h1>Simple plans.<br/><span>AI when you need it.</span></h1>
            <p>Subscriptions cover the dependable sales workspace. AI credits are used for reasoning-heavy work such as website understanding, message drafting and conversation intelligence.</p>
          </div>

          <div className="launch-plan-grid">
            {PRICING_PLANS.map(plan => (
              <article key={plan.key} className={plan.key === "professional" ? "launch-plan is-featured" : "launch-plan"}>
                <div className="launch-plan__top">
                  <div>
                    <small>{plan.key === "professional" ? "MOST POPULAR" : plan.key === "trial" ? "TRY IT" : "MONTHLY"}</small>
                    <h2>{plan.name}</h2>
                  </div>
                  {plan.key === "professional" && <span>Best value</span>}
                </div>
                <div className="launch-plan__price">
                  <strong>{money(plan.monthlyZarCents)}</strong><span>{plan.monthlyZarCents === 0 ? "" : "/month"}</span>
                </div>
                <p className="launch-plan__summary">
                  {plan.includedUsers === 1 ? "1 user" : `Up to ${plan.includedUsers} users`} · {plan.includedAiCredits.toLocaleString("en-ZA")} AI credits
                </p>
                <ul>
                  {plan.features.map(feature => <li key={feature}><Check size={15}/>{feature}</li>)}
                </ul>
                <Link href={plan.key === "team" ? "/contact" : accountLinks.getStarted} className={plan.key === "professional" ? "launch-button launch-button--primary" : "launch-button launch-button--quiet"}>
                  {plan.key === "trial" ? "Start trial" : plan.key === "team" ? "Contact sales" : "Create workspace"}
                </Link>
              </article>
            ))}
          </div>

          <section className="launch-credit-panel">
            <div>
              <span className="launch-credit-icon"><Sparkles size={18}/></span>
              <div><p className="launch-eyebrow">AI CREDIT TOP-UPS</p><h2>1,000 AI credits · {money(AI_CREDIT_ECONOMICS.retailPackZarCents)}</h2><p>Top up only when the team needs more AI reasoning. Unused subscription capability does not create hidden token charges.</p></div>
            </div>
            <div className="launch-credit-columns">
              <section><h3>No AI credits</h3>{ZERO_AI_CREDIT_FEATURES.map(item => <p key={item}><Check size={14}/>{item}</p>)}</section>
              <section><h3>Uses AI credits</h3>{AI_CREDIT_FEATURES.map(item => <p key={item}><Sparkles size={14}/>{item}</p>)}</section>
            </div>
          </section>
        </div>
      </section>
    </MarketingLayout>
  );
}
