import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Link2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingArtwork } from "./MarketingArtwork";
import { accountLinks } from "./site";

const setupSteps = [
  [
    "01",
    "Connect the systems you already use",
    "Keep the CRM as the system of record. AmarktAI works around it instead of forcing a migration.",
  ],
  [
    "02",
    "Give the assistant trusted company knowledge",
    "Products, services, policies, positioning and terminology become approved context for the sales team.",
  ],
  [
    "03",
    "Teach the way your company sells",
    "Describe a rule or workflow in plain English. AmarktAI maps the logic and the CRM capabilities it needs.",
  ],
  [
    "04",
    "Prove the workflow before relying on it",
    "Mappings, conditions and edge cases are tested. New write permissions are explained before they can be commissioned.",
  ],
  [
    "05",
    "Use the proven skill in the real sales day",
    "The skill becomes part of the assistant's repeatable working process instead of another instruction people must remember.",
  ],
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">
              HOW <BrandName /> WORKS
            </p>
            <h1>
              Teach the assistant how your company sells. Then let it carry the
              work.
            </h1>
            <p className="amk-lead">
              <BrandName /> connects around the CRM you already use, learns the
              company process and carries the salesperson from priority to
              context to conversation to reviewed follow-through.
            </p>
            <div className="amk-actions">
              <Link
                href={accountLinks.getStarted}
                className="amk-button amk-button--primary"
              >
                Start free <ArrowRight size={16} />
              </Link>
              <Link
                href="/contact"
                className="amk-button amk-button--secondary"
              >
                Book a demo
              </Link>
            </div>
          </div>
          <MarketingArtwork variant="howHero" />
        </div>
      </section>

      <section className="amk-section amk-section--soft">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">FROM CONNECTION TO A REAL ASSISTANT</p>
              <h2>Five clear steps. No rebuild of the sales operation.</h2>
            </div>
            <p>
              The goal is not to teach salespeople another system. It is to
              teach <BrandName /> enough about the business that it can remove
              work from the salesperson.
            </p>
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

      <section className="amk-section amk-section--plain">
        <div className="amk-shell amk-feature-story">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">THE DAILY WORKING LOOP</p>
            <h2>
              The assistant stays useful before, during and after the customer
              conversation.
            </h2>
            <p>
              Work is organised around the customer instead of around whichever
              tool the salesperson happens to have open.
            </p>
            <div className="amk-feature-points">
              <div>
                <Sparkles size={19} />
                <span>
                  <strong>Before</strong>
                  <small>
                    Priority, customer context, history and useful company
                    knowledge.
                  </small>
                </span>
              </div>
              <div>
                <BrainCircuit size={19} />
                <span>
                  <strong>During</strong>
                  <small>
                    Consented assistance that helps capture facts and
                    commitments without distracting from the conversation.
                  </small>
                </span>
              </div>
              <div>
                <CheckCircle2 size={19} />
                <span>
                  <strong>After</strong>
                  <small>
                    Summary, reminder, next task, follow-up draft and proposed
                    CRM work prepared for review.
                  </small>
                </span>
              </div>
            </div>
          </div>
          <MarketingArtwork variant="howCrm" compact />
        </div>
      </section>

      <section className="amk-skill-section">
        <div className="amk-shell amk-skill-grid">
          <div>
            <p className="amk-eyebrow amk-eyebrow--on-dark">
              LEARN A NEW COMPANY SKILL
            </p>
            <h2>
              Ordinary sales-process changes should not require ordinary
              source-code changes.
            </h2>
            <p>
              Tell <BrandName /> what the team needs to do. It determines
              whether existing building blocks can do it, whether the CRM needs
              a newly learned operation, or whether the request truly needs a
              new platform capability.
            </p>
          </div>
          <div className="amk-skill-flow">
            <div>
              <Sparkles size={19} />
              <span>
                <strong>Understand</strong>
                <small>
                  Turn the plain-English procedure into structured logic.
                </small>
              </span>
            </div>
            <div>
              <Workflow size={19} />
              <span>
                <strong>Simulate</strong>
                <small>
                  Test real mappings and edge cases before activation.
                </small>
              </span>
            </div>
            <div>
              <ShieldCheck size={19} />
              <span>
                <strong>Permission check</strong>
                <small>
                  Explain any new CRM write capability and wait for explicit
                  approval.
                </small>
              </span>
            </div>
            <div>
              <CheckCircle2 size={19} />
              <span>
                <strong>Prove</strong>
                <small>
                  Only call the skill ready when its execution truth is
                  demonstrated.
                </small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--mist">
        <div className="amk-shell amk-feature-story amk-feature-story--reverse">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">YOUR CRM STAYS THE SYSTEM OF RECORD</p>
            <h2>
              <BrandName /> becomes the intelligent working layer around it.
            </h2>
            <p>
              Customer records remain where the business already keeps them. The
              assistant reads the useful context into the sales flow and
              prepares approved work through commissioned connections.
            </p>
            <div className="amk-feature-points">
              <div>
                <Link2 size={19} />
                <span>
                  <strong>Capability by capability</strong>
                  <small>
                    Each CRM operation is mapped and proven instead of
                    pretending every system behaves the same.
                  </small>
                </span>
              </div>
              <div>
                <ShieldCheck size={19} />
                <span>
                  <strong>Writes stay explicit</strong>
                  <small>
                    A new write is not silently granted just because a workflow
                    needs it.
                  </small>
                </span>
              </div>
            </div>
          </div>
          <MarketingArtwork variant="howHero" compact />
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--on-dark">
              SHOW US ONE REAL SALES PROCESS
            </p>
            <h2>
              We will show you what <BrandName /> can take off the salesperson.
            </h2>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">
              Book a demo
            </Link>
            <Link
              href={accountLinks.getStarted}
              className="amk-button amk-button--outline-light"
            >
              Start free
            </Link>
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
