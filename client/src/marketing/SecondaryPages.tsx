import { ArrowRight, CheckCircle2, Link2, MessagesSquare, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { marketingImagery } from "./imagery";
import { accountLinks } from "./site";

const setupSteps = [
  ["01", "Create your workspace", "Every salesperson gets their own login, personal Assistant context and their own commissioned connections."],
  ["02", "Teach the business once", "Provide approved company information so the team can work from the same products, services, customer fit, credentials and policies."],
  ["03", "Connect the CRM", "Keep the CRM as the customer record and bring the useful context into the salesperson's working view."],
  ["04", "Connect email and communication tools", "Use the salesperson's own mailbox, calendar and commissioned channels instead of a shared generic account."],
  ["05", "Start review-first", "Important actions appear in Review so the salesperson can see what will happen before it happens."],
] as const;

const dailyFlow = [
  {
    icon: Sparkles,
    title: "Before the conversation",
    copy: "See the customer story, current task, opportunity and useful company context together. Ask for a brief, talking points or objection help.",
  },
  {
    icon: MessagesSquare,
    title: "During the conversation",
    copy: "On a consented call, use transcription and timely assistance while the salesperson stays focused on the customer rather than the software.",
  },
  {
    icon: CheckCircle2,
    title: "After the conversation",
    copy: "Confirm the real outcome, prepare the next action, review anything important and complete the follow-through through the right connection.",
  },
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero amk-page-hero--photo">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">HOW IT WORKS</p>
            <h1>Keep your CRM. Make the sales work around it easier.</h1>
            <p className="amk-lead">
              <BrandName /> brings business knowledge, customer context, conversation help and follow-through into one personal sales workspace — without asking you to replace the CRM your team already uses.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start free <ArrowRight size={16} /></Link>
              <Link href="/contact" className="amk-button amk-button--ghost">Book a demo</Link>
            </div>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--page">
            <img src={marketingImagery.hero.src} alt={marketingImagery.hero.alt} />
          </figure>
        </div>
      </section>

      <section className="amk-section amk-section--white">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">SETUP WITHOUT STARTING OVER</p>
              <h2>Five steps from sign-in to a working sales assistant.</h2>
            </div>
            <p>You do not start with a CRM migration. You start with the business knowledge, the salesperson's own access and the systems the team already uses.</p>
          </div>
          <div className="amk-step-list">
            {setupSteps.map(([number, title, copy]) => (
              <article className="amk-step-row" key={number}>
                <span className="amk-step-row__number">{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--ice">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img src={marketingImagery.team.src} alt={marketingImagery.team.alt} loading="lazy" />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">SHARED COMPANY KNOWLEDGE</p>
            <h2>Give the team the same trusted business context without sharing one identity.</h2>
            <p>Managers can review company knowledge once. Salespeople then work from the same approved products, services, customer-fit information, credentials and policies.</p>
            <ul className="amk-check-list">
              <li><CheckCircle2 size={18} /> Shared business knowledge</li>
              <li><CheckCircle2 size={18} /> Personal salesperson login</li>
              <li><CheckCircle2 size={18} /> Personal CRM and mailbox connections</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE DAILY SALES LOOP</p>
            <h2>Useful help before, during and after the customer conversation.</h2>
            <p>The Assistant is built around the workday, not around a catalogue of disconnected AI features.</p>
          </div>
          <div className="amk-benefit-grid">
            {dailyFlow.map(({ icon: Icon, title, copy }) => (
              <article className="amk-benefit-card" key={title}>
                <span className="amk-icon-tile"><Icon size={21} /></span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--warm">
        <div className="amk-shell amk-split amk-split--reverse">
          <div className="amk-split__copy">
            <p className="amk-eyebrow">THE CRM STAYS THE CRM</p>
            <h2>The customer record remains where your business already keeps it.</h2>
            <p><BrandName /> works around that record as the salesperson's assistant. It does not ask the team to copy every customer into another database just to get useful help.</p>
            <div className="amk-feature-points">
              <div><Link2 size={19} /><span><strong>Connection by connection</strong><small>CRM compatibility is commissioned and proven for the systems your team uses.</small></span></div>
              <div><ShieldCheck size={19} /><span><strong>Review important actions</strong><small>Customer-facing or destructive changes stay visible before execution.</small></span></div>
            </div>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--story">
            <img src={marketingImagery.customerCall.src} alt={marketingImagery.customerCall.alt} loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">SEE IT WITH YOUR SALES PROCESS</p>
            <h2>Tell us which CRM you use and where your sales day gets stuck.</h2>
            <p>We will show you how the Assistant fits around the tools and workflow you already have.</p>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">Book a demo</Link>
            <Link href={accountLinks.getStarted} className="amk-button amk-button--outline-light">Start free</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}

export function ProductPage() { return <HowItWorksPage />; }
export function IndividualsPage() { return <HowItWorksPage />; }
export function TeamsPage() { return <HowItWorksPage />; }
export function IntegrationsPage() { return <HowItWorksPage />; }
