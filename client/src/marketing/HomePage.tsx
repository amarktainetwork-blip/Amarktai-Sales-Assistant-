import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const loop = [
  ["01", "Learn the business", "Amarktai reads the approved website and company information, then turns it into grounded sales context."],
  ["02", "Understand the customer", "Customer history, ownership, tasks, opportunities and recent activity come from the CRM instead of being guessed."],
  ["03", "Prepare the conversation", "The salesperson gets a concise brief, talking points and the reason this customer needs attention now."],
  ["04", "Assist through the call", "Consented transcription, useful context and live prompts help the salesperson stay in the conversation."],
  ["05", "Finish the follow-through", "Notes, callbacks, tasks, messages and opportunity updates can be prepared from the confirmed outcome."],
  ["06", "Verify the result", "Important CRM actions are read back before Amarktai says the work is complete."],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="site-hero">
        <div className="site-shell site-hero__grid">
          <div>
            <p className="site-eyebrow"><Sparkles size={15}/> AI sales assistant built around the real sales day</p>
            <h1>Your salesperson.<br/><span>With an AI operator beside them.</span></h1>
            <p className="site-lead">
              Amarktai learns the business, works beside the CRM and helps each salesperson decide what matters, prepare better conversations, work through calls and finish the follow-through without losing the customer record.
            </p>
            <div className="site-actions">
              <Link href={accountLinks.getStarted} className="site-button site-button--primary">Start with Amarktai <ArrowRight size={17}/></Link>
              <Link href="/product" className="site-button site-button--secondary">Explore the product</Link>
            </div>
            <div className="site-proofline">
              <span><Check size={15}/> Keep your CRM</span>
              <span><Check size={15}/> Personal user logins</span>
              <span><Check size={15}/> Review and CRM readback</span>
            </div>
          </div>
          <div>
            <figure className="site-hero__visual">
              <img src="/images/site-hero.svg" alt="Salesperson working with an abstract AI assistant" />
            </figure>
            <p className="site-caption">AI around the salesperson — not another CRM to maintain.</p>
          </div>
        </div>
      </section>

      <section className="site-band">
        <div className="site-shell site-band__inner">
          <strong>One operating layer around the sales work.</strong>
          <div className="site-band__trail">
            <span>Company knowledge</span><span>CRM context</span><span>Calls</span><span>Follow-up</span><span>Readback</span><span>Manager visibility</span>
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-shell site-section__intro">
          <div>
            <p className="site-eyebrow">WHY IT EXISTS</p>
            <h2>The CRM is not the problem. The work around it is.</h2>
          </div>
          <div className="site-section__copy">
            <p>Salespeople lose time reconstructing context, deciding who needs attention, preparing calls, remembering commitments and then updating the CRM after the conversation.</p>
            <p><strong>Amarktai brings those jobs into one guided sales day.</strong> It does not ask the team to abandon the CRM. It helps them use the CRM better while keeping the actual customer record where the business already trusts it.</p>
          </div>
        </div>
      </section>

      <section className="site-section site-section--cloud">
        <div className="site-shell site-split">
          <div className="site-copy">
            <p className="site-eyebrow">FIRST, IT LEARNS THE BUSINESS</p>
            <h2>Company context that is useful, reviewed and grounded.</h2>
            <p>On first setup, Amarktai can read the authorised company website, use GenX to reason across the retained evidence and prepare structured company intelligence for review. Approved facts become shared company knowledge; comparison or uncertain claims stay untrusted until reviewed.</p>
            <ul className="site-checks">
              <li><Check size={16}/> Website evidence stays tied to its source page.</li>
              <li><Check size={16}/> AI helps understand the site instead of treating every sentence as equal.</li>
              <li><Check size={16}/> The company approves what salespeople are allowed to rely on.</li>
            </ul>
            <div className="site-actions"><Link href="/how-it-works" className="site-button site-button--soft">See the setup flow <ArrowRight size={16}/></Link></div>
          </div>
          <figure className="site-visual"><img src="/images/site-intelligence.svg" alt="Illustration of company website information being connected into structured knowledge"/></figure>
        </div>
      </section>

      <section className="site-section site-section--cream">
        <div className="site-shell site-split site-split--reverse">
          <figure className="site-visual"><img src="/images/site-calls.svg" alt="Illustration of a salesperson using a live call assistant"/></figure>
          <div className="site-copy">
            <p className="site-eyebrow">BEFORE, DURING AND AFTER THE CALL</p>
            <h2>Less screen-hunting. More listening.</h2>
            <p>Before the conversation, Amarktai can assemble the customer context and talking points. During a consented call, the live companion can transcribe and surface useful prompts. After the call, the confirmed outcome can become the next CRM action instead of another admin session.</p>
            <ul className="site-checks">
              <li><Check size={16}/> Pre-call brief from real company and CRM context.</li>
              <li><Check size={16}/> Live transcription and useful prompts where enabled.</li>
              <li><Check size={16}/> Call closeout, notes, tasks and next commitments remain connected.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-shell">
          <p className="site-eyebrow">THE OPERATING LOOP</p>
          <h2>Everything around the sale, in one rhythm.</h2>
          <div className="site-rail">
            {loop.map(([number,title,copy]) => (
              <div className="site-rail__row" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section--mint">
        <div className="site-shell site-split">
          <div className="site-copy">
            <p className="site-eyebrow">BUILT FOR INDIVIDUALS AND TEAMS</p>
            <h2>Shared company knowledge. Personal sales workspaces.</h2>
            <p>The company can approve knowledge, policies and the CRM definition once. Every salesperson still gets their own Amarktai account, private Assistant context and personal CRM identity/credentials. Managers get the team view without turning private salesperson work into a shared chat room.</p>
            <div className="site-actions">
              <Link href="/individuals" className="site-button site-button--secondary">For individuals</Link>
              <Link href="/teams" className="site-button site-button--primary">For teams</Link>
            </div>
          </div>
          <figure className="site-visual"><img src="/images/site-team.svg" alt="Illustration of a connected sales team with separate personal workspaces"/></figure>
        </div>
      </section>

      <section className="site-quote">
        <div className="site-shell site-quote__inner">
          <small>CRM FIRST</small>
          <p>Contacts, tasks, opportunities and commitments stay in the connected CRM. Amarktai works around the record, and important writes are verified before the user is told they succeeded.</p>
        </div>
      </section>

      <section className="site-section site-section--canvas">
        <div className="site-shell site-section__intro">
          <div><p className="site-eyebrow">CRM CONNECTIONS</p><h2>Designed to sit beside the system you already use.</h2></div>
          <div className="site-section__copy">
            <p>Genie is the first live customer commissioning path. The platform also contains connectors for HubSpot, Salesforce, Pipedrive and Zoho, plus controlled browser CRM support where appropriate.</p>
            <p>We only call a CRM capability ready when the actual connected system has been tested and the operation has retained proof.</p>
            <Link href="/integrations" className="site-button site-button--secondary">Explore CRM connections <ArrowRight size={16}/></Link>
          </div>
        </div>
      </section>

      <section className="site-final">
        <div className="site-shell site-final__inner">
          <div><p className="site-eyebrow">PRICED IN SOUTH AFRICAN RAND</p><h2>Start with one seller. Grow into the team.</h2></div>
          <div className="site-final__action"><p>Plans start at R499/month. AI-heavy work uses included credits and optional top-ups, while routine deterministic CRM work does not burn AI credits unnecessarily.</p><Link href="/pricing" className="site-button site-button--primary">See pricing in ZAR <ArrowRight size={16}/></Link></div>
        </div>
      </section>
    </MarketingLayout>
  );
}
