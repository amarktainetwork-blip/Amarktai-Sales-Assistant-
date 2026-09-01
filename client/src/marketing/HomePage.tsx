import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const HERO_PHOTO = "https://images.pexels.com/photos/7679563/pexels-photo-7679563.jpeg?cs=srgb&dl=pexels-mikhail-nilov-7679563.jpg&fm=jpg";
const CALL_PHOTO = "https://images.pexels.com/photos/14596539/pexels-photo-14596539.jpeg?cs=srgb&dl=pexels-karen-slack-3606218-14596539.jpg&fm=jpg";
const TEAM_PHOTO = "https://images.pexels.com/photos/8000530/pexels-photo-8000530.jpeg?cs=srgb&dl=pexels-pavel-danilyuk-8000530.jpg&fm=jpg";

const amarktaiDifference = [
  ["01", "It learns your business", "Amarktai starts with approved company knowledge so the Assistant understands what you sell, who it is for and the context your team should use."],
  ["02", "It works around your CRM", "Keep the CRM your business already chose. Amarktai brings the useful customer context into the salesperson's working day instead of asking the team to rebuild everything somewhere else."],
  ["03", "It stays with the conversation", "Prepare with the customer story, use live assistance on consented calls, and carry the confirmed outcome into the follow-through instead of losing it between screens."],
  ["04", "It turns insight into action", "Notes, callbacks, tasks and customer updates can move from suggestion to approved action, with important changes checked before Amarktai tells you the job is done."],
  ["05", "It gives every seller a personal workspace", "Share trusted company knowledge across the team while each salesperson keeps their own login, customer work, Assistant context and CRM identity."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">AMARKTAI NETWORK · SALES ASSISTANT</p>
            <h1>Your team already has a CRM.<br/><span>Give them a better sales day.</span></h1>
            <p className="amk-lead">
              Amarktai learns your business, works with the customer context already in your CRM, helps salespeople prepare and handle conversations, and carries the confirmed next step through to follow-through.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start free <ArrowRight size={17}/></Link>
              <Link href="/how-it-works" className="amk-text-link">See the full sales flow <ArrowRight size={16}/></Link>
            </div>
            <div className="amk-proofline" aria-label="Product principles">
              <span><Check size={15}/> Keep your CRM</span>
              <span><Check size={15}/> Learns your business</span>
              <span><Check size={15}/> Before, during and after the call</span>
              <span><Check size={15}/> Review important changes</span>
            </div>
          </div>
          <figure className="amk-photo amk-photo--hero">
            <img src={HERO_PHOTO} alt="Sales professionals collaborating with technology in a bright office" />
          </figure>
        </div>
      </section>

      <section className="amk-intro">
        <div className="amk-shell amk-intro__grid">
          <p className="amk-overline">WHY AMARKTAI</p>
          <h2>Not another CRM. Not another AI chat box.</h2>
          <div className="amk-intro__copy">
            <p>The problem is rarely that a sales team has no software. The problem is that the useful information is scattered between the CRM, the company website, old notes, the salesperson's memory and the conversation happening right now.</p>
            <p>Amarktai brings those pieces into one sales rhythm: understand the business, understand the customer, know what needs attention, prepare the conversation, help through it and finish the follow-through.</p>
          </div>
        </div>
      </section>

      <section className="amk-story amk-story--soft">
        <div className="amk-shell amk-story__grid">
          <figure className="amk-photo amk-photo--story">
            <img src={TEAM_PHOTO} alt="Two sales professionals collaborating at a desk" loading="lazy" />
          </figure>
          <div className="amk-story__copy">
            <p className="amk-eyebrow">BUSINESS-AWARE FROM THE START</p>
            <h2>An assistant that knows what your company actually sells.</h2>
            <p>During setup, Amarktai can read the authorised company website, organise the useful business information and put it in front of a manager for review. That gives the sales team shared, approved context instead of asking every salesperson to teach a blank chatbot from scratch.</p>
            <p>Products, services, customer fit, credentials, useful policies and other sales context can become part of the shared company knowledge. Personal customer work remains personal to the salesperson.</p>
            <Link href="/how-it-works" className="amk-text-link">See how setup works <ArrowRight size={16}/></Link>
          </div>
        </div>
      </section>

      <section className="amk-flow">
        <div className="amk-shell">
          <div className="amk-section-head">
            <p className="amk-eyebrow">THE AMARKTAI DIFFERENCE</p>
            <h2>One assistant across the parts of selling that normally fall between systems.</h2>
          </div>
          <div className="amk-flow__rows">
            {amarktaiDifference.map(([number, title, copy]) => (
              <div className="amk-flow__row" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div>
            <p className="amk-eyebrow">START WITH THE CRM YOU ALREADY HAVE</p>
            <h2>Make the sales day easier without starting over.</h2>
          </div>
          <div>
            <p>Start with one salesperson or set up shared company knowledge for the whole team. Amarktai is designed to fit around the sales operation you already have.</p>
            <div className="amk-actions">
              <Link href="/pricing" className="amk-button amk-button--light">See pricing</Link>
              <Link href="/contact" className="amk-text-link amk-text-link--light">Talk to us <ArrowRight size={16}/></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-story amk-story--warm">
        <div className="amk-shell amk-story__grid amk-story__grid--reverse">
          <div className="amk-story__copy">
            <p className="amk-eyebrow">BEFORE, DURING AND AFTER THE CALL</p>
            <h2>Less screen hunting. More attention on the customer.</h2>
            <p>Before a call, Sales Assistant brings the customer story and useful business context together. During a consented call, it can transcribe and surface timely help. Afterwards, the confirmed outcome becomes the notes, next steps and CRM follow-through.</p>
            <div className="amk-inline-list">
              <span>Customer brief</span>
              <span>Talking points</span>
              <span>Live transcription</span>
              <span>Conversation help</span>
              <span>Notes and callbacks</span>
              <span>CRM follow-through</span>
            </div>
          </div>
          <figure className="amk-photo amk-photo--story">
            <img src={CALL_PHOTO} alt="Sales professional speaking with a customer by phone while working on a laptop" loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="amk-trust">
        <div className="amk-shell amk-trust__grid">
          <div>
            <p className="amk-eyebrow">ONE CONTINUOUS CUSTOMER STORY</p>
            <h2>Business context. CRM context. Conversation context. Follow-through.</h2>
          </div>
          <div>
            <p>That combination is what makes Sales Assistant useful. It is not trying to become the company's new database. It is the working layer that helps a salesperson understand what matters, have a better conversation and leave the customer record in a better state afterwards.</p>
            <p>Important CRM changes are designed to stay visible and reviewable. Where a supported connection can verify the result, Amarktai checks the record before presenting the work as complete.</p>
            <p className="amk-trust__systems">CRM compatibility is proven connection by connection. Ask us about the CRM your team uses today.</p>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
