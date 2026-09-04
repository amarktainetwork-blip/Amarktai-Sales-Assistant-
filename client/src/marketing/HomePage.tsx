import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { marketingImagery } from "./imagery";
import { accountLinks } from "./site";

const benefits = [
  {
    icon: BriefcaseBusiness,
    title: "Know who needs attention next",
    copy: "Bring the current task, opportunity, customer history and approved company context into one working view before the conversation starts.",
  },
  {
    icon: MessageSquareText,
    title: "Stay focused on the customer",
    copy: "Prepare talking points, handle objections and use consented call support without rebuilding the customer story from tabs, notes and memory.",
  },
  {
    icon: Clock3,
    title: "Finish the follow-up while it is fresh",
    copy: "Turn the confirmed outcome into notes, callbacks, reviewed messages and CRM updates before the next customer takes over the day.",
  },
] as const;

const salesLoop = [
  ["01", "Know the business", "Approved company knowledge gives AmarktAI the products, services, customer fit and policies the sales team is allowed to rely on."],
  ["02", "Know this customer", "The CRM remains the system of record while AmarktAI brings the useful customer history, tasks and opportunity into the daily workspace."],
  ["03", "Have the conversation", "Prepare before the call and use consented live assistance when it helps, while the salesperson stays in control of the conversation."],
  ["04", "Finish what was agreed", "Capture the real outcome, review important actions and update the correct CRM or mailbox through the salesperson's own commissioned connection."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">YOUR DAILY SALES WORKSPACE — AROUND THE CRM YOU ALREADY USE</p>
            <h1>
              Sell with more confidence.
              <span>Know the next move before follow-up slips.</span>
            </h1>
            <p className="amk-lead">
              <BrandName /> turns the CRM you already trust, approved company knowledge and real customer activity into one daily sales workspace — so each salesperson can see who needs attention, what happened, what to say and what should happen next.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">
                Start free <ArrowRight size={17} />
              </Link>
              <Link href="/how-it-works" className="amk-button amk-button--ghost">
                See how it works
              </Link>
            </div>
            <div className="amk-proofline" aria-label="Product benefits">
              <span><Check size={15} /> CRM stays your system of record</span>
              <span><Check size={15} /> AmarktAI becomes the daily workspace</span>
              <span><Check size={15} /> Review important customer actions</span>
            </div>
          </div>

          <div className="amk-hero__media">
            <figure className="amk-photo-frame amk-photo-frame--hero">
              <img src={marketingImagery.hero.src} alt={marketingImagery.hero.alt} />
            </figure>
            <div className="amk-float-card amk-float-card--top">
              <Sparkles size={17} />
              <div><strong>Next customer is clear</strong><span>CRM context + approved company knowledge</span></div>
            </div>
            <div className="amk-float-card amk-float-card--bottom">
              <CheckCircle2 size={17} />
              <div><strong>Follow-up prepared</strong><span>Review before anything important changes</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-benefit-band">
        <div className="amk-shell amk-benefit-band__grid">
          <div><strong>Keep the CRM you already trust</strong><span>It remains the system of record.</span></div>
          <div><strong>Work from AmarktAI every day</strong><span>Priority + customer + call + follow-up.</span></div>
          <div><strong>Close the follow-up gap</strong><span>Turn the real outcome into the next action.</span></div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">A BETTER SALES DAY</p>
            <h2>The salesperson should know what matters now without reconstructing yesterday first.</h2>
            <p>The useful information is usually already in the business and CRM. <BrandName /> brings the right pieces together when the salesperson needs to decide, call or follow up.</p>
          </div>
          <div className="amk-benefit-grid">
            {benefits.map(({ icon: Icon, title, copy }) => (
              <article className="amk-benefit-card" key={title}>
                <span className="amk-icon-tile"><Icon size={21} /></span>
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
              <img src={marketingImagery.customerCall.src} alt={marketingImagery.customerCall.alt} loading="lazy" />
            </figure>
            <div className="amk-mini-stat"><strong>One customer story</strong><span>Before · during · after the call</span></div>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">BE READY BEFORE THE PHONE RINGS</p>
            <h2>Walk into the conversation knowing the customer story.</h2>
            <p>Instead of opening five screens, the salesperson can see the current task, opportunity, recent activity, useful notes and relevant approved company context together.</p>
            <ul className="amk-check-list">
              <li><CheckCircle2 size={18} /> Understand what happened last time</li>
              <li><CheckCircle2 size={18} /> See what needs attention now</li>
              <li><CheckCircle2 size={18} /> Prepare around the real customer, not invented context</li>
            </ul>
            <Link href="/how-it-works" className="amk-text-link">See the full sales flow <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--white">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">ONE ASSISTANT ACROSS THE SALES LOOP</p>
              <h2>From company knowledge to customer follow-through.</h2>
            </div>
            <p>AmarktAI stays with the salesperson from deciding who needs attention through the call, the outcome and the reviewed next action — instead of becoming another isolated chat box.</p>
          </div>
          <div className="amk-process-grid">
            {salesLoop.map(([number, title, copy]) => (
              <article className="amk-process-card" key={number}>
                <span>{number}</span>
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
            <p className="amk-eyebrow">BEFORE, DURING AND AFTER THE CALL</p>
            <h2>Keep the salesperson in the conversation — not buried in admin.</h2>
            <p>Prepare with the right context before the call. Use consented transcription and assistance when it helps. Then turn the confirmed outcome into the note, callback, reviewed message or CRM update that should happen next.</p>
            <div className="amk-chip-row">
              <span>Customer brief</span><span>Talking points</span><span>Call support</span><span>Outcome</span><span>Callbacks</span><span>CRM follow-through</span>
            </div>
          </div>
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img src={marketingImagery.focus.src} alt={marketingImagery.focus.alt} loading="lazy" />
            </figure>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--navy">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">HELPFUL WITHOUT TAKING OVER</p>
            <h2>Important customer actions stay visible and reviewable.</h2>
            <p><BrandName /> starts from Review Everything. The salesperson can see the exact proposed action, which customer it affects and which commissioned system will be used before it runs.</p>
          </div>
          <div className="amk-control-card">
            <div><ShieldCheck size={24} /><span><strong>Review first</strong><small>See the exact action before it runs.</small></span></div>
            <div><Users size={24} /><span><strong>Your own connections</strong><small>Use the salesperson's commissioned CRM, mailbox and channels.</small></span></div>
            <div><CheckCircle2 size={24} /><span><strong>Verify the result</strong><small>Where supported, read the external system back before calling the work complete.</small></span></div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img src={marketingImagery.team.src} alt={marketingImagery.team.alt} loading="lazy" />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">FOR ONE SALESPERSON OR THE WHOLE TEAM</p>
            <h2>Teach the business once. Give every salesperson a personal workspace.</h2>
            <p>Managers approve the shared company knowledge once. Each salesperson keeps their own login, CRM identity, mailbox, customer context and AmarktAI memory.</p>
            <Link href="/pricing" className="amk-text-link">See plans and pricing <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">MAKE THE NEXT SALES DAY EASIER</p>
            <h2>Keep your CRM. Give the salesperson one place to run the sales day.</h2>
            <p>Start with one salesperson, or talk to us about your CRM and sales process.</p>
          </div>
          <div className="amk-actions">
            <Link href={accountLinks.getStarted} className="amk-button amk-button--light">Start free <ArrowRight size={17} /></Link>
            <Link href="/contact" className="amk-button amk-button--outline-light">Book a demo</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
