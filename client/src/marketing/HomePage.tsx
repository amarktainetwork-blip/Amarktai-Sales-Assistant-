import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const HERO_PHOTO = "https://images.pexels.com/photos/8837770/pexels-photo-8837770.jpeg?cs=srgb&dl=pexels-yankrukov-8837770.jpg&fm=jpg";
const CALL_PHOTO = "https://images.pexels.com/photos/14596539/pexels-photo-14596539.jpeg?cs=srgb&dl=pexels-karen-slack-3606218-14596539.jpg&fm=jpg";
const TEAM_PHOTO = "https://images.pexels.com/photos/8068833/pexels-photo-8068833.jpeg?cs=srgb&dl=pexels-edmond-dantes-8068833.jpg&fm=jpg";

const salesDay = [
  ["01", "Learn the business", "Amarktai turns approved company information and website evidence into reviewed sales context."],
  ["02", "Know what matters now", "CRM ownership, activity, tasks and opportunities shape a focused Today view instead of another empty dashboard."],
  ["03", "Prepare and sell", "Bring the customer story, talking points and the next commitment into the conversation before the call starts."],
  ["04", "Follow through", "Turn the confirmed outcome into notes, callbacks, tasks and CRM updates, then verify important writes."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="amk-hero">
        <div className="amk-shell amk-hero__grid">
          <div className="amk-hero__copy">
            <p className="amk-eyebrow">AMARKTAI NETWORK · SALES ASSISTANT</p>
            <h1>A clearer sales day.<br/><span>Built around the CRM you already use.</span></h1>
            <p className="amk-lead">
              Sales Assistant learns the business, understands the customer context and helps each salesperson prepare, call, follow through and keep the CRM accurate — without replacing the system your company already trusts.
            </p>
            <div className="amk-actions">
              <Link href={accountLinks.getStarted} className="amk-button amk-button--primary">Start free <ArrowRight size={17}/></Link>
              <Link href="/how-it-works" className="amk-text-link">See how it works <ArrowRight size={16}/></Link>
            </div>
            <div className="amk-proofline" aria-label="Product principles">
              <span><Check size={15}/> Keep your CRM</span>
              <span><Check size={15}/> Personal user accounts</span>
              <span><Check size={15}/> Review and readback</span>
            </div>
          </div>
          <figure className="amk-photo amk-photo--hero">
            <img src={HERO_PHOTO} alt="Sales professionals working together in a modern office" />
          </figure>
        </div>
      </section>

      <section className="amk-intro">
        <div className="amk-shell amk-intro__grid">
          <p className="amk-overline">WHAT AMARKTAI CHANGES</p>
          <h2>The CRM holds the record. Sales Assistant makes the work around it easier.</h2>
          <div className="amk-intro__copy">
            <p>Salespeople lose time reconstructing customer context, deciding who needs attention, preparing conversations, remembering commitments and then updating the CRM after the call.</p>
            <p>Amarktai Network Sales Assistant connects those jobs into one working rhythm so the salesperson can spend more time selling and less time rebuilding the story.</p>
          </div>
        </div>
      </section>

      <section className="amk-story amk-story--soft">
        <div className="amk-shell amk-story__grid">
          <figure className="amk-photo amk-photo--story">
            <img src={TEAM_PHOTO} alt="Sales team collaborating in a modern office" loading="lazy" />
          </figure>
          <div className="amk-story__copy">
            <p className="amk-eyebrow">LEARN THE BUSINESS ONCE</p>
            <h2>Company knowledge that salespeople can actually use.</h2>
            <p>During setup, Amarktai can read the authorised company website and reason across the retained evidence. The result is reviewed company intelligence — products, services, pricing signals, policies and useful sales context — rather than a blind scrape dumped into a database.</p>
            <p>Approved company knowledge can be shared across the team. Each salesperson still keeps their own login, private Assistant context and CRM identity.</p>
            <Link href="/how-it-works" className="amk-text-link">See the setup and CRM flow <ArrowRight size={16}/></Link>
          </div>
        </div>
      </section>

      <section className="amk-flow">
        <div className="amk-shell">
          <div className="amk-section-head">
            <p className="amk-eyebrow">THE SALES DAY</p>
            <h2>One simple flow from “what should I do?” to a verified next step.</h2>
          </div>
          <div className="amk-flow__rows">
            {salesDay.map(([number, title, copy]) => (
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
            <p>Before a call, Sales Assistant can bring together CRM history, business context and talking points. During consented calls, the live companion can transcribe and surface useful prompts. After the call, the confirmed outcome becomes the follow-through.</p>
            <div className="amk-inline-list">
              <span>Pre-call context</span>
              <span>Live transcription</span>
              <span>Useful prompts</span>
              <span>Notes and callbacks</span>
              <span>CRM readback</span>
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
            <p className="amk-eyebrow">CRM FIRST</p>
            <h2>Your customer record stays where it belongs.</h2>
          </div>
          <div>
            <p>Sales Assistant is an operating layer around the CRM, not a replacement CRM. Important actions stay governed and auditable, and deterministic writes are checked before the user is told that the work succeeded.</p>
            <p className="amk-trust__systems">Genie · HubSpot · Salesforce · Pipedrive · Zoho · authorised browser CRMs</p>
          </div>
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div>
            <p className="amk-eyebrow">AMARKTAI NETWORK</p>
            <h2>Give the sales day one dependable place to start.</h2>
          </div>
          <div>
            <p>Start with one salesperson or set up the company once and give every seller a personal workspace.</p>
            <div className="amk-actions">
              <Link href="/pricing" className="amk-button amk-button--light">See pricing</Link>
              <Link href="/contact" className="amk-text-link amk-text-link--light">Talk to us <ArrowRight size={16}/></Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
