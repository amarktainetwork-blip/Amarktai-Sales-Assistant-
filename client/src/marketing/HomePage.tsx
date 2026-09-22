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
    title: "It runs the sales day around you",
    copy: "New leads, replies, overdue work, scheduled calls and follow-ups become one clear recommended queue. You can reorder it at any time — the assistant guides, you decide.",
  },
  {
    icon: MessageSquareText,
    title: "It brings the customer story to the call",
    copy: "The current task, CRM history, opportunity, recent messages, useful notes and approved company knowledge arrive together before you start the conversation.",
  },
  {
    icon: Clock3,
    title: "It takes the admin off the salesperson",
    copy: "After the call, the assistant turns the confirmed outcome into notes, reminders, callbacks, follow-up drafts and CRM work ready for review instead of leaving it in somebody's head.",
  },
] as const;

const salesLoop = [
  [
    "01",
    "Start with the work that matters",
    "The assistant watches the live sources you already use and recommends the customers who need attention now — without locking the salesperson into its order.",
  ],
  [
    "02",
    "Open the customer with context already loaded",
    "See why this person is here, what happened before, what they asked for, what was promised and what the next conversation needs to achieve.",
  ],
  [
    "03",
    "Sell while the assistant keeps track",
    "With consented call support, the salesperson can stay in the conversation while the assistant captures the important facts and keeps the customer story current.",
  ],
  [
    "04",
    "Review the follow-through and move on",
    "The note, next task, reminder, message draft and commissioned CRM action can be prepared immediately so the salesperson can focus on the next customer.",
  ],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">YOUR SALES DAY, RUN AROUND YOU</p>
            <h1>
              Sell more.
              <span>Let <BrandName /> handle the work around the sale.</span>
            </h1>
            <p className="amk-lead">
              Keep the CRM your business already uses. <BrandName /> learns how
              your company sells, keeps the day current, prepares every
              conversation and gets the follow-through ready — while the
              salesperson stays in control.
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
                See the sales day
              </Link>
            </div>
            <div className="amk-proofline" aria-label="Product benefits">
              <span>
                <Check size={15} /> Keep your CRM
              </span>
              <span>
                <Check size={15} /> Learns your sales process
              </span>
              <span>
                <Check size={15} /> You stay in control
              </span>
            </div>
          </div>

          <div className="amk-hero__media">
            <figure className="amk-photo-frame amk-photo-frame--hero">
              <img
                src={marketingImagery.homeHero.src}
                alt={marketingImagery.homeHero.alt}
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="amk-benefit-band">
        <div className="amk-shell amk-benefit-band__grid">
          <div>
            <strong>Know who needs you now</strong>
            <span>Live work becomes a clear recommended next-customer queue.</span>
          </div>
          <div>
            <strong>Stay present in the conversation</strong>
            <span>The customer story is ready before the call begins.</span>
          </div>
          <div>
            <strong>Move on without losing the admin</strong>
            <span>Notes, reminders and follow-through are prepared behind you.</span>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light amk-swirl amk-swirl--violet">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">NOT A CHATBOT. NOT ANOTHER CRM.</p>
            <h2>A sales assistant that actually works through the day with you.</h2>
            <p>
              <BrandName /> is built around the moments that steal selling time:
              deciding what to do next, rebuilding context, taking notes,
              remembering commitments and doing the admin after the call.
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

      <section className="amk-section amk-section--ice amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img
                src={marketingImagery.homeContext.src}
                alt={marketingImagery.homeContext.alt}
                loading="lazy"
              />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">KNOW MORE BEFORE YOU SAY HELLO</p>
            <h2>Open a lead and the customer story is already there.</h2>
            <p>
              No tab hunt. No rebuilding the history from memory. <BrandName />
              assembles the useful CRM facts, recent activity, messages,
              business knowledge and reason for the next action in one place.
            </p>
            <ul className="amk-check-list">
              <li>
                <CheckCircle2 size={18} /> What they asked for and why they came in
              </li>
              <li>
                <CheckCircle2 size={18} /> What happened in the last conversation
              </li>
              <li>
                <CheckCircle2 size={18} /> What was promised and when it is due
              </li>
            </ul>
            <Link href="/how-it-works" className="amk-text-link">
              See how the sales day works <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--white amk-swirl amk-swirl--teal">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">ONE ASSISTANT ACROSS THE WHOLE DAY</p>
              <h2>Before the call. During the call. After the call.</h2>
            </div>
            <p>
              The value is not another screen to manage. It is continuity:
              <BrandName /> carries the work from priority, to context, to
              conversation, to the reviewed next step.
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

      <section className="amk-section amk-section--warm amk-swirl amk-swirl--warm">
        <div className="amk-shell amk-split amk-split--reverse">
          <div className="amk-split__copy">
            <p className="amk-eyebrow">THE CALL STAYS HUMAN</p>
            <h2>You talk. <BrandName /> remembers.</h2>
            <p>
              When call assistance is enabled with the right consent, the
              salesperson can focus on listening and selling while <BrandName />
              captures the important facts, keeps customer context current and
              prepares the work that follows.
            </p>
            <div className="amk-chip-row">
              <span>Call context</span>
              <span>Consented transcript</span>
              <span>Facts captured</span>
              <span>Customer notes</span>
              <span>Callback</span>
              <span>Follow-up draft</span>
            </div>
          </div>
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img
                src={marketingImagery.homeCall.src}
                alt={marketingImagery.homeCall.alt}
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--navy amk-swirl amk-swirl--violet">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow">ASSISTANT, NOT A BOSS</p>
            <h2>It recommends the day. The salesperson still decides.</h2>
            <p>
              Work the third lead before the second. Snooze something. Pick
              another customer. Edit a draft. Reject a suggestion. <BrandName /> is
              there to remove friction, not replace the salesperson's judgement.
            </p>
          </div>
          <div className="amk-control-card">
            <div>
              <Users size={24} />
              <span>
                <strong>Reorder the day</strong>
                <small>The queue is recommended, never enforced.</small>
              </span>
            </div>
            <div>
              <ShieldCheck size={24} />
              <span>
                <strong>Review important actions</strong>
                <small>See and change consequential work before it runs.</small>
              </span>
            </div>
            <div>
              <CheckCircle2 size={24} />
              <span>
                <strong>Earn more autonomy deliberately</strong>
                <small>Trust grows from proven skills and explicit permission.</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img
                src={marketingImagery.homeTeam.src}
                alt={marketingImagery.homeTeam.alt}
                loading="lazy"
              />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">TEACH IT HOW YOUR COMPANY SELLS</p>
            <h2>Teach a skill once. Let the whole sales operation benefit.</h2>
            <p>
              A manager can describe a real sales rule or workflow in plain
              English. <BrandName /> maps what it needs, tests the logic, shows what
              permissions are required and turns the approved process into a
              reusable company skill — without rebuilding the product for every
              new rule.
            </p>
            <p>
              Company rules stay with the company. Each salesperson can still
              develop their own working preferences without overriding policy.
            </p>
            <Link href="/how-it-works" className="amk-text-link">
              See how <BrandName /> learns <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="amk-final-cta amk-swirl amk-swirl--teal">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow">PUT THE SALESPERSON BACK IN SALES</p>
            <h2>Show <BrandName /> how you sell. Let it give the time back.</h2>
            <p>
              Start with one salesperson or bring a team. Keep the CRM and the
              process you already trust.
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
