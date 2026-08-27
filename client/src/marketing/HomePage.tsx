import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";
import { PRICING_PLANS } from "@shared/pricing";

const flow = [
  ["01", "Know the business", "Amarktai reads approved company information and turns it into usable sales context."],
  ["02", "Know the customer", "CRM history, open work and the next commitment stay in the same view."],
  ["03", "Help with the work", "Prepare the call, draft the follow-up and create the next CRM action in plain language."],
  ["04", "Verify the result", "Amarktai reads the CRM back before it tells you the work is complete."],
] as const;

const outcomes = [
  ["Less admin", "Salespeople spend less of the day navigating CRM screens and rebuilding context."],
  ["Better follow-through", "Callbacks, next steps and promises stay visible until they are actually closed out."],
  ["A cleaner CRM", "AI-assisted work still ends in the system of record, with verification where it matters."],
] as const;

function WorkspacePreview() {
  return (
    <div className="launch-workspace" aria-label="Amarktai Sales Assistant workspace preview">
      <div className="launch-workspace__bar">
        <div className="launch-workspace__dots" aria-hidden="true"><i/><i/><i/></div>
        <span>Today</span>
        <small><i/> CRM connected</small>
      </div>
      <div className="launch-workspace__body">
        <aside className="launch-workspace__rail" aria-hidden="true">
          <b>ai</b><span>T</span><span>C</span><span>A</span><span>R</span>
        </aside>
        <section className="launch-workspace__day">
          <div className="launch-workspace__heading">
            <div><small>THURSDAY</small><h3>What needs attention</h3></div>
            <span>3 priorities</span>
          </div>
          <article className="launch-task launch-task--active">
            <div className="launch-task__index">01</div>
            <div><small>NEXT CUSTOMER</small><strong>Prepare the next conversation</strong><p>History, open tasks and talking points ready.</p></div>
            <ChevronRight size={17}/>
          </article>
          <article className="launch-task">
            <div className="launch-task__index">02</div>
            <div><small>FOLLOW-UP</small><strong>Review yesterday’s commitment</strong><p>Draft ready. CRM update still pending review.</p></div>
            <ChevronRight size={17}/>
          </article>
          <article className="launch-task">
            <div className="launch-task__index">03</div>
            <div><small>PIPELINE</small><strong>Two opportunities have no next step</strong><p>Open the records and decide what happens next.</p></div>
            <ChevronRight size={17}/>
          </article>
        </section>
        <section className="launch-workspace__assistant">
          <div className="launch-workspace__heading">
            <div><small>ASSISTANT</small><h3>Ask naturally</h3></div>
            <MessageSquareText size={18}/>
          </div>
          <div className="launch-chat launch-chat--user">Who should I call first?</div>
          <div className="launch-chat launch-chat--ai">
            <span>ai</span>
            <p>Start with the customer whose callback is due this morning. I have their history and the last commitment ready.</p>
          </div>
          <div className="launch-assistant-action"><span><Sparkles size={15}/> Prepare the call</span><ArrowRight size={16}/></div>
          <p className="launch-assistant-note"><ShieldCheck size={14}/> Uses approved company context and live CRM data.</p>
        </section>
      </div>
    </div>
  );
}

export default function HomePage() {
  const paid = PRICING_PLANS.filter(plan => plan.key !== "trial");
  return (
    <MarketingLayout>
      <section className="launch-hero">
        <div className="launch-container launch-hero__grid">
          <div className="launch-hero__copy">
            <p className="launch-eyebrow">AMARKTAI SALES ASSISTANT</p>
            <h1>Sell more.<br/><span>Admin less.</span></h1>
            <p className="launch-lead">
              One focused workspace beside the CRM your team already uses. Amarktai helps salespeople decide what matters, prepare every conversation and finish the follow-through without losing the customer record.
            </p>
            <div className="launch-actions">
              <Link href={accountLinks.getStarted} className="launch-button launch-button--primary">Start your workspace <ArrowRight size={17}/></Link>
              <Link href="/product" className="launch-button launch-button--quiet">See the product <ChevronRight size={17}/></Link>
            </div>
            <div className="launch-trustline">
              <span><Check size={14}/> Keep your CRM</span>
              <span><Check size={14}/> Individual user logins</span>
              <span><Check size={14}/> Review-first actions</span>
            </div>
          </div>
          <div className="launch-hero__product"><WorkspacePreview/></div>
        </div>
      </section>

      <section className="launch-proofbar">
        <div className="launch-container launch-proofbar__inner">
          <span>Works with the sales system you already have</span>
          <div><b>Genie</b><i/><b>HubSpot</b><i/><b>Salesforce</b><i/><b>Pipedrive</b><i/><b>Zoho</b><i/><b>Browser CRM</b></div>
        </div>
      </section>

      <section className="launch-section">
        <div className="launch-container">
          <div className="launch-section__head">
            <p className="launch-eyebrow">ONE OPERATING LOOP</p>
            <h2>The sales day should feel this simple.</h2>
            <p>Amarktai handles the context around selling. Your team still owns the judgement, the conversation and the customer relationship.</p>
          </div>
          <div className="launch-flow">
            {flow.map(([number, title, copy]) => (
              <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="launch-section launch-section--dark">
        <div className="launch-container launch-two-col">
          <div>
            <p className="launch-eyebrow launch-eyebrow--dark">YOUR CRM STAYS THE SOURCE OF TRUTH</p>
            <h2>AI beside the record.<br/>Not instead of it.</h2>
            <p className="launch-dark-copy">Amarktai can understand the customer, prepare work and help execute it, while the actual contact, task and opportunity remain in the CRM your business relies on.</p>
            <div className="launch-dark-points">
              <span><CircleCheck size={17}/> Live CRM context where available</span>
              <span><CircleCheck size={17}/> Personal credentials for each user</span>
              <span><CircleCheck size={17}/> Deterministic readback after important writes</span>
            </div>
          </div>
          <div className="launch-crm-visual" aria-hidden="true">
            <div className="launch-crm-card launch-crm-card--record"><small>CRM RECORD</small><strong>Customer profile</strong><i/><i/><i/><div><span>Open opportunity</span><b>Active</b></div></div>
            <div className="launch-crm-link"><span>context</span><ArrowRight size={18}/><span>verified result</span></div>
            <div className="launch-crm-card launch-crm-card--ai"><small>AMARKTAI</small><strong>Prepare the next move</strong><p>“Summarise the account and draft the follow-up we agreed.”</p><div><Sparkles size={15}/> Ready for review</div></div>
          </div>
        </div>
      </section>

      <section className="launch-section launch-section--soft">
        <div className="launch-container">
          <div className="launch-section__head launch-section__head--wide">
            <p className="launch-eyebrow">WHAT CHANGES</p>
            <h2>More time with customers.<br/>Less work about the work.</h2>
          </div>
          <div className="launch-outcomes">
            {outcomes.map(([title, copy], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </div>
      </section>

      <section className="launch-section">
        <div className="launch-container launch-team-grid">
          <div>
            <p className="launch-eyebrow">ONE COMPANY. PERSONAL WORKSPACES.</p>
            <h2>Shared knowledge without shared logins.</h2>
          </div>
          <div className="launch-team-copy">
            <p>The company sets up approved business knowledge, policies and the CRM definition once. Every salesperson still gets their own Amarktai login, private Assistant context and personal CRM identity/credentials.</p>
            <div className="launch-team-list">
              <span><LockKeyhole size={17}/><b>Private to the user</b> Assistant conversations, working notes, personal CRM login and individual context.</span>
              <span><ShieldCheck size={17}/><b>Shared by the company</b> Approved product knowledge, policies, CRM capability and team operating rules.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="launch-section launch-section--pricing">
        <div className="launch-container">
          <div className="launch-pricing-head">
            <div><p className="launch-eyebrow">PRICING IN SOUTH AFRICAN RAND</p><h2>Start small. Add AI when it earns its keep.</h2></div>
            <Link href="/pricing" className="launch-text-link">Full pricing <ArrowRight size={16}/></Link>
          </div>
          <div className="launch-pricing-preview">
            {paid.map(plan => (
              <article key={plan.key} className={plan.key === "professional" ? "is-featured" : ""}>
                <div><small>{plan.name}</small><strong>R{(plan.monthlyZarCents / 100).toLocaleString("en-ZA")}</strong><span>/month</span></div>
                <p>{plan.includedUsers === 1 ? "1 user" : `Up to ${plan.includedUsers} users`} · {plan.includedAiCredits.toLocaleString("en-ZA")} AI credits</p>
              </article>
            ))}
          </div>
          <p className="launch-credit-note">Extra AI credit packs: <strong>1,000 credits for R599</strong>. Routine CRM sync, deterministic reads/writes, prioritisation and audit evidence do not consume AI credits.</p>
        </div>
      </section>

      <section className="launch-final">
        <div className="launch-container launch-final__inner">
          <div><p className="launch-eyebrow launch-eyebrow--dark">READY WHEN YOUR TEAM IS</p><h2>Keep the CRM.<br/>Change the sales day.</h2></div>
          <div><p>Set up the business once, give every salesperson their own workspace, and let Amarktai take care of the admin around the sale.</p><Link href={accountLinks.getStarted} className="launch-button launch-button--light">Start your workspace <ArrowRight size={17}/></Link></div>
        </div>
      </section>
    </MarketingLayout>
  );
}
