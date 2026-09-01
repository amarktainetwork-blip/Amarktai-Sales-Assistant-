import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const TEAM_PHOTO = "https://images.pexels.com/photos/8068833/pexels-photo-8068833.jpeg?cs=srgb&dl=pexels-edmond-dantes-8068833.jpg&fm=jpg";
const CALL_PHOTO = "https://images.pexels.com/photos/14596539/pexels-photo-14596539.jpeg?cs=srgb&dl=pexels-karen-slack-3606218-14596539.jpg&fm=jpg";

const setup = [
  ["01", "Create your personal workspace", "Every salesperson signs in with their own account. Team members can share approved company knowledge without sharing one Assistant identity or one set of CRM credentials."],
  ["02", "Teach Amarktai the business", "Give Amarktai the authorised company website and basic business details. It organises useful sales knowledge and asks a manager to review what the team should trust."],
  ["03", "Connect the CRM you already use", "Keep the CRM that already holds your customer records. Where a direct connection is available, connect it securely. For supported browser-based CRMs, the user signs in on the real CRM page instead of pasting a password into Amarktai."],
  ["04", "Let Amarktai learn the safe working flow", "Before relying on CRM actions, Sales Assistant checks what the connected system can actually read and do. That lets the workspace adapt to the real CRM instead of assuming every system behaves the same way."],
  ["05", "Start each day with the work that matters", "Today highlights attention points. Customers brings the relationship together. Assistant helps you think and prepare. Calls supports the conversation. The confirmed outcome becomes the follow-through."],
] as const;

const contextLayers = [
  ["01", "Your business", "Approved products, services, customer fit, credentials, policies and useful company knowledge give the Assistant the language and context of the organisation."],
  ["02", "Your customer", "CRM history, ownership, opportunities, tasks, notes and recent activity help the salesperson understand the relationship without reconstructing it from scratch."],
  ["03", "The conversation", "Preparation, consented live transcription and call assistance help the salesperson stay present while useful details are carried into the closeout."],
  ["04", "The next commitment", "Amarktai turns the confirmed outcome into visible next steps such as notes, callbacks, tasks or customer updates, with review around important changes."],
] as const;

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <section
        className="amk-page-hero"
        style={{ paddingTop: "clamp(96px, 9vw, 132px)" }}
      >
        <div className="amk-shell amk-page-hero__grid">
          <div>
            <p className="amk-eyebrow">HOW AMARKTAI WORKS</p>
            <h1>Keep your CRM.<br/>Connect the rest of the sales day.</h1>
            <p>Sales Assistant is built for the work that normally happens around the CRM: learning the business, deciding who needs attention, understanding the customer, preparing the conversation, helping through the call and completing the follow-through.</p>
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
              <p className="amk-eyebrow">FROM SETUP TO USEFUL</p>
              <h2>Five steps. No CRM replacement project.</h2>
            </div>
            <div className="amk-page-section__copy">
              <p>Amarktai starts with the sales operation you already have. The company teaches it the shared business context once, each salesperson keeps a personal workspace, and the existing CRM remains the customer record.</p>
              <p>The goal is simple: reduce the amount of remembering, searching, copying and catching up that sits between a salesperson and the next useful customer conversation.</p>
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
        <div className="amk-shell">
          <div className="amk-page-section__grid">
            <div>
              <p className="amk-eyebrow">WHAT MAKES IT DIFFERENT</p>
              <h2>Four kinds of context become one customer story.</h2>
            </div>
            <div className="amk-page-section__copy">
              <p>A chat assistant that only knows the CRM can still miss what the company sells. A call tool can understand the conversation without owning the follow-through. A knowledge tool can know the business without knowing this customer.</p>
              <p>Amarktai is designed to connect all four: business knowledge, CRM context, the live conversation and the confirmed next action.</p>
            </div>
          </div>
          <div className="amk-page-lines">
            {contextLayers.map(([number, title, copy]) => (
              <div className="amk-page-line" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="amk-page-section">
        <div className="amk-shell amk-page-section__grid">
          <div>
            <p className="amk-eyebrow">INDIVIDUALS AND TEAMS</p>
            <h2>Share company truth. Keep personal selling personal.</h2>
          </div>
          <div className="amk-page-section__copy">
            <p><strong>For one salesperson:</strong> set up your business context, connect your CRM access and work from one personal sales workspace.</p>
            <p><strong>For a team:</strong> a manager approves the shared company knowledge once. Each salesperson then gets their own login, CRM identity and working context while the team stays aligned on the same business information.</p>
            <p>Personal Assistant conversations and day-to-day customer work are not treated as one shared team chat.</p>
          </div>
        </div>
      </section>

      <section className="amk-page-section amk-page-section--warm">
        <div className="amk-shell amk-story__grid amk-story__grid--reverse">
          <div className="amk-story__copy">
            <p className="amk-eyebrow">THE DAILY WORKSPACE</p>
            <h2>Know what matters. Know the customer. Have the conversation. Finish the job.</h2>
            <p>Sales Assistant keeps the daily experience deliberately small. Today gives the salesperson a starting point. Customers holds the relationship context. Assistant helps with questions, preparation and follow-through. Calls supports consented customer conversations.</p>
            <p>Setup, team management and deeper controls stay available when they are needed without taking over the salesperson's normal day.</p>
          </div>
          <figure className="amk-photo amk-photo--story">
            <img src={CALL_PHOTO} alt="Sales professional on a customer phone call with a laptop" loading="lazy" />
          </figure>
        </div>
      </section>

      <section className="amk-cta">
        <div className="amk-shell amk-cta__inner">
          <div><p className="amk-eyebrow">YOUR CRM STAYS YOUR CRM</p><h2>Add the working layer your salespeople actually feel every day.</h2></div>
          <div><p>Tell us which CRM you use and whether you are setting up one salesperson or a team. We will show you where Amarktai fits.</p><div className="amk-actions"><Link href="/contact" className="amk-button amk-button--light">Talk to Amarktai Network</Link></div></div>
        </div>
      </section>
    </MarketingLayout>
  );
}

// Legacy public URLs resolve to the maintained product explanation page.
export function ProductPage() { return <HowItWorksPage />; }
export function IndividualsPage() { return <HowItWorksPage />; }
export function TeamsPage() { return <HowItWorksPage />; }
export function IntegrationsPage() { return <HowItWorksPage />; }
