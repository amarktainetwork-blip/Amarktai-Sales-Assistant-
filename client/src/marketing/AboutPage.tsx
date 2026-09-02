import { ArrowRight, CheckCircle2, Layers3, ShieldCheck, Target, Workflow } from "lucide-react";
import { Link } from "wouter";
import { BrandName } from "@/components/BrandName";
import { MarketingLayout } from "./MarketingLayout";
import { marketingImagery } from "./imagery";

const reasons = [
  {
    icon: Layers3,
    title: "The information is already scattered everywhere",
    copy: "Customer history lives in the CRM. Company knowledge lives somewhere else. The conversation happens in another tool. The salesperson is left joining the pieces together.",
  },
  {
    icon: Target,
    title: "The hard part is knowing what matters now",
    copy: "A useful assistant should help the salesperson understand this customer, this conversation and this next step — not just answer generic questions in a blank chat window.",
  },
  {
    icon: Workflow,
    title: "Follow-through is where good sales work often disappears",
    copy: "The call can go well and the next step can still be missed. AmarktAI is designed to carry the confirmed outcome into the action that should happen afterwards.",
  },
] as const;

export default function AboutPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero amk-page-hero--about">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">WHY AMARKTAI</p>
            <h1>Sales teams do not need another place to copy customer data.</h1>
            <p className="amk-lead">
              They need help using what they already have. <BrandName /> is built around the real sales day — the business context, the customer context, the conversation and the follow-through.
            </p>
            <div className="amk-actions">
              <Link href="/how-it-works" className="amk-button amk-button--primary">See how it works <ArrowRight size={16} /></Link>
              <Link href="/contact" className="amk-button amk-button--ghost">Talk to us</Link>
            </div>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--page">
            <img src={marketingImagery.focus.src} alt={marketingImagery.focus.alt} />
          </figure>
        </div>
      </section>

      <section className="amk-section amk-section--white">
        <div className="amk-shell">
          <div className="amk-section__head amk-section__head--center">
            <p className="amk-eyebrow">THE PROBLEM WE ARE SOLVING</p>
            <h2>The sales day is bigger than the CRM screen.</h2>
            <p>The CRM is important. It is just not the whole job. Salespeople still have to prepare, remember, listen, decide, follow up and keep customer records accurate afterwards.</p>
          </div>
          <div className="amk-benefit-grid">
            {reasons.map(({ icon: Icon, title, copy }) => (
              <article className="amk-benefit-card" key={title}>
                <span className="amk-icon-tile"><Icon size={21} /></span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--ice">
        <div className="amk-shell amk-split">
          <div className="amk-split__media">
            <figure className="amk-photo-frame amk-photo-frame--story">
              <img src={marketingImagery.team.src} alt={marketingImagery.team.alt} loading="lazy" />
            </figure>
          </div>
          <div className="amk-split__copy">
            <p className="amk-eyebrow">OUR APPROACH</p>
            <h2>Keep the systems that already matter. Make the work between them easier.</h2>
            <p><BrandName /> is not trying to become another CRM. It is the working layer around the salesperson: one place to bring together the useful business facts, the current customer story, the conversation and the next action.</p>
            <ul className="amk-check-list">
              <li><CheckCircle2 size={18} /> Keep the CRM your business already trusts</li>
              <li><CheckCircle2 size={18} /> Give the team approved business context</li>
              <li><CheckCircle2 size={18} /> Give every salesperson their own workspace and identity</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--navy">
        <div className="amk-shell amk-control-grid">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">HELPFUL, BUT ACCOUNTABLE</p>
            <h2>The Assistant should make work easier without becoming invisible automation.</h2>
            <p>Important customer actions are designed to stay visible. The salesperson should know which customer is affected, what will happen and which connection will be used.</p>
          </div>
          <div className="amk-control-card">
            <div><ShieldCheck size={24} /><span><strong>Review Everything by default</strong><small>Start with control and earn more autonomy deliberately.</small></span></div>
            <div><CheckCircle2 size={24} /><span><strong>Use the real customer context</strong><small>Do not guess destructive targets from names or labels.</small></span></div>
            <div><Workflow size={24} /><span><strong>Verify completed work</strong><small>Where the connection supports readback, check the external system before calling the action done.</small></span></div>
          </div>
        </div>
      </section>

      <section className="amk-section amk-section--warm">
        <div className="amk-shell amk-split amk-split--reverse">
          <div className="amk-split__copy">
            <p className="amk-eyebrow">FOR REAL SALES TEAMS</p>
            <h2>One company brain. Personal salesperson workspaces.</h2>
            <p>Shared knowledge should be consistent across the team. Customer work, CRM identity, mailbox access and personal Assistant context should still belong to the individual salesperson.</p>
            <p>That balance is what lets the product help a team without turning everyone into one shared user.</p>
          </div>
          <figure className="amk-photo-frame amk-photo-frame--story">
            <img src={marketingImagery.customerCall.src} alt={marketingImagery.customerCall.alt} loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="amk-final-cta">
        <div className="amk-shell amk-final-cta__inner">
          <div>
            <p className="amk-eyebrow amk-eyebrow--light">SEE WHERE IT FITS</p>
            <h2>Show us how your team sells today.</h2>
            <p>Tell us the CRM you use and where time, context or follow-up keeps getting lost.</p>
          </div>
          <div className="amk-actions">
            <Link href="/contact" className="amk-button amk-button--light">Book a demo</Link>
            <Link href="/pricing" className="amk-button amk-button--outline-light">See pricing</Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
