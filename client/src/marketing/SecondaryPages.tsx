import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

function PageHero({
  eyebrow,
  title,
  accent,
  copy,
  image,
  alt,
  primary = "Start free",
  primaryHref = accountLinks.getStarted,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  copy: string;
  image: string;
  alt: string;
  primary?: string;
  primaryHref?: string;
}) {
  return (
    <section className="site-page-hero">
      <div className="site-shell site-page-hero__grid">
        <div>
          <p className="site-eyebrow">{eyebrow}</p>
          <h1>{title}<br/>{accent ? <span>{accent}</span> : null}</h1>
          <p className="site-lead">{copy}</p>
          <div className="site-actions">
            <Link href={primaryHref} className="site-button site-button--primary">{primary} <ArrowRight size={16}/></Link>
            <Link href="/contact" className="site-button site-button--secondary">Talk to us</Link>
          </div>
        </div>
        <figure className="site-page-hero__art"><img src={image} alt={alt}/></figure>
      </div>
    </section>
  );
}

function Rail({ items }: { items: ReadonlyArray<readonly [string,string]> }) {
  return (
    <div className="site-rail">
      {items.map(([title,copy],index) => (
        <div className="site-rail__row" key={title}>
          <span>{String(index+1).padStart(2,"0")}</span><h3>{title}</h3><p>{copy}</p>
        </div>
      ))}
    </div>
  );
}

function FinalCTA({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="site-final">
      <div className="site-shell site-final__inner">
        <div><p className="site-eyebrow">READY WHEN YOU ARE</p><h2>{title}</h2></div>
        <div className="site-final__action"><p>{copy}</p><Link href={accountLinks.getStarted} className="site-button site-button--primary">Create your workspace <ArrowRight size={16}/></Link></div>
      </div>
    </section>
  );
}

export function ProductPage() {
  const capabilities = [
    ["Today / next best action", "A focused starting point built from due work, stale opportunities, callbacks and CRM ownership instead of an empty analytics dashboard."],
    ["Customer context", "See the customer record, recent activity, open commitments and opportunity context without rebuilding the story by hand."],
    ["Amarktai Assistant", "Ask natural-language sales questions, prepare work and keep approved business context close to the customer you are working on."],
    ["Live calls", "Prepare the conversation, use consented transcription and prompts where enabled, then turn the confirmed outcome into follow-through."],
    ["CRM actions", "Prepare notes, tasks, callbacks, opportunity updates and other proven CRM operations through controlled, auditable workflows."],
    ["Readback and audit", "Important writes are checked against the CRM after execution. Failures stay visible instead of being called success."],
    ["Company intelligence", "The first setup can use GenX to reason across authorised website evidence before facts are approved for sales use."],
    ["Manager visibility", "Team work, exceptions and follow-up attention can be viewed without exposing every salesperson's private Assistant conversation."],
  ] as const;
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="THE PRODUCT"
        title="A sales operating layer"
        accent="around the CRM you already trust."
        copy="Amarktai connects the daily jobs that usually live in separate tabs: customer context, priorities, calls, follow-up, CRM administration, business knowledge and manager visibility."
        image="/images/site-hero.svg"
        alt="Salesperson working with an AI assistant beside their existing sales systems"
      />
      <section className="site-quote"><div className="site-shell site-quote__inner"><small>THE PRINCIPLE</small><p>The salesperson should not have to become a CRM administrator just to have a good sales day.</p></div></section>
      <section className="site-section">
        <div className="site-shell">
          <div className="site-section__intro"><div><p className="site-eyebrow">ONE WORKING RHYTHM</p><h2>From “what should I do?” to a verified next step.</h2></div><div className="site-section__copy"><p>Amarktai is not a replacement CRM and it is not a collection of disconnected AI tools. The product is designed around the salesperson's sequence of work.</p><p>Every capability should either help the person understand what matters, have a better conversation, complete the follow-through or keep the system of record accurate.</p></div></div>
          <Rail items={capabilities}/>
        </div>
      </section>
      <section className="site-section site-section--cloud"><div className="site-shell site-split"><div className="site-copy"><p className="site-eyebrow">THE ASSISTANT</p><h2>Natural language on top of governed CRM work.</h2><p>The Assistant can answer safe CRM questions, prepare work and move into controlled actions. It does not get to invent a successful result: important writes require execution evidence and readback.</p><ul className="site-checks"><li><Check size={16}/> Ask about customers, opportunities, tasks and recent work.</li><li><Check size={16}/> Prepare calls, notes, callbacks and follow-up.</li><li><Check size={16}/> Keep risky or external actions reviewable.</li></ul></div><figure className="site-visual"><img src="/images/site-intelligence.svg" alt="Abstract illustration of AI reasoning and connected business context"/></figure></div></section>
      <FinalCTA title="Give the sales day one dependable workspace." copy="Start with one salesperson or build a shared company workspace with personal user accounts."/>
    </MarketingLayout>
  );
}

export function HowItWorksPage() {
  const setup = [
    ["Create the Amarktai account", "Every person has their own login. A company does not share one Sales Assistant account across the team."],
    ["Choose individual or company setup", "An individual supplies their own business context. A company owner or manager establishes the shared company setup."],
    ["Learn the business", "The authorised website can be crawled, reasoned over by GenX and converted into evidence-backed company intelligence for review."],
    ["Approve company knowledge", "Own offerings, policies and trusted facts are approved. Conflicts and comparison content stay visible for review."],
    ["Connect the CRM", "The company defines the CRM connection. Each salesperson still uses their own CRM identity and credentials where the system requires it."],
    ["Prove the capabilities", "Amarktai discovers and tests what the connected CRM can really do instead of assuming every connector supports every operation."],
    ["Start with Today", "The salesperson sees priorities, customers, calls and commitments that need attention now."],
    ["Work and verify", "Calls, follow-up and CRM actions remain auditable, and important writes are checked before completion is claimed."],
  ] as const;
  return (
    <MarketingLayout>
      <PageHero eyebrow="HOW IT WORKS" title="Set up once." accent="Then work from the sales day." copy="Amarktai separates shared company setup from each salesperson's own account, CRM identity and private working context." image="/images/site-intelligence.svg" alt="Illustration of website intelligence becoming structured company knowledge"/>
      <section className="site-section"><div className="site-shell"><div className="site-section__intro"><div><p className="site-eyebrow">FROM ZERO TO USEFUL</p><h2>A guided setup with clear boundaries.</h2></div><div className="site-section__copy"><p>Company knowledge should be shared. Passwords, personal CRM sessions and private Assistant conversations should not be.</p><p>The setup flow is built around that distinction from the beginning.</p></div></div><Rail items={setup}/></div></section>
      <section className="site-section site-section--cream"><div className="site-shell site-split site-split--reverse"><figure className="site-visual"><img src="/images/site-calls.svg" alt="Illustration of a salesperson using the live call assistant"/></figure><div className="site-copy"><p className="site-eyebrow">THE DAILY LOOP</p><h2>Prioritise. Prepare. Talk. Follow through. Verify.</h2><p>Once the setup is live, the product becomes much simpler. Start from Today, prepare the active customer, use the Assistant or call companion where useful, confirm the outcome and let the CRM record stay current.</p></div></div></section>
      <FinalCTA title="Do the setup once. Make the sales day easier every day after." copy="Start with your own workspace or bring the company through the guided setup."/>
    </MarketingLayout>
  );
}

export function IndividualsPage() {
  const benefits = [
    ["Know what needs attention", "A single Today view keeps callbacks, overdue work and the next prospect from disappearing into the CRM."],
    ["Arrive prepared", "Bring customer history and approved business context together before the call instead of searching for it live."],
    ["Use the Assistant privately", "Your working conversation, reminders and personal context stay attached to your own Amarktai account."],
    ["Finish the admin", "Turn a confirmed outcome into the note, callback, task or opportunity update that should happen next."],
    ["Keep the record honest", "The CRM remains the system of record, with readback for important writes."],
  ] as const;
  return (
    <MarketingLayout>
      <PageHero eyebrow="FOR INDIVIDUAL SALESPEOPLE" title="A calmer sales day." accent="Without another system to maintain." copy="For independent salespeople, consultants, founders and solo operators who need customer context, calls and follow-up to stay connected." image="/images/site-calls.svg" alt="Illustration of an individual salesperson working with a call assistant"/>
      <section className="site-section"><div className="site-shell site-section__intro"><div><p className="site-eyebrow">BUILT FOR THE PERSON DOING THE SELLING</p><h2>Less remembering. Less tab-hopping. More customer time.</h2></div><div className="site-section__copy"><p>Amarktai keeps the active customer, the business context and the next commitment close together. You do not need team-management screens or a second CRM.</p><p>Start with the work that matters now and move through the conversation without losing the follow-through.</p></div></div><Rail items={benefits}/></div></section>
      <section className="site-section site-section--cloud"><div className="site-shell site-split"><div className="site-copy"><p className="site-eyebrow">YOUR DATA, YOUR WORKSPACE</p><h2>Your Amarktai login and CRM identity belong to you.</h2><p>Even inside a company, individual work remains tied to the person doing it. That means personal CRM credentials where required, private Assistant context and a clear record of the work you performed.</p></div><figure className="site-visual"><img src="/images/site-hero.svg" alt="Illustration of a salesperson with a personal AI workspace"/></figure></div></section>
      <FinalCTA title="Give your sales day one place to start." copy="Create an individual workspace and connect the CRM you already use."/>
    </MarketingLayout>
  );
}

export function TeamsPage() {
  const team = [
    ["Shared company intelligence", "Approved products, services, policies and company context are learned once and shared appropriately across the organisation."],
    ["Personal salesperson accounts", "Every team member has their own Amarktai login and personal working context rather than one shared company session."],
    ["Personal CRM identity", "The CRM connection belongs to the organisation, but individual identity and credentials remain attached to the person where the CRM requires it."],
    ["Consistent sales rhythm", "Today, preparation, calls, follow-through and CRM readback give the team one operating pattern without forcing identical conversations."],
    ["Manager attention view", "Managers can see workload, overdue follow-up, exceptions and performance context without reading every salesperson's private Assistant chat."],
    ["Governance and audit", "Controlled actions, approvals, evidence and failures remain visible instead of disappearing into automation."],
  ] as const;
  return (
    <MarketingLayout>
      <PageHero eyebrow="FOR SALES TEAMS" title="One company setup." accent="Personal workspaces for every seller." copy="Give the team approved company context and a consistent sales operating rhythm without shared passwords or a shared AI conversation." image="/images/site-team.svg" alt="Illustration of a sales team connected through shared company context" primary="Set up a team"/>
      <section className="site-quote"><div className="site-shell site-quote__inner"><small>TEAM DESIGN</small><p>Share what should be shared. Keep the salesperson's login, CRM identity and private working context personal.</p></div></section>
      <section className="site-section"><div className="site-shell"><div className="site-section__intro"><div><p className="site-eyebrow">THE TEAM MODEL</p><h2>Consistency without turning sales into a factory line.</h2></div><div className="site-section__copy"><p>Amarktai gives the company one source of approved knowledge and operating policy while allowing each salesperson to work through their own customers and conversations.</p><p>Managers get visibility into where attention is needed; salespeople keep a workspace that is actually theirs.</p></div></div><Rail items={team}/></div></section>
      <FinalCTA title="Set up the company once. Give every salesperson their own workspace." copy="Talk to us about team onboarding, CRM compatibility and the right plan for your sales organisation."/>
    </MarketingLayout>
  );
}

export function IntegrationsPage() {
  const integrations = [
    ["Genie", "Browser CRM commissioning", "The first live customer path. Guided authentication, retained browser session, discovered operations and proof-based readiness."],
    ["HubSpot", "Native OAuth connector", "Contacts, companies, opportunities, tasks and activities through supported HubSpot scopes when OAuth is configured."],
    ["Salesforce", "Native OAuth connector", "Supported contacts, accounts, opportunities, tasks and activities through the connected Salesforce organisation."],
    ["Pipedrive", "Native OAuth connector", "Supported people, organisations, deals, activities and user context through an authorised Pipedrive connection."],
    ["Zoho CRM", "Native OAuth connector", "Supported contacts, tasks, deals and current-user context through authorised Zoho CRM access."],
    ["Authorised browser CRM", "Compatibility-led connector", "Suitable web CRMs can use the controlled browser runtime where the workflows can be learned, tested and safely verified."],
  ] as const;
  return (
    <MarketingLayout>
      <PageHero eyebrow="CRM CONNECTIONS" title="Keep the CRM." accent="Add a sales operating layer around it." copy="Amarktai is designed to sit beside the system of record, discover the operations that are actually available and only call a capability ready after it has been tested." image="/images/site-intelligence.svg" alt="Illustration of connected systems and structured business data" primary="Discuss your CRM" primaryHref="/contact"/>
      <section className="site-section"><div className="site-shell"><div className="site-section__intro"><div><p className="site-eyebrow">PROOF BEFORE CLAIMS</p><h2>A connector existing in code is not the same as a live CRM being proven.</h2></div><div className="site-section__copy"><p>Amarktai tracks readiness at the connected-system level. Authentication, reads, writes, tasks, notes, pipeline operations and communication capabilities are verified against the actual CRM instead of being assumed from a generic connector list.</p></div></div><div className="site-crm-list">{integrations.map(([name,status,copy])=><div className="site-crm" key={name}><strong>{name}</strong><span>{status}</span><p>{copy}</p></div>)}</div></div></section>
      <section className="site-section site-section--mint"><div className="site-shell site-split"><div className="site-copy"><p className="site-eyebrow">YOUR CRM STAYS THE SOURCE OF TRUTH</p><h2>AI can prepare the work. The record still matters.</h2><p>Important CRM actions are executed through the connected adapter and then checked where a deterministic post-condition exists. A failed readback is not presented as a successful update.</p><ul className="site-checks"><li><Check size={16}/> Connection-specific capability discovery.</li><li><Check size={16}/> Controlled writes and approvals where appropriate.</li><li><Check size={16}/> Readback and retained evidence for important operations.</li></ul></div><figure className="site-visual"><img src="/images/site-hero.svg" alt="Illustration of a salesperson working beside existing business systems"/></figure></div></section>
      <FinalCTA title="Bring the CRM you already trust." copy="Tell us which CRM your team uses and we can confirm the appropriate connection path."/>
    </MarketingLayout>
  );
}
