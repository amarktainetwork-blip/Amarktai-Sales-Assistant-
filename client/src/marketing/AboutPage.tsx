import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingArtwork } from "./MarketingArtwork";

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">
              WHY <BrandName />
            </p>
            <h1>
              Salespeople were hired to sell. Too much software turned them into
              administrators.
            </h1>
            <p className="amk-lead">
              <BrandName /> is built to reverse that. It connects the work
              around the CRM, keeps customer context current and removes the
              preparation, remembering and follow-through that interrupts
              selling.
            </p>
            <div className="amk-actions">
              <Link
                href="/how-it-works"
                className="amk-button amk-button--primary"
              >
                See how it works <ArrowRight size={16} />
              </Link>
              <Link
                href="/contact"
                className="amk-button amk-button--secondary"
              >
                Talk to us
              </Link>
            </div>
          </div>
          <MarketingArtwork variant="aboutHero" />
        </div>
      </section>

      <section className="amk-section amk-section--soft">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE PROBLEM IS NOT A LACK OF SOFTWARE</p>
            <h2>
              The salesperson is carrying too much of the system in their head.
            </h2>
            <p>
              Customer records, inboxes, tasks, calls, notes and company
              knowledge each hold part of the picture. The missing layer is the
              assistant that brings the useful pieces together at the right
              moment.
            </p>
          </div>
          <div className="amk-audience-grid amk-audience-grid--three">
            <article>
              <p className="amk-kicker">BEFORE THE CALL</p>
              <h3>Context should arrive before the conversation starts.</h3>
              <p>
                No rebuilding customer history from memory and no frantic tab
                hunting while somebody waits.
              </p>
            </article>
            <article>
              <p className="amk-kicker">DURING THE CALL</p>
              <h3>
                The salesperson should be listening, not duplicating notes.
              </h3>
              <p>
                Where consent allows it, assistance can capture useful facts and
                commitments without becoming the centre of the call.
              </p>
            </article>
            <article>
              <p className="amk-kicker">AFTER THE CALL</p>
              <h3>
                A good conversation should not create another admin session.
              </h3>
              <p>
                The next task, reminder, note, draft and proposed CRM changes
                can be prepared while the context is still fresh.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--plain">
        <div className="amk-shell amk-feature-story">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">
              THE <BrandName /> IDEA
            </p>
            <h2>
              Do not replace the systems. Add the intelligence between them.
            </h2>
            <p>
              The CRM remains the customer record. The mailbox remains the
              mailbox. The salesperson remains the salesperson. <BrandName />
              becomes the working layer that joins priority, context,
              conversation and follow-through.
            </p>
            <div className="amk-feature-points">
              <div>
                <Target size={19} />
                <span>
                  <strong>Customer context</strong>
                  <small>
                    The real task, opportunity, history, messages and
                    commitments.
                  </small>
                </span>
              </div>
              <div>
                <Workflow size={19} />
                <span>
                  <strong>Company process</strong>
                  <small>
                    Sales rules and workflows that can be taught, tested and
                    reused.
                  </small>
                </span>
              </div>
              <div>
                <CheckCircle2 size={19} />
                <span>
                  <strong>Human control</strong>
                  <small>
                    The assistant recommends and prepares; the salesperson still
                    decides.
                  </small>
                </span>
              </div>
            </div>
          </div>
          <MarketingArtwork variant="aboutTeam" compact />
        </div>
      </section>

      <section className="amk-section amk-section--mist">
        <div className="amk-shell amk-feature-story amk-feature-story--reverse">
          <div className="amk-feature-story__copy">
            <p className="amk-eyebrow">POWERFUL, BUT ACCOUNTABLE</p>
            <h2>
              Trust should grow from evidence, not from a blanket permission
              switch.
            </h2>
            <p>
              If a learned skill needs a new external write capability,
              <BrandName /> explains what it needs to change, where it will
              change it and why before the authorised user commissions that
              capability.
            </p>
            <div className="amk-feature-points">
              <div>
                <ShieldCheck size={19} />
                <span>
                  <strong>Review first</strong>
                  <small>
                    Consequential customer work stays visible before execution.
                  </small>
                </span>
              </div>
              <div>
                <CheckCircle2 size={19} />
                <span>
                  <strong>Prove the operation</strong>
                  <small>
                    External work should not be called complete merely because a
                    request was sent.
                  </small>
                </span>
              </div>
            </div>
          </div>
          <MarketingArtwork variant="aboutHero" compact />
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--on-dark">
              THE BEST DEMO IS YOUR REAL SALES DAY
            </p>
            <h2>
              Show us where your team loses time. We will show you what{" "}
              <BrandName /> can carry.
            </h2>
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
