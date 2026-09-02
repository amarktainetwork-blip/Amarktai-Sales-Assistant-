import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingVisual } from "./MarketingVisual";
import { accountLinks } from "./site";

const setup = [
  [
    "01",
    "Create your own workspace",
    "Each salesperson signs in with their own account. Team members can share approved company knowledge without sharing one Assistant identity or one set of CRM credentials.",
  ],
  [
    "02",
    "Teach the Assistant the business",
    "Provide the authorised company website and basic business details. Useful sales knowledge is organised for manager review before the team relies on it.",
  ],
  [
    "03",
    "Connect the CRM you already use",
    "The CRM remains the customer record. Supported connections bring the useful customer context into the salesperson's workspace without turning the Assistant into a replacement CRM.",
  ],
  [
    "04",
    "Connect your own communication tools",
    "The salesperson connects the mailbox, calendar and commissioned communication channels they actually use. Actions are routed through the user's real connection, not a shared generic account.",
  ],
  [
    "05",
    "Start review-first",
    "The Assistant can prepare useful next actions, but important customer-facing changes start in Review so the salesperson can see exactly what will happen before it happens.",
  ],
] as const;

const dailyFlow = [
  [
    "01",
    "Know what needs attention",
    "See overdue work, callbacks, active opportunities and customers that need a response without searching the CRM screen by screen.",
  ],
  [
    "02",
    "Open the customer story",
    "Bring the current task, opportunity, notes, recent activity and relevant company context together before the conversation starts.",
  ],
  [
    "03",
    "Prepare and handle the conversation",
    "Ask the Assistant for a brief, talking points or objection help. On a consented call, transcription and live assistance can stay with the conversation.",
  ],
  [
    "04",
    "Confirm what happened",
    "The salesperson confirms the real outcome instead of letting the system guess whether the customer answered, what was agreed or which next step is correct.",
  ],
  [
    "05",
    "Finish the follow-through",
    "Prepare the note, callback, message, task or CRM change. Important actions are reviewed, executed through the right connection and checked afterwards where readback is available.",
  ],
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">HOW IT WORKS</p>
            <h1>Keep your CRM. Make the work around it easier.</h1>
            <p>
              <BrandName /> is a sales assistant, not a replacement CRM. It learns the business, works with the customer's existing CRM context, helps through sales conversations and carries the confirmed outcome into follow-through.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">
                Start free <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="amk-text-link">
                Talk to us <ArrowRight size={16} />
              </Link>
            </div>
          </div>
          <MarketingVisual variant="hero" />
        </div>
      </section>

      <section className="amk-page-section" id="setup">
        <div className="amk-shell">
          <div className="amk-page-section__grid">
            <div>
              <p className="amk-eyebrow">SETUP</p>
              <h2>Five steps to a working sales assistant.</h2>
            </div>
            <div className="amk-page-section__copy">
              <p>You do not start by migrating the CRM or rebuilding the sales process. Start with the business context, the salesperson's own access and the systems the team already uses.</p>
            </div>
          </div>
          <div className="amk-page-lines">
            {setup.map(([number, title, copy]) => (
              <div className="amk-page-line" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-page-section amk-page-section--soft">
        <div className="amk-shell amk-story__grid">
          <MarketingVisual variant="knowledge" />
          <div className="amk-story__copy">
            <p className="amk-eyebrow">SHARED COMPANY CONTEXT</p>
            <h2>The team should work from the same trusted business facts.</h2>
            <p>Products, services, customer fit, credentials and useful policies can be reviewed once and shared across the sales team.</p>
            <p>Each salesperson still keeps their own login, customer work, CRM identity and personal Assistant context.</p>
          </div>
        </div>
      </section>

      <section className="amk-page-section">
        <div className="amk-shell">
          <div className="amk-page-section__grid">
            <div>
              <p className="amk-eyebrow">THE SALES DAY</p>
              <h2>From “what needs attention?” to a completed next step.</h2>
            </div>
            <div className="amk-page-section__copy">
              <p>The useful intelligence appears where the salesperson is working rather than as a long menu of disconnected AI tools.</p>
            </div>
          </div>
          <div className="amk-page-lines">
            {dailyFlow.map(([number, title, copy]) => (
              <div className="amk-page-line" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-page-section amk-page-section--warm">
        <div className="amk-shell amk-story__grid amk-story__grid--reverse">
          <div className="amk-story__copy">
            <p className="amk-eyebrow">BEFORE, DURING AND AFTER THE CALL</p>
            <h2>The customer story stays with the salesperson.</h2>
            <p>Prepare with the current CRM context and approved business knowledge. During a consented call, use transcription and timely help. Afterwards, confirm the outcome and prepare the exact next action.</p>
            <p>That is the loop the product is built to close: better preparation, a better conversation and better follow-through.</p>
          </div>
          <MarketingVisual variant="call" />
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div>
            <p className="amk-eyebrow">YOUR CRM STAYS YOUR CRM</p>
            <h2>Add the working assistant your salespeople actually feel every day.</h2>
          </div>
          <div>
            <p>Tell us which CRM you use and whether you are setting up one salesperson or a team. We will show you where the Assistant fits.</p>
            <div className="amk-actions">
              <Link href="/contact" className="amk-button amk-button--light">Talk to us</Link>
              <Link href={accountLinks.getStarted} className="amk-text-link amk-text-link--light">Start free <ArrowRight size={16}/></Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

export function ProductPage() {
  return <HowItWorksPage />;
}
export function IndividualsPage() {
  return <HowItWorksPage />;
}
export function TeamsPage() {
  return <HowItWorksPage />;
}
export function IntegrationsPage() {
  return <HowItWorksPage />;
}
