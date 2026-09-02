import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";

const TEAM_PHOTO = "https://images.pexels.com/photos/29648637/pexels-photo-29648637.jpeg?auto=compress&cs=tinysrgb&w=1800";

const differences = [
  [
    "01",
    "It knows the business, not just the CRM record",
    "Amarktai starts with manager-approved company knowledge so the Assistant understands what you sell, who it is for, the language your team should use and the sales priorities that matter.",
  ],
  [
    "02",
    "It works with the customer story",
    "CRM history, opportunities, tasks, conversations and follow-ups are brought into the salesperson's working context instead of forcing them to reconstruct the relationship screen by screen.",
  ],
  [
    "03",
    "It stays useful before, during and after the conversation",
    "Prepare the call, get help while the conversation is happening, capture what was agreed and turn the outcome into the next useful action without losing the thread between separate tools.",
  ],
  [
    "04",
    "It can act without becoming reckless",
    "Customer-facing actions start review-first. Salespeople can grant more autonomy later, while company rules, opt-outs and safety controls remain in force.",
  ],
] as const;

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-about" style={{ paddingTop: "clamp(108px, 10vw, 148px)" }}>
        <div className="amk-shell amk-about__hero">
          <p className="amk-eyebrow">WHY AMARKTAI</p>
          <h1>Your CRM records the sale. Amarktai helps your people make it happen.</h1>
          <p className="amk-about__lead">
            Most sales software is strongest inside its own screen. Amarktai is built around the salesperson's whole day: the business they represent, the customer they are speaking to, the conversation happening now and the follow-through that must happen next.
          </p>
        </div>

        <figure className="amk-shell amk-page-photo">
          <img src={TEAM_PHOTO} alt="Professional saleswoman in a bright modern office" />
        </figure>

        <section className="amk-about__statement">
          <div className="amk-shell">
            <div>
              <p className="amk-eyebrow">THE GAP WE CLOSE</p>
              <h2>Good salespeople should not have to hold the entire sales operation in their heads.</h2>
            </div>
            <div>
              <p>A CRM can store the customer record. A call tool can capture a conversation. A chatbot can answer a question. The real friction appears between those moments: deciding who matters, finding the right context, knowing what the company can promise, remembering what happened last time and making sure the next step actually gets done.</p>
              <p>Amarktai connects those moments in one personal workspace. It learns the approved business context, works with the customer's CRM history, remembers relevant previous work and keeps important customer actions visible for review.</p>
              <p>The goal is not more AI on the screen. The goal is a salesperson who is better prepared, more present with the customer and less likely to lose the next step afterwards.</p>
            </div>
          </div>
        </section>

        <section className="amk-page-section">
          <div className="amk-shell">
            <div className="amk-page-section__grid">
              <div>
                <p className="amk-eyebrow">WHAT MAKES IT DIFFERENT</p>
                <h2>Four kinds of context. One continuous sales day.</h2>
              </div>
              <div className="amk-page-section__copy">
                <p>Amarktai is not positioned as another CRM replacement or another blank AI chat box. It is the working layer around the sales systems and customer relationships you already have.</p>
              </div>
            </div>
            <div className="amk-page-lines">
              {differences.map(([number, title, copy]) => (
                <div className="amk-page-line" key={number}>
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
              <p className="amk-eyebrow">SEE IT WITH YOUR OWN SALES PROCESS</p>
              <h2>Bring the CRM you already use. We will show you where Amarktai fits.</h2>
            </div>
            <div>
              <p>Tell us how your team works today and where the sales day keeps breaking down. We will show you the part Amarktai is designed to improve.</p>
              <div className="amk-actions">
                <Link href="/contact" className="amk-button amk-button--light">Talk to Amarktai</Link>
                <Link href="/how-it-works" className="amk-text-link amk-text-link--light">See how it works <ArrowRight size={16}/></Link>
              </div>
            </div>
          </div>
        </section>
      </section>
    </MarketingLayout>
  );
}
