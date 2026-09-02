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
    title: "Walk into every call prepared",
    copy: "See the customer history, current task, opportunity and useful company context together before the conversation starts.",
  },
  {
    icon: MessageSquareText,
    title: "Stay focused on the customer",
    copy: "Use the Assistant for talking points, objection help and consented call support without bouncing between tabs and notes.",
  },
  {
    icon: Clock3,
    title: "Finish the follow-up while it is fresh",
    copy: "Turn the real outcome into notes, callbacks, messages and CRM updates instead of leaving good intentions in a notebook.",
  },
] as const;

const salesLoop = [
  ["01", "Know the business", "Approved company knowledge gives the Assistant the products, services, customer fit and policies your team can rely on."],
  ["02", "Know this customer", "Bring the useful CRM history into one working view so the salesperson understands what has happened and what matters now."],
  ["03", "Have the conversation", "Prepare before the call and use consented live assistance when it helps, while the salesperson stays in control."],
  ["04", "Finish what was agreed", "Prepare the exact next step, review important actions and update the right system through the salesperson's own connection."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">THE SALES ASSISTANT FOR THE CRM YOU ALREADY USE</p>
            <h1>
              Sell with more confidence.
              <span>Follow up without the scramble.</span>
            </h1>
            <p className="amk-lead">
              <BrandName /> gives every salesperson a working assistant around the CRM they already use — helping them prepare for customers, handle conversations and finish the follow-up afterwards.
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
              <span><Check size={15} /> Keep your CRM</span>
              <span><Check size={15} /> Personal salesperson workspace</span>
              <span><Check size={15} /> Review important actions</span>
            </div>
          </div>

          <div className="amk-hero__media">
            <figure className="amk-photo-frame amk-photo-frame--hero">
              <img src={marketingImagery.hero.src} alt={marketingImagery.hero.alt} />
            </figure>
            <div className="amk-float-card amk-float-card--top">
              <Sparkles size={17} />
              <div><strong>Ready for the next call</strong><span>Customer context + company knowledge</span></div>
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
          <div><strong>Keep the CRM you already trust</strong><span>No rip-and-replace project.</span></div>
          <div><strong>Give every seller better context</strong><span>Business + customer + conversation.</span></div>
          <div><strong>Close the follow-up gap</strong><span>Turn the outcome into the next action.</span></div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">A BETTER SALES DAY</p>
            <h2>Your salespeople should spend more time selling and less time reconstructing what happened.</h2>
            <p>The information is usually already there. <BrandName /> helps bring the useful pieces together at the moment the salesperson needs them.</p>
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
            <p>Instead of opening five screens, the salesperson can see the current task, opportunity, recent activity, useful notes and relevant company context together.</p>
            <ul className="amk-check-list">
              <li><CheckCircle2 size={18} /> Understand what happened last time</li>
              <li><CheckCircle2 size={18} /> See what needs attention now</li>
              <li><CheckCircle2 size={18} /> Prepare talking points around the real customer</li>
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
            <p>The Assistant stays useful through the whole sales rhythm instead of becoming another isolated chat box.</p>
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
            <p>Prepare with the right context before the call. Use consented transcription and assistance when it helps. Then turn the confirmed outcome into the note, callback, message or CRM update that should happen next.</p>
            <div className="amk-chip-row">
              <span>Customer brief</span><span>Talking points</span><span>Call support</span><span>Notes</span><span>Callbacks</span><span>CRM follow-through</span>
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
            <p><BrandName /> starts from Review Everything. The salesperson can see what is about to happen, which customer it affects and which system will be used.</p>
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
            <p>Managers can approve shared company knowledge while each salesperson keeps their own login, customer work, CRM identity, mailbox and Assistant context.</p>
            <Link href="/pricing" className="amk-text-link">See plans and pricing <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">MAKE THE NEXT SALES DAY EASIER</p>
            <h2>Keep your CRM. Add the Assistant your salespeople actually use.</h2>
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
