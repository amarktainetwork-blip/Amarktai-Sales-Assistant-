import {
  ArrowRight,
  CheckCircle2,
  Link2,
  MessagesSquare,
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
    "Keep the CRM you already use",
    "The assistant connects around the system that already holds your customer record. There is no forced CRM migration just to get a better sales day.",
  ],
  [
    "02",
    "Give it the company knowledge",
    "Products, services, policies, positioning and approved sales context become trusted company knowledge instead of living in scattered files and people's heads.",
  ],
  [
    "03",
    "Teach it how your company sells",
    "Describe a sales rule or workflow in plain English. The assistant identifies what data and CRM functions it needs and turns the approved process into a reusable skill.",
  ],
  [
    "04",
    "Prove the skill before relying on it",
    "The system simulates the logic, checks mappings and shows what it would do. Anything that needs a CRM write or customer communication stays behind explicit approval.",
  ],
  [
    "05",
    "Let trust grow from evidence",
    "Start review-first. As skills are proven and the company approves them, routine work can become more automated without taking control away from the salesperson.",
  ],
] as const;

const dailyFlow = [
  {
    icon: Sparkles,
    title: "Before the call",
    copy: "The assistant brings the task, customer history, opportunity, recent activity and relevant company knowledge together before the salesperson starts talking.",
  },
  {
    icon: MessagesSquare,
    title: "During the call",
    copy: "With consented assistance, the salesperson can focus on the customer while important facts, commitments and context are captured for the next step.",
  },
  {
    icon: CheckCircle2,
    title: "After the call",
    copy: "The confirmed outcome becomes the note, reminder, callback, follow-up draft and commissioned CRM work ready for review.",
  },
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero amk-page-hero--photo amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">HOW <BrandName /> WORKS</p>
            <h1>Teach it how you sell. Then let it carry the work.</h1>
            <p className="amk-lead">
              <BrandName /> learns the company process, works around the CRM you
              already use and carries the salesperson from the next priority to
              the customer conversation to the reviewed follow-through.
            </p>
            <div className="amk-actions">
              <Link
                href={accountLinks.getStarted}
                className="amk-button amk-button--primary"
              >
                Start free <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="amk-button amk-button--ghost">
                Book a demo
              </Link>
            </div>
          </div>
          <MarketingArtwork variant="howHero" />
        </div>
      </section>

      <section className="amk-section amk-section--white amk-swirl amk-swirl--violet">
        <div className="amk-shell">
          <div className="amk-section__head">
            <div>
              <p className="amk-eyebrow">FROM SIGN-IN TO A REAL ASSISTANT</p>
              <h2>Five steps. No rebuild of the sales operation.</h2>
            </div>
            <p>
              The goal is not to teach the salesperson another piece of
              software. It is to teach <BrandName /> enough about the business that
              it can remove work from the salesperson.
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

      <section className="amk-section amk-section--ice amk-swirl amk-swirl--teal">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow">THE SKILL BUILDER</p>
            <h2>New company rules should not require new source code.</h2>
            <p>
              Tell <BrandName /> what the team needs to do. It works out whether the
              CRM already exposes what is needed, whether a new CRM operation
              must be learned, or whether the request truly needs engineering.
            </p>
            <p>
              AI can help while a skill is being learned or repaired. Once the
              skill is proven, routine execution should be deterministic and
              repeatable.
            </p>
          </div>
          <div className="amk-control-card">
            <div>
              <Sparkles size={24} />
              <span>
                <strong>Understand the rule</strong>
                <small>Turn plain-English procedure into structured logic.</small>
              </span>
            </div>
            <div>
              <Workflow size={24} />
              <span>
                <strong>Test it before activation</strong>
                <small>Simulate mappings, conditions and edge cases first.</small>
              </span>
            </div>
            <div>
              <ShieldCheck size={24} />
              <span>
                <strong>Ask before new write permissions</strong>
                <small>
                  Explain the exact write needed, what it would change and why,
                  then wait for authorised approval.
                </small>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--light amk-swirl amk-swirl--warm">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE DAILY SALES LOOP</p>
            <h2>The assistant stays useful from one conversation to the next.</h2>
            <p>
              The salesperson should not have to keep transferring context
              between the CRM, inbox, notes and their own memory.
            </p>
          </div>
          <div className="amk-benefit-grid">
            {dailyFlow.map(({ icon: Icon, title, copy }) => (
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

      <section className="amk-section amk-section--warm amk-swirl amk-swirl--blue">
        <div className="amk-shell amk-split amk-split--reverse">
          <div className="amk-split__copy">
            <p className="amk-eyebrow">THE CRM STAYS THE SYSTEM OF RECORD</p>
            <h2><BrandName /> becomes the working layer around it.</h2>
            <p>
              Customer records stay where the business already keeps them.
              <BrandName /> brings the useful information into the salesperson's
              working flow and prepares the next action through commissioned
              connections.
            </p>
            <div className="amk-feature-points">
              <div>
                <Link2 size={19} />
                <span>
                  <strong>Connection by connection</strong>
                  <small>
                    Each CRM capability is learned, mapped and proven instead of
                    pretending every system behaves the same.
                  </small>
                </span>
              </div>
              <div>
                <ShieldCheck size={19} />
                <span>
                  <strong>Writes are explicit</strong>
                  <small>
                    If a skill needs a new write capability, the user sees what
                    it needs and approves it before commissioning.
                  </small>
                </span>
              </div>
            </div>
          </div>
          <MarketingArtwork variant="howCrm" compact />
        </div>
      </section>

      <section className="amk-final-cta amk-swirl amk-swirl--violet">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow">SHOW US ONE REAL SALES PROCESS</p>
            <h2>We will show you what <BrandName /> can take off the salesperson.</h2>
            <p>
              Bring the CRM, the process and the admin your team currently has
              to carry by hand.
            </p>
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
