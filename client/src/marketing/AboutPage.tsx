import {
  ArrowRight,
  CheckCircle2,
  Layers3,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingArtwork } from "./MarketingArtwork";

const reasons = [
  {
    icon: Layers3,
    title: "The sales day is fragmented",
    copy: "The CRM, inbox, notes, call tools, tasks and company knowledge all hold part of the picture. The salesperson is expected to keep joining it back together.",
  },
  {
    icon: Target,
    title: "Context disappears at the worst moment",
    copy: "A salesperson should not have to rebuild the customer story just before a call or search through old notes while the customer is already on the line.",
  },
  {
    icon: Workflow,
    title: "Admin steals the time that should be spent selling",
    copy: "A good conversation can still create ten minutes of notes, reminders, task changes, follow-up drafting and CRM housekeeping before the next customer gets attention.",
  },
] as const;

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero amk-page-hero--about amk-swirl amk-swirl--violet">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">WHY <BrandName /></p>
            <h1>Salespeople were hired to sell. Software turned them into admins.</h1>
            <p className="amk-lead">
              <BrandName /> is built to reverse that. It works around the CRM,
              learns how the company sells and removes the preparation,
              remembering and follow-through that pulls attention away from the
              customer.
            </p>
            <div className="amk-actions">
              <Link
                href="/how-it-works"
                className="amk-button amk-button--primary"
              >
                See how it works <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="amk-button amk-button--ghost">
                Talk to us
              </Link>
            </div>
          </div>
          <MarketingArtwork variant="aboutHero" />
        </div>
      </section>

      <section className="amk-section amk-section--white amk-swirl amk-swirl--blue">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE PROBLEM IS NOT A LACK OF SOFTWARE</p>
            <h2>The salesperson is carrying too much of the system in their head.</h2>
            <p>
              The tools may already exist. The missing layer is the assistant
              that understands the business, understands the customer and
              carries the next step forward without making the salesperson do
              the stitching.
            </p>
          </div>
          <div className="amk-benefit-grid">
            {reasons.map(({ icon: Icon, title, copy }) => (
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

      <section className="amk-section amk-section--ice amk-swirl amk-swirl--teal">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow">THE <BrandName /> IDEA</p>
            <h2>Do not replace the systems. Add the intelligence between them.</h2>
            <p>
              The CRM remains the customer record. The mailbox remains the
              mailbox. The salesperson remains the salesperson. <BrandName /> becomes
              the working layer that brings the right information and next
              action together at the right time.
            </p>
          </div>
          <div className="amk-control-card">
            <div>
              <CheckCircle2 size={24} />
              <span>
                <strong>Company knowledge</strong>
                <small>Approved products, policies, positioning and process.</small>
              </span>
            </div>
            <div>
              <Target size={24} />
              <span>
                <strong>Customer context</strong>
                <small>The real task, opportunity, history, messages and commitments.</small>
              </span>
            </div>
            <div>
              <Workflow size={24} />
              <span>
                <strong>Learned sales skills</strong>
                <small>Company-specific rules that can be taught, tested and reused.</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--navy amk-swirl amk-swirl--warm">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow">POWERFUL, BUT ACCOUNTABLE</p>
            <h2>The system should earn trust instead of asking for blind trust.</h2>
            <p>
              Important customer actions stay visible. If a new skill needs a
              new write capability, <BrandName /> should explain exactly what it
              needs to change, why it needs it and what the effect will be before
              the user approves that capability.
            </p>
          </div>
          <div className="amk-control-card">
            <div>
              <ShieldCheck size={24} />
              <span>
                <strong>Review first</strong>
                <small>Consequential work is visible before execution.</small>
              </span>
            </div>
            <div>
              <CheckCircle2 size={24} />
              <span>
                <strong>Prove the result</strong>
                <small>Where supported, read the external system back before calling work complete.</small>
              </span>
            </div>
            <div>
              <Workflow size={24} />
              <span>
                <strong>Learn from evidence</strong>
                <small>Improve from successful skills and user feedback, not uncontrolled guesses.</small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--warm amk-swirl amk-swirl--violet">
        <div className="amk-shell amk-split amk-split--reverse">
          <div className="amk-split__copy">
            <p className="amk-eyebrow">ONE COMPANY BRAIN. PERSONAL ASSISTANTS.</p>
            <h2>Teach the company once. Let every salesperson work their own way.</h2>
            <p>
              Shared sales rules and approved company knowledge belong to the
              organisation. Customer access, CRM identity, mailbox access and
              working preferences stay personal to the salesperson.
            </p>
            <p>
              That means the system can support one independent salesperson or
              an entire team without turning everybody into the same user.
            </p>
          </div>
          <MarketingArtwork variant="aboutTeam" compact />
        </div>
      </section>

      <section className="amk-final-cta amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow">THE BEST DEMO IS YOUR REAL SALES DAY</p>
            <h2>Show us where your team loses time. We will show you what <BrandName /> can carry.</h2>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">
              Book a demo
            </Link>
            <Link
              href="/pricing"
              className="amk-button amk-button--outline-light"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
