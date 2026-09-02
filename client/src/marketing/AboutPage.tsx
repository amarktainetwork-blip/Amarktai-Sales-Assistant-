import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { MarketingVisual } from "./MarketingVisual";

const differences = [
  [
    "01",
    "It knows what the company sells",
    "The team can approve shared business knowledge once, so the Assistant works from the same products, services, customer-fit information, credentials and policies as the sales team.",
  ],
  [
    "02",
    "It works with the real customer record",
    "Customer history, open tasks, opportunities, notes and recent activity can become working context without replacing the CRM that already owns the record.",
  ],
  [
    "03",
    "It stays useful through the conversation",
    "The same customer story can support preparation, a consented live call and the closeout afterwards instead of disappearing every time the salesperson changes screens.",
  ],
  [
    "04",
    "It helps finish the next step",
    "Notes, callbacks, messages and CRM changes can be prepared from the confirmed outcome, with important actions visible in Review before they are carried out.",
  ],
] as const;

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-about">
        <div className="amk-shell amk-about__hero amk-about__hero--grid">
          <div>
            <p className="amk-eyebrow">WHY THIS PRODUCT EXISTS</p>
            <h1>The CRM is only one part of a salesperson&apos;s day.</h1>
            <p className="amk-about__lead">
              <BrandName /> is the working assistant around the CRM you already use. It helps the salesperson understand the business, understand the customer, handle the conversation and finish the agreed next step.
            </p>
          </div>
          <MarketingVisual variant="about" />
        </div>

        <section className="amk-about__statement">
          <div className="amk-shell amk-about__statement-grid">
            <div>
              <p className="amk-eyebrow">THE GAP WE CLOSE</p>
              <h2>The hardest sales work often happens between the tools.</h2>
            </div>
            <div>
              <p>A CRM stores the customer record. A call tool captures a conversation. A knowledge base stores company information. The salesperson still has to connect those pieces while deciding what matters now.</p>
              <p>The Assistant brings those pieces together in the moment of work: what the company can say, what has happened with this customer, what needs attention and what should happen next.</p>
              <p>The goal is simple: less time reconstructing context, more attention on the customer and fewer agreed next steps getting lost afterwards.</p>
            </div>
          </div>
        </section>

        <section className="amk-page-section">
          <div className="amk-shell">
            <div className="amk-page-section__grid">
              <div>
                <p className="amk-eyebrow">WHAT MAKES IT DIFFERENT</p>
                <h2>One continuous sales day instead of another isolated AI screen.</h2>
              </div>
              <div className="amk-page-section__copy">
                <p>The product is not trying to become another CRM or another blank chatbot. It is designed to stay useful around the systems and customer relationships your team already has.</p>
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
              <p className="amk-eyebrow">SEE IT WITH YOUR SALES PROCESS</p>
              <h2>Bring the CRM you already use. Show us where the sales day breaks down.</h2>
            </div>
            <div>
              <p>Tell us how your team works today and what keeps getting missed, repeated or copied by hand. We will show you where the Assistant fits.</p>
              <div className="amk-actions">
                <Link href="/contact" className="amk-button amk-button--light">Talk to us</Link>
                <Link href="/how-it-works" className="amk-text-link amk-text-link--light">See how it works <ArrowRight size={16}/></Link>
              </div>
            </div>
          </div>
        </section>
      </section>
    </MarketingLayout>
  );
}
