import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingVisual } from "./MarketingVisual";
import { accountLinks } from "./site";

const productFlow = [
  [
    "01",
    "Learn the business",
    "The company gives the Assistant approved information about products, services, customer fit, credentials and policies so salespeople work from the same trusted facts.",
  ],
  [
    "02",
    "Understand this customer",
    "The salesperson can work with the customer history already in the CRM — including current tasks, opportunities, notes and recent activity — without rebuilding that context by hand.",
  ],
  [
    "03",
    "Help with the conversation",
    "Before a call, it helps the salesperson prepare. During a consented call, it can transcribe and surface useful context while the salesperson stays focused on the customer.",
  ],
  [
    "04",
    "Turn the outcome into action",
    "After the conversation, the agreed outcome can become notes, callbacks, messages and CRM updates. Important actions remain visible in Review before they are carried out.",
  ],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">SALES ASSISTANT FOR THE CRM YOU ALREADY USE</p>
            <h1>
              Your CRM stores the customer record.
              <span>Your salespeople still need help doing the work.</span>
            </h1>
            <p className="amk-lead">
              <BrandName /> learns what your company sells, brings the right customer context out of the CRM, helps before and during sales conversations, and turns the agreed next step into follow-through.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">
                Start free <ArrowRight size={17} />
              </Link>
              <Link href="/how-it-works" className="amk-text-link">
                See exactly how it works <ArrowRight size={16} />
              </Link>
            </div>
            <div className="amk-proofline" aria-label="Product principles">
              <span><Check size={15}/> Keep your CRM</span>
              <span><Check size={15}/> Know the business</span>
              <span><Check size={15}/> Understand the customer</span>
              <span><Check size={15}/> Review important actions</span>
            </div>
          </div>
          <MarketingVisual variant="hero" />
        </div>
      </section>

      <section className="amk-intro">
        <div className="amk-shell amk-intro__grid">
          <p className="amk-overline">IN PLAIN ENGLISH</p>
          <h2>It helps a salesperson know what matters, what to say and what to do next.</h2>
          <div className="amk-intro__copy">
            <p>Your CRM is still the customer database. <BrandName /> sits around it as the salesperson&apos;s working assistant.</p>
            <p>It brings together the business facts the team can trust, the customer&apos;s current CRM history, the conversation happening now and the follow-through that must happen afterwards.</p>
          </div>
        </div>
      </section>

      <section className="amk-story amk-story--soft">
        <div className="amk-shell amk-story__grid">
          <MarketingVisual variant="knowledge" />
          <div className="amk-story__copy">
            <p className="amk-eyebrow">BUSINESS-AWARE FROM THE START</p>
            <h2>The Assistant learns the company before it tries to help the salesperson.</h2>
            <p>During setup, the company can provide its authorised website and basic business information. Useful products, services, customer-fit information, credentials and policies are organised for a manager to review.</p>
            <p>Once approved, the team works from the same company context instead of every salesperson having to teach a blank chatbot what the business does.</p>
            <Link href="/how-it-works" className="amk-text-link">
              See the setup and sales flow <ArrowRight size={16}/>
            </Link>
          </div>
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div>
            <p className="amk-eyebrow">START WITH WHAT YOU ALREADY HAVE</p>
            <h2>Keep the CRM. Add a working assistant around the sales day.</h2>
          </div>
          <div>
            <p>Start with one salesperson or a team. Connect the sales systems you already use, teach the shared business context once and keep important customer actions reviewable.</p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--light">Start free</Link>
              <Link href="/contact" className="amk-text-link amk-text-link--light">Talk to us <ArrowRight size={16}/></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-flow">
        <div className="amk-shell">
          <div className="amk-section-head">
            <p className="amk-eyebrow">ONE ASSISTANT ACROSS THE SALES LOOP</p>
            <h2>The useful context should follow the salesperson instead of getting lost between systems.</h2>
          </div>
          <div className="amk-flow__rows">
            {productFlow.map(([number, title, copy]) => (
              <div className="amk-flow__row" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-story amk-story--warm">
        <div className="amk-shell amk-story__grid amk-story__grid--reverse">
          <div className="amk-story__copy">
            <p className="amk-eyebrow">BEFORE, DURING AND AFTER THE CALL</p>
            <h2>Less screen hunting. More attention on the customer.</h2>
            <p>Before the call, the salesperson can see the customer story and useful business context together. During a consented call, the Assistant can transcribe and help with the conversation.</p>
            <p>Afterwards, the confirmed outcome becomes the follow-through: the note, callback, message, task or CRM change that actually needs to happen next.</p>
            <div className="amk-inline-list">
              <span>Customer brief</span>
              <span>Talking points</span>
              <span>Live transcription</span>
              <span>Conversation help</span>
              <span>Notes and callbacks</span>
              <span>CRM follow-through</span>
            </div>
          </div>
          <MarketingVisual variant="call" />
        </div>
      </section>

      <section className="amk-trust">
        <div className="amk-shell amk-trust__grid">
          <div>
            <p className="amk-eyebrow">IMPORTANT ACTIONS STAY VISIBLE</p>
            <h2>The Assistant can help do the work without quietly changing customer records behind your back.</h2>
          </div>
          <div>
            <p>Review Everything is the safe starting point. The salesperson can see the exact customer, action, message, sender, system and result before or after an important action.</p>
            <p>Where a commissioned connection can verify the outcome, the product reads the external system back before presenting the work as completed.</p>
            <p className="amk-trust__systems">CRM compatibility is proven connection by connection. Ask us about the CRM your team uses today.</p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
