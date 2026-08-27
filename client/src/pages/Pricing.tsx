import { Check, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { accountLinks } from "@/marketing/site";
import { AI_CREDIT_ECONOMICS, AI_CREDIT_FEATURES, PRICING_PLANS, ZERO_AI_CREDIT_FEATURES } from "@shared/pricing";

function money(cents:number){return `R${(cents/100).toLocaleString("en-ZA")}`}

export default function Pricing(){
  return <MarketingLayout>
    <section className="site-pricing">
      <div className="site-shell">
        <div className="site-pricing__head">
          <div><p className="site-eyebrow">PRICING IN SOUTH AFRICAN RAND</p><h1>Pay for the workspace. Add AI when it earns its keep.</h1></div>
          <p>Subscriptions cover the dependable sales workspace. AI credits are reserved for reasoning-heavy work such as company website understanding, drafting and conversation intelligence instead of being charged for ordinary deterministic CRM operations.</p>
        </div>

        <div className="site-price-table" role="table" aria-label="Amarktai Sales Assistant plans">
          {PRICING_PLANS.map(plan=><div key={plan.key} className={plan.key==="professional"?"site-price-row is-featured":"site-price-row"} role="row">
            <h2>{plan.name}</h2>
            <strong>{money(plan.monthlyZarCents)}{plan.monthlyZarCents? <small style={{fontSize:"12px",fontWeight:700,color:"#758398"}}>/month</small>:null}</strong>
            <span>{plan.includedUsers===1?"1 user":`Up to ${plan.includedUsers} users`}<br/>{plan.includedAiCredits.toLocaleString("en-ZA")} AI credits</span>
            <p>{plan.features.slice(0,3).join(" · ")}</p>
            <Link href={plan.key==="team"?"/contact":accountLinks.getStarted} className={plan.key==="professional"?"site-button site-button--primary":"site-button site-button--secondary"}>{plan.key==="trial"?"Start trial":plan.key==="team"?"Contact sales":"Create workspace"}</Link>
          </div>)}
        </div>

        <div className="site-credit-strip">
          <div><p className="site-eyebrow"><Sparkles size={14}/> AI CREDIT TOP-UPS</p><h2>1,000 AI credits · {money(AI_CREDIT_ECONOMICS.retailPackZarCents)}</h2><p>Top up only when the team needs more model-powered reasoning. Routine CRM sync and deterministic operations should not quietly eat the AI balance.</p></div>
          <div className="site-credit-columns">
            <div><h3>No AI credits</h3>{ZERO_AI_CREDIT_FEATURES.map(item=><p key={item}><Check size={14}/>{item}</p>)}</div>
            <div><h3>Uses AI credits</h3>{AI_CREDIT_FEATURES.map(item=><p key={item}><Sparkles size={14}/>{item}</p>)}</div>
          </div>
        </div>
      </div>
    </section>
  </MarketingLayout>;
}
