import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  Clock3,
  MessageSquareText,
  ShieldCheck,
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
    title: "Let the day tell you what matters",
    copy: "AmarktAI turns live customer activity, replies, due work and opportunity context into a clear next-person queue so the salesperson does not spend the morning deciding where to start.",
  },
  {
    icon: MessageSquareText,
    title: "Carry the customer story with you",
    copy: "Preparation, customer history, business knowledge and the reason for the next action follow the salesperson into the conversation instead of being rebuilt from tabs and memory.",
  },
  {
    icon: Clock3,
    title: "Give the admin back to the assistant",
    copy: "After the conversation, AmarktAI prepares the factual note, callback and follow-up for Review while the salesperson moves on to the next customer.",
  },
] as const;

const salesLoop = [
  [
    "01",
    "Connect what you already use",
    "Keep the CRM and business systems your team already trusts. AmarktAI learns the approved company context and works around those sources instead of asking you to replace them.",
  ],
  [
    "02",
    "Run the day from Today",
    "Replies, due work, overdue follow-ups, new leads and scheduled calls become one ordered personal queue with the right customer context attached.",
  ],
  [
    "03",
    "Stay in the conversation",
    "Prepare before the call and use consented live assistance when it helps while the salesperson stays focused on the customer, not on admin.",
  ],
  [
    "04",
    "Let AmarktAI prepare the follow-through",
    "Capture the real outcome, prepare the next admin and review consequential actions before anything customer-facing or external is allowed to run.",
  ],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">
              THE SALES ASSISTANT THAT WORKS AROUND YOUR CRM
            </p>
            <h1>
              Get hours of your sales day back.
              <span>
                Know who needs you, what matters and what happens next.
              </span>
            </h1>
            <p className="amk-lead">
              <BrandName /> connects to the CRM your business already uses and
              turns live customer activity, tasks, replies, company knowledge
              and call context into one guided sales day — less admin, fewer
              missed follow-ups and more time selling and helping customers.
            </p>
            <div className="amk-actions">
              <Link
                href={accountLinks.getStarted}
                className="amk-button amk-button--primary"
              >
                Start free <ArrowRight size={17} />
              </Link>
              <Link
                href="/how-it-works"
                className="amk-button amk-button--ghost"
              >
                See how it works
              </Link>
            </div>
            <div className="amk-proofline" aria-label="Product benefits">
              <span>
                <Check size={15} /> Not another CRM
              </span>
              <span>
                <Check size={15} /> Works around the system you already use
              </span>
              <span>
                <Check size={15} /> Important actions stay reviewable
              </span>
            </div>
          </div>

          <div className="amk-hero__media">
            <figure className="amk-photo-frame amk-photo-frame--hero">
              <img
                src={marketingImagery.hero.src}
                alt={marketingImagery.hero.alt}
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="amk-benefit-band">
        <div className="amk-shell amk-benefit-band__grid">
          <div>
            <strong>Keep the CRM you already trust</strong>
            <span>AmarktAI sits above it instead of replacing it.</span>
          </div>
          <div>
            <strong>Get time back every day</strong>
            <span>Preparation, reminders and follow-through in one flow.</span>
          </div>
          <div>
            <strong>Never rebuild the customer story</strong>
            <span>Context follows you from Today to the call to Review.</span>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">
              AN ASSISTANT, NOT ANOTHER SYSTEM TO MANAGE
            </p>
            <h2>
              Your salesperson should spend the day selling — not rebuilding
              context and chasing admin.
            </h2>
            <p>
              The useful information is already spread across the CRM, customer
              history, inbox and business knowledge. <BrandName /> pulls the
              right pieces together at the moment they are needed and keeps the
              next step visible.
            </p>
          </div>
          <div className="amk-benefit-grid">
            {benefits.map(({ icon: Icon, title, copy }) => (
              <article className="amk-benefit-card" key={title}>
                <span className="amk-icon-tile">
                  <Icon size={21} />
                </span>
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
              <img
                src={marketingImagery.customerCall.src}
                alt={marketingImagery.customerCall.alt}
                loading="lazy"
              />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">BE READY BEFORE THE PHONE RINGS</p>
            <h2>Walk into the conversation knowing the customer story.</h2>
            <p>
              Instead of opening five screens, the salesperson can see the
              current task, opportunity, recent activity, useful notes and
              relevant approved company context together.
            </p>
            <ul className="amk-check-list">
              <li>
                <CheckCircle2 size={18} /> Understand what happened last time
              </li>
              <li>
                <CheckCircle2 size={18} /> See what needs attention now
              </li>
              <li>
                <CheckCircle2 size={18} /> Prepare around the real customer, not
                invented context
              </li>
            </ul>
            <Link href="/how-it-works" className="amk-text-link">
              See the full sales flow <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--white">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">
                ONE ASSISTANT ACROSS THE ENTIRE SALES DAY
              </p>
              <h2>From the first priority to the finished follow-up.</h2>
            </div>
            <p>
              AmarktAI stays with the salesperson from deciding who needs
              attention, through customer context and the call, to the reviewed
              next action — instead of becoming another dashboard, another chat
              box or another place to copy information into.
            </p>
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
            <h2>
              Keep the salesperson in the conversation — not buried in admin.
            </h2>
            <p>
              Prepare with the right context before the call. Use consented
              transcription and assistance when it helps. Then turn the
              confirmed outcome into the note, callback, reviewed message or CRM
              update that should happen next.
            </p>
            <div className="amk-chip-row">
              <span>Customer brief</span>
              <span>Talking points</span>
              <span>Call support</span>
              <span>Outcome</span>
              <span>Callbacks</span>
              <span>CRM follow-through</span>
            </div>
          </div>
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img
                src={marketingImagery.focus.src}
                alt={marketingImagery.focus.alt}
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--navy">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">
              HELPFUL WITHOUT TAKING OVER
            </p>
            <h2>Important customer actions stay visible and reviewable.</h2>
            <p>
              <BrandName /> starts from Review Everything. The salesperson can
              see the exact proposed action, which customer it affects and which
              commissioned system will be used before it runs.
            </p>
          </div>
          <div className="amk-control-card">
            <div>
              <ShieldCheck size={24} />
              <span>
                <strong>Review first</strong>
                <small>See the exact action before it runs.</small>
              </span>
            </div>
            <div>
              <Users size={24} />
              <span>
                <strong>Your own connections</strong>
                <small>
                  Use the salesperson's commissioned CRM, mailbox and channels.
                </small>
              </span>
            </div>
            <div>
              <CheckCircle2 size={24} />
              <span>
                <strong>Verify the result</strong>
                <small>
                  Where supported, read the external system back before calling
                  the work complete.
                </small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img
                src={marketingImagery.team.src}
                alt={marketingImagery.team.alt}
                loading="lazy"
              />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">FOR ONE SALESPERSON OR THE WHOLE TEAM</p>
            <h2>
              Teach the business once. Give every salesperson an assistant that
              knows how they work.
            </h2>
            <p>
              Managers approve shared company knowledge once. Each salesperson
              keeps their own login, CRM identity, mailbox and customer context
              while AmarktAI keeps their day focused on the work that actually
              needs them.
            </p>
            <Link href="/pricing" className="amk-text-link">
              See plans and pricing <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">
              MAKE THE NEXT SALES DAY EASIER
            </p>
            <h2>Keep your CRM. Give your salespeople their time back.</h2>
            <p>
              Start with one salesperson, or show us the systems and sales
              process your team already uses.
            </p>
          </div>
          <div className="amk-actions">
            <Link
              href={accountLinks.getStarted}
              className="amk-button amk-button--light"
            >
              Start free <ArrowRight size={17} />
            </Link>
            <Link
              href="/contact"
              className="amk-button amk-button--outline-light"
            >
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
