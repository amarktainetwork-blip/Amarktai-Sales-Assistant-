import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const TEAM_PHOTO = "https://images.pexels.com/photos/8068833/pexels-photo-8068833.jpeg?cs=srgb&dl=pexels-edmond-dantes-8068833.jpg&fm=jpg";
const CALL_PHOTO = "https://images.pexels.com/photos/14596539/pexels-photo-14596539.jpeg?cs=srgb&dl=pexels-karen-slack-3606218-14596539.jpg&fm=jpg";

const setup = [
  ["01", "Create the workspace", "Every person has their own Amarktai Network login. A company does not share one Sales Assistant account across the team."],
  ["02", "Teach Amarktai the business", "The authorised website and company information are analysed, grounded against retained evidence and reviewed before becoming trusted sales context."],
  ["03", "Connect the CRM", "The company connects the system of record. Where required, each salesperson keeps their own CRM identity, credentials and personal session."],
  ["04", "Prove what the CRM can do", "Reads, writes, tasks, notes, pipeline actions and other functions are tested against the real connected CRM instead of being assumed."],
  ["05", "Start from the sales day", "Today, Customers, Assistant, Calls and CRM become the core workspace. Shared company context stays shared; personal selling work stays personal."],
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section className="amk-page-hero">
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">HOW IT WORKS</p>
            <h1>Set up the business once.<br/>Give every salesperson a clearer day.</h1>
            <p>Sales Assistant separates the things a company should share — approved business knowledge, policy and CRM definition — from the things that belong to each salesperson, including their login, CRM identity and private working context.</p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start free <ArrowRight size={16}/></Link>
              <Link href="/contact" className="amk-text-link">Talk to us <ArrowRight size={16}/></Link>
            </div>
          </div>
          <figure className="amk-page-photo">
            <img src={TEAM_PHOTO} alt="Sales team collaborating around a table in a modern office" />
          </figure>
        </div>
      </section>

      <section className="amk-page-section">
        <div className="amk-shell">
          <div className="amk-page-section__grid">
            <div>
              <p className="amk-eyebrow">FROM ZERO TO USEFUL</p>
              <h2>A guided setup with clear boundaries.</h2>
            </div>
            <div className="amk-page-section__copy">
              <p>Amarktai Network Sales Assistant is designed to become useful without asking the company to rebuild its sales operation around a new CRM.</p>
              <p>The CRM stays the system of record. Sales Assistant learns enough about the business and the connected customer context to help the salesperson decide, prepare, communicate and follow through.</p>
            </div>
          </div>
          <div className="amk-page-lines">
            {setup.map(([number, title, copy]) => (
              <div className="amk-page-line" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-page-section amk-page-section--soft">
        <div className="amk-shell amk-page-section__grid">
          <div>
            <p className="amk-eyebrow">INDIVIDUALS AND TEAMS</p>
            <h2>Share company truth. Keep personal selling personal.</h2>
          </div>
          <div className="amk-page-section__copy">
            <p><strong>Individual salesperson:</strong> complete personal onboarding, add business context where needed, connect your own CRM access and work from your own sales workspace.</p>
            <p><strong>Company or team:</strong> the first owner or manager completes the shared company setup and approves company knowledge. Later team members inherit that approved context, but still complete their own onboarding and use their own CRM identity and credentials where required.</p>
            <p>Private Assistant conversations, reminders and personal sales work are not treated as a shared company chat.</p>
          </div>
        </div>
      </section>

      <section className="amk-page-section amk-page-section--warm">
        <div className="amk-shell amk-story__grid amk-story__grid--reverse">
          <div className="amk-story__copy">
            <p className="amk-eyebrow">THE DAILY WORKSPACE</p>
            <h2>Today → Customer → Conversation → Follow-through.</h2>
            <p>Sales Assistant keeps the daily experience deliberately small. Today shows what needs attention. Customers hold the working context. Assistant handles natural-language help. Calls support the conversation. CRM keeps the underlying record true.</p>
            <p>Deeper management and setup functions remain available when they are needed, but they do not have to dominate the salesperson's normal day.</p>
          </div>
          <figure className="amk-photo amk-photo--story">
            <img src={CALL_PHOTO} alt="Sales professional on a customer phone call with a laptop" loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div><p className="amk-eyebrow">READY WHEN YOU ARE</p><h2>Connect the CRM you already trust.</h2></div>
          <div><p>Tell us which CRM you use and whether you are setting up one salesperson or a team.</p><div className="amk-actions"><Link href="/contact" className="amk-button amk-button--light">Contact Amarktai Network</Link></div></div>
        </div>
      </section>
    </MarketingLayout>
  );
}

// Legacy public URLs resolve to the single maintained explanation page.
export function ProductPage() { return <HowItWorksPage />; }
export function IndividualsPage() { return <HowItWorksPage />; }
export function TeamsPage() { return <HowItWorksPage />; }
export function IntegrationsPage() { return <HowItWorksPage />; }
