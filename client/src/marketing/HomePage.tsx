import {
  ArrowRight,
  BellRing,
  BrainCircuit,
  Check,
  CheckCircle2,
  MessagesSquare,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { marketingImagery } from "./imagery";
import { accountLinks } from "./site";

const daySteps = [
  [
    "01",
    "Know who needs you",
    "New leads, replies, overdue work and timed calls become one clear recommended day.",
  ],
  [
    "02",
    "Open the full customer story",
    "The reason for the task, history, messages, opportunity and useful company context are ready together.",
  ],
  [
    "03",
    "Have the conversation",
    "Go into the call prepared and keep attention on the customer instead of rebuilding context or taking duplicate notes.",
  ],
  [
    "04",
    "Let AmarktAI prepare the follow-through",
    "Confirmed facts become the summary, reminder, next task, draft and proposed CRM work.",
  ],
  [
    "05",
    "Review what matters and move on",
    "Edit, approve or reject consequential work, then continue to the next customer.",
  ],
] as const;

const capabilities = [
  [
    BellRing,
    "A current sales day",
    "Priorities, new leads, replies, overdue work and scheduled calls stay visible without turning the CRM into another to-do list.",
  ],
  [
    PhoneCall,
    "Prepared calls",
    "Customer context, history, commitments and relevant company knowledge are assembled before the conversation.",
  ],
  [
    MessagesSquare,
    "Professional follow-through",
    "Notes, reminders and context-aware message drafts are prepared from the real interaction rather than from a blank screen.",
  ],
  [
    BrainCircuit,
    "Company knowledge",
    "Products, policies, terminology and approved sales context become part of the assistant's working understanding.",
  ],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">
              AI SALES ASSISTANT · WORKS WITH YOUR CRM
            </p>
            <h1>
              Your sales team sells.
              <span>
                <BrandName /> runs the work around the sale.
              </span>
            </h1>
            <p className="amk-lead">
              Keep the CRM you already use. <BrandName /> learns how your
              company sells, organises the day, prepares every customer
              conversation and gets the follow-through ready — while your people
              stay in control.
            </p>
            <div className="amk-actions">
              <Link
                href={accountLinks.getStarted}
                className="amk-button amk-button--primary"
              >
                Start free <ArrowRight size={17} />
              </Link>
              <Link
                href="/contact"
                className="amk-button amk-button--secondary"
              >
                Book a demo
              </Link>
            </div>
            <div className="amk-proofline" aria-label="Core product principles">
              <span>
                <Check size={15} /> Keep your CRM
              </span>
              <span>
                <Check size={15} /> Teach your process
              </span>
              <span>
                <Check size={15} /> Stay in control
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
            <div className="amk-hero-note">
              <span>One assistant across the sales day</span>
              <strong>Priority → Context → Call → Follow-through</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-intro-strip">
        <div className="amk-shell amk-intro-strip__inner">
          <p className="amk-kicker">
            THE MISSING LAYER BETWEEN YOUR SALESPEOPLE AND THEIR SOFTWARE
          </p>
          <h2>Not another CRM. Not another dashboard to manage.</h2>
          <p>
            The CRM stores the customer record. Your inbox holds conversations.
            Your call tools handle calls. <BrandName /> joins the work together
            so the salesperson does not have to.
          </p>
        </div>
      </section>

      <section className="amk-section amk-section--soft">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE SALES DAY, MADE SIMPLE</p>
            <h2>
              One continuous flow from “who needs me?” to “what happens next?”
            </h2>
            <p>
              Instead of making the salesperson stitch together tasks, messages,
              customer history and admin, the assistant carries the context
              forward.
            </p>
          </div>
          <div className="amk-day-flow">
            {daySteps.map(([number, title, copy]) => (
              <article className="amk-day-step" key={number}>
                <span className="amk-day-step__number">{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--plain">
        <div className="amk-shell amk-feature-story">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">KNOW MORE BEFORE YOU SAY HELLO</p>
            <h2>
              Open a customer. The reason for the conversation is already clear.
            </h2>
            <p>
              <BrandName /> brings the useful CRM facts, recent activity,
              messages, commitments and approved company knowledge into the
              salesperson's working context before the call begins.
            </p>
            <ul className="amk-check-list">
              <li>
                <CheckCircle2 size={18} /> Why this customer needs attention now
              </li>
              <li>
                <CheckCircle2 size={18} /> What happened before and what was
                promised
              </li>
              <li>
                <CheckCircle2 size={18} /> What the next conversation needs to
                achieve
              </li>
            </ul>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--story">
            <img
              src={marketingImagery.homeContext.src}
              alt={marketingImagery.homeContext.alt}
              loading="lazy"
            />
          </figure>
        </div>
      </section>

      <section className="amk-section amk-section--mist">
        <div className="amk-shell amk-feature-story amk-feature-story--reverse">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">STAY IN THE CONVERSATION</p>
            <h2>
              You talk to the customer. <BrandName /> keeps track of what
              matters.
            </h2>
            <p>
              Where call assistance is enabled with the right consent, important
              facts and commitments can be captured while the salesperson stays
              focused on listening, understanding and selling.
            </p>
            <div className="amk-inline-points">
              <span>Call preparation</span>
              <span>Consented transcript</span>
              <span>Fact capture</span>
              <span>Customer context</span>
            </div>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--story">
            <img
              src={marketingImagery.homeCall.src}
              alt={marketingImagery.homeCall.alt}
              loading="lazy"
            />
          </figure>
        </div>
      </section>

      <section className="amk-section amk-section--plain">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">WHAT THE ASSISTANT CARRIES</p>
              <h2>
                Less remembering. Less tab hunting. Less admin after every
                conversation.
              </h2>
            </div>
            <p>
              The product is designed around the work that repeatedly steals
              time from selling — not around adding another place to type data.
            </p>
          </div>
          <div className="amk-capability-grid">
            {capabilities.map(([Icon, title, copy]) => (
              <article className="amk-capability" key={title}>
                <span className="amk-icon-tile">
                  <Icon size={21} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-skill-section">
        <div className="amk-shell amk-skill-grid">
          <div>
            <p className="amk-eyebrow amk-eyebrow--on-dark">SKILL BUILDER</p>
            <h2>
              Your sales process changes. Your software should not need a new
              development project every time.
            </h2>
            <p>
              Describe a company rule or workflow in plain English.{" "}
              <BrandName />
              can map the logic, inspect available CRM capabilities, test the
              workflow and turn an approved process into a reusable company
              skill.
            </p>
            <Link
              href="/how-it-works"
              className="amk-text-link amk-text-link--on-dark"
            >
              See how skills are learned <ArrowRight size={16} />
            </Link>
          </div>
          <div className="amk-skill-flow">
            <div>
              <Sparkles size={19} />
              <span>
                <strong>Teach</strong>
                <small>Explain the real process in plain English.</small>
              </span>
            </div>
            <div>
              <Workflow size={19} />
              <span>
                <strong>Map & test</strong>
                <small>Validate the logic, data and CRM capability.</small>
              </span>
            </div>
            <div>
              <ShieldCheck size={19} />
              <span>
                <strong>Approve permissions</strong>
                <small>
                  If a new write is needed, see exactly what it changes before
                  approving it.
                </small>
              </span>
            </div>
            <div>
              <CheckCircle2 size={19} />
              <span>
                <strong>Reuse the proven skill</strong>
                <small>
                  Run routine logic consistently without rebuilding it each
                  time.
                </small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--soft">
        <div className="amk-shell">
          <div className="amk-audience-grid">
            <article>
              <p className="amk-kicker">FOR THE SALESPERSON</p>
              <h3>Spend the day with customers, not with admin.</h3>
              <p>
                See what matters now, walk into calls prepared, capture the
                facts and leave with the next step already taking shape.
              </p>
            </article>
            <article>
              <p className="amk-kicker">FOR THE COMPANY</p>
              <h3>
                Teach the process once and keep control of how it is used.
              </h3>
              <p>
                Share approved knowledge and sales rules, support individuals or
                teams, and commission new external permissions deliberately.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--on-dark">
              PUT THE SALESPERSON BACK IN SALES
            </p>
            <h2>
              Keep your CRM. Keep your people in control. Give them an assistant
              that carries the work.
            </h2>
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
