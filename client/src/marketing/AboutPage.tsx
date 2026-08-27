import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="site-page-hero">
        <div className="site-shell site-page-hero__grid">
          <div>
            <p className="site-eyebrow">ABOUT AMARKTAI SALES ASSISTANT</p>
            <h1>Built for the work <span>between the CRM and the customer.</span></h1>
            <p className="site-lead">Amarktai Sales Assistant exists because salespeople spend too much of the day reconstructing context, maintaining systems and remembering follow-up instead of having useful customer conversations.</p>
            <div className="site-actions"><Link href="/contact" className="site-button site-button--primary">Talk to Amarktai <ArrowRight size={16}/></Link></div>
          </div>
          <div className="site-about-mark"><div className="site-about-mark__inner"><strong>Amarkt<span>ai</span></strong><small>Sales Assistant</small></div></div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-shell site-section__intro">
          <div><p className="site-eyebrow">THE IDEA</p><h2>AI should remove friction, not create another system to feed.</h2></div>
          <div className="site-section__copy"><p>The product is built around a simple belief: the salesperson should be able to ask what matters now, prepare the conversation, get help through the call and finish the follow-through without becoming a CRM administrator.</p><p>The existing CRM remains the source of truth. Amarktai adds intelligence, context and controlled execution around it.</p></div>
        </div>
      </section>

      <section className="site-section site-section--cloud">
        <div className="site-shell site-split">
          <div className="site-copy"><p className="site-eyebrow">PART OF AMARKTAI NETWORK</p><h2>One product inside a wider AI operating network.</h2><p>Amarktai Sales Assistant is part of Amarktai Network, a family of AI products focused on making useful AI capabilities practical for real businesses. Sales Assistant applies that approach specifically to selling: company knowledge, CRM work, customer conversations, follow-up and operational proof.</p><p>We build around real workflows, measurable outcomes and clear system boundaries rather than adding AI for its own sake.</p></div>
          <figure className="site-visual"><img src="/images/site-team.svg" alt="Illustration of people connected through a shared operating network"/></figure>
        </div>
      </section>

      <section className="site-section site-section--cream">
        <div className="site-shell">
          <p className="site-eyebrow">HOW WE BUILD</p>
          <h2>Useful, grounded and accountable.</h2>
          <div className="site-rail">
            <div className="site-rail__row"><span>01</span><h3>Ground AI in real context</h3><p>Company intelligence and CRM answers should come from authorised evidence, not invented product knowledge or guessed customer data.</p></div>
            <div className="site-rail__row"><span>02</span><h3>Keep humans in control</h3><p>Important external actions remain reviewable, auditable and visible instead of being hidden behind autonomous claims.</p></div>
            <div className="site-rail__row"><span>03</span><h3>Verify what matters</h3><p>Where the system can deterministically read a result back, completion should depend on that evidence rather than the AI saying it worked.</p></div>
            <div className="site-rail__row"><span>04</span><h3>Respect personal workspaces</h3><p>Company knowledge can be shared while salesperson logins, CRM identities and private Assistant context remain personal.</p></div>
          </div>
        </div>
      </section>

      <section className="site-final"><div className="site-shell site-final__inner"><div><p className="site-eyebrow">AMARKTAI NETWORK</p><h2>Build AI around the business. Not the other way around.</h2></div><div className="site-final__action"><p>Want to see whether Sales Assistant fits your CRM and sales workflow?</p><Link href="/contact" className="site-button site-button--primary">Contact us <ArrowRight size={16}/></Link></div></div></section>
    </MarketingLayout>
  );
}
