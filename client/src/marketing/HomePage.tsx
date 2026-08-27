import { ArrowRight, Check, Headphones, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const capabilities = [
  ["Learns your business", "Amarktai reads approved website and company information, then turns it into grounded sales context."],
  ["Works beside your CRM", "Customer history, tasks, opportunities and next steps stay anchored to the CRM you already use."],
  ["Prepares the conversation", "Ask who to call, what changed, what matters and how to approach the next conversation."],
  ["Assists on the call", "Live transcription, context and prompts help the salesperson stay present instead of searching through systems."],
  ["Finishes the follow-through", "Draft the note, create the callback, update the opportunity and keep the next commitment visible."],
  ["Checks its own work", "Important CRM actions are read back before Amarktai tells the user that the work is complete."],
] as const;

const operatingFlow = [
  ["01", "Set up the business", "The company approves its identity, offering, policies and knowledge once."],
  ["02", "Connect the salesperson", "Each user has their own Amarktai login and their own CRM identity and credentials."],
  ["03", "Work from one sales day", "Amarktai surfaces the customers, calls and commitments that need attention now."],
  ["04", "Keep the CRM true", "Actions end back in the system of record with review, audit evidence and readback."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="handover-hero">
        <div className="handover-shell handover-hero__grid">
          <div className="handover-hero__copy">
            <p className="handover-kicker"><Sparkles size={15}/> AI sales workspace for real sales teams</p>
            <h1>Your salesperson.<br/><span>With an AI operator beside them.</span></h1>
            <p className="handover-lead">
              Amarktai learns the business, connects to the CRM and helps each salesperson decide what matters, prepare better conversations, work through calls and complete the follow-through without losing the customer record.
            </p>
            <div className="handover-actions">
              <Link href={accountLinks.getStarted} className="handover-button handover-button--primary">Start with Amarktai <ArrowRight size={17}/></Link>
              <Link href="/product" className="handover-link">See how it works <ArrowRight size={16}/></Link>
            </div>
            <div className="handover-proof">
              <span><Check size={15}/> Keep your CRM</span>
              <span><Check size={15}/> Personal user logins</span>
              <span><Check size={15}/> Review and readback</span>
            </div>
          </div>
          <figure className="handover-hero__visual">
            <img src="/images/sales-ai-hero.webp" alt="AI-assisted salesperson working with Amarktai during the sales day" />
            <figcaption>AI assistance around the salesperson — not another CRM to maintain.</figcaption>
          </figure>
        </div>
      </section>

      <section className="handover-statement">
        <div className="handover-shell">
          <p>Learn the business <span>→</span> understand the customer <span>→</span> help with the conversation <span>→</span> execute the next step <span>→</span> verify the CRM</p>
        </div>
      </section>

      <section className="handover-section handover-section--intro">
        <div className="handover-shell handover-intro">
          <div className="handover-intro__title">
            <p className="handover-kicker">WHAT WE ACTUALLY BUILT</p>
            <h2>A sales operating layer around the CRM.</h2>
          </div>
          <div className="handover-intro__copy">
            <p>Most sales teams already have a CRM. The problem is the work around it: finding context, deciding who needs attention, preparing calls, remembering commitments and keeping records current.</p>
            <p>Amarktai sits beside that CRM and turns those disconnected jobs into one guided sales day. The CRM remains the source of truth; the salesperson remains responsible for the customer relationship.</p>
          </div>
        </div>
      </section>

      <section className="handover-visual-section">
        <div className="handover-shell handover-visual-grid">
          <div className="handover-visual-copy">
            <p className="handover-kicker"><Headphones size={15}/> ON THE CALL</p>
            <h2>Less screen-hunting.<br/>More listening.</h2>
            <p>Before a call, Amarktai can pull together the account history, open work and talking points. During the conversation it can transcribe, surface relevant context and help capture the next commitment.</p>
            <ul>
              <li><Check size={15}/> Pre-call context and talking points</li>
              <li><Check size={15}/> Live transcription and useful prompts</li>
              <li><Check size={15}/> Call closeout, notes and next actions</li>
            </ul>
          </div>
          <img className="handover-call-image" src="/images/call-assistant.webp" alt="Amarktai live call assistant visual" />
        </div>
      </section>

      <section className="handover-section">
        <div className="handover-shell">
          <div className="handover-section__heading">
            <p className="handover-kicker">ONE PRODUCT, NOT A MAZE OF TOOLS</p>
            <h2>Everything around the sale, in one working rhythm.</h2>
          </div>
          <div className="handover-lines">
            {capabilities.map(([title, copy], index) => (
              <div className="handover-line" key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="handover-flow-section">
        <div className="handover-shell">
          <div className="handover-flow__heading">
            <p className="handover-kicker">FROM FIRST LOGIN TO LIVE SALES WORK</p>
            <h2>Company knowledge is shared.<br/>The salesperson stays personal.</h2>
            <p>Teams should not share passwords or private assistant conversations. Amarktai separates company setup from each person’s own workspace and CRM identity.</p>
          </div>
          <div className="handover-flow">
            {operatingFlow.map(([number, title, copy]) => (
              <div key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="handover-crm">
        <div className="handover-shell handover-crm__grid">
          <div>
            <p className="handover-kicker"><ShieldCheck size={15}/> CRM FIRST</p>
            <h2>Your CRM remains the record.</h2>
          </div>
          <div>
            <p>Amarktai can prepare and execute work, but important updates do not disappear into an AI chat. Contacts, tasks, opportunities and commitments remain in the connected CRM, with verification where it matters.</p>
            <p className="handover-crm__systems">Genie · HubSpot · Salesforce · Pipedrive · Zoho · authorised browser CRMs</p>
          </div>
        </div>
      </section>

      <section className="handover-price">
        <div className="handover-shell handover-price__inner">
          <div>
            <p className="handover-kicker">SOUTH AFRICAN RAND PRICING</p>
            <h2>Start at R499/month.</h2>
            <p>Individual and team plans include AI credits. Extra AI usage is topped up separately, while routine CRM work does not burn AI credits unnecessarily.</p>
          </div>
          <Link href="/pricing" className="handover-button handover-button--secondary">See pricing in ZAR <ArrowRight size={17}/></Link>
        </div>
      </section>

      <section className="handover-final">
        <div className="handover-shell handover-final__inner">
          <div>
            <p className="handover-kicker">AMARKTAI NETWORK · SALES ASSISTANT</p>
            <h2>Give the team back the sales day.</h2>
          </div>
          <div>
            <p>One company setup. Personal workspaces. The CRM you already trust. AI where it genuinely helps.</p>
            <Link href={accountLinks.getStarted} className="handover-button handover-button--light">Get started <ArrowRight size={17}/></Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
