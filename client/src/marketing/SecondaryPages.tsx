import {
  Activity,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Headphones,
  ListChecks,
  Mail,
  Map,
  MessageCircle,
  MessagesSquare,
  Network,
  PhoneCall,
  Radar,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import { Link } from "wouter";
import {
  BrowserWindow,
  CTASection,
  FeatureCard,
  MiniStatus,
  PageHero,
  SectionHeader,
  TickList,
} from "./MarketingComponents";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";
import {
  AI_CREDIT_ECONOMICS,
  AI_CREDIT_FEATURES,
  PRICING_PLANS,
  ZERO_AI_CREDIT_FEATURES,
} from "@shared/pricing";

const productFeatures = [
  [
    Target,
    "Today / Next Prospect",
    "Start with the customer, callback or task that deserves attention now—and understand why.",
  ],
  [
    BookOpenCheck,
    "Business Knowledge",
    "Give every conversation approved context about the company, products, services and policies.",
  ],
  [
    BriefcaseBusiness,
    "Pre-call Preparation",
    "Bring together customer history, the current task and useful talking points before the call.",
  ],
  [
    Headphones,
    "Live Call Companion",
    "Capture consented call context, transcription and useful prompts while the conversation is happening.",
  ],
  [
    Sparkles,
    "Amarktai Assistant",
    "Ask about the active prospect, prepare follow-up or turn a confirmed outcome into the next action.",
  ],
  [
    CalendarCheck,
    "Follow-ups",
    "Keep callbacks, tasks and commitments visible until the work is finished.",
  ],
  [
    Workflow,
    "CRM Administration",
    "Prepare notes, tasks, status changes and other available CRM work in the same flow.",
  ],
  [
    MessagesSquare,
    "Email, SMS and WhatsApp",
    "Prepare and review customer communication through capabilities available in the connected CRM.",
  ],
  [
    ListChecks,
    "Tasks and Callbacks",
    "Create, complete and revisit the work that keeps opportunities moving.",
  ],
  [
    Activity,
    "Pipeline and Opportunities",
    "Use connected opportunity context without inventing stages or asking sellers to research twice.",
  ],
  [
    Users,
    "Team Visibility",
    "Help managers see workload, follow-up attention and where coaching could unblock progress.",
  ],
  [
    ShieldCheck,
    "Automation and Approvals",
    "Keep important external actions reviewable and make failures visible in the workflow.",
  ],
  [
    BarChart3,
    "Reports and Audit",
    "Understand activity, outcomes and action history without losing the story behind the number.",
  ],
] as const;

const journey = [
  [
    "01",
    "Create a workspace",
    "Open a secure Amarktai Sales Assistant workspace.",
  ],
  ["02", "Choose your setup", "Select Just me or My company / sales team."],
  [
    "03",
    "Add the business",
    "Share the company information and authorised website.",
  ],
  [
    "04",
    "Review what Amarktai learns",
    "Confirm the products, services and facts the workspace may use.",
  ],
  [
    "05",
    "Connect the CRM",
    "Choose the system the salesperson already works in.",
  ],
  [
    "06",
    "Test the connection",
    "Confirm the available customer, task and communication workflows.",
  ],
  [
    "07",
    "Start with Today",
    "See the next priority instead of an empty technical dashboard.",
  ],
  [
    "08",
    "Prepare the prospect",
    "Open the customer context and a concise pre-call brief.",
  ],
  [
    "09",
    "Call and follow up",
    "Capture the outcome and prepare the appropriate next action.",
  ],
  [
    "10",
    "Keep the CRM updated",
    "Review the administration and move to the next prospect.",
  ],
] as const;

const individualBenefits = [
  [
    Map,
    "Your day organised",
    "See callbacks, follow-ups and the next prospect in one focused view.",
  ],
  [
    Target,
    "Next prospect",
    "Understand who to contact next and why the conversation matters.",
  ],
  [
    BriefcaseBusiness,
    "Pre-call preparation",
    "Arrive with customer history and relevant company information already assembled.",
  ],
  [
    Headphones,
    "Call assistance",
    "Capture notes and use consented transcription and assistance where enabled.",
  ],
  [
    Send,
    "Follow-up",
    "Turn the confirmed outcome into a clear next task or message.",
  ],
  [
    ClipboardCheck,
    "CRM administration",
    "Keep notes, tasks and status work connected to the conversation.",
  ],
  [
    BarChart3,
    "Personal visibility",
    "See your activity, outcomes and open commitments without management clutter.",
  ],
] as const;

const teamBenefits = [
  [
    BookOpenCheck,
    "Shared business knowledge",
    "Give every salesperson the same approved product and company context.",
  ],
  [
    UserCheck,
    "Team onboarding",
    "Guide new team members into one consistent way of preparing and following through.",
  ],
  [
    Network,
    "CRM owner mappings",
    "Connect customer ownership to the people responsible for the work.",
  ],
  [
    Workflow,
    "One sales workflow",
    "Use the same rhythm from Today to call closeout across the team.",
  ],
  [
    Clock3,
    "Follow-up visibility",
    "See overdue work and commitments that need attention.",
  ],
  [
    Radar,
    "Manager overview",
    "Focus on exceptions and where support will make a difference.",
  ],
  [
    Headphones,
    "Coaching and QA",
    "Review appropriate call evidence and help salespeople improve.",
  ],
  [
    ShieldCheck,
    "Approvals",
    "Keep controlled actions and important decisions visible.",
  ],
  [
    BarChart3,
    "Reporting",
    "Understand workload, progress and outcomes without losing operating context.",
  ],
] as const;

const integrations = [
  [
    "GE",
    "Genie",
    "Available browser connector",
    "Guided sign-in, learning, testing and evidence-based readiness for authorised Genie workflows.",
  ],
  [
    "HS",
    "HubSpot",
    "Available connector",
    "Connect supported HubSpot customer, task and opportunity context when OAuth is configured.",
  ],
  [
    "SF",
    "Salesforce",
    "Available connector",
    "Use supported Salesforce records and workflows through an authorised connection.",
  ],
  [
    "PD",
    "Pipedrive",
    "Available connector",
    "Bring supported people, activities and deals into the daily sales workflow.",
  ],
  [
    "ZO",
    "Zoho CRM",
    "Available connector",
    "Connect supported contacts, tasks and deals through an authorised Zoho CRM setup.",
  ],
  [
    "+",
    "Other CRM",
    "Compatibility review required",
    "Set up a permitted web CRM through the controlled browser connection where suitable.",
  ],
] as const;

function Preview({
  title,
  items,
}: {
  title: string;
  items: Array<[string, string]>;
}) {
  return (
    <BrowserWindow label={title}>
      <div className="marketing-preview-head">
        <div>
          <small>Sales workspace</small>
          <strong>{title}</strong>
        </div>
        <span>Ready</span>
      </div>
      {items.map(([label, copy], index) => (
        <MiniStatus
          key={label}
          active={index === 0}
          label={label}
          copy={copy}
        />
      ))}
    </BrowserWindow>
  );
}

export function ProductPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="The complete sales workspace"
        title={
          <>
            Everything the sales day needs. <em>In one flow.</em>
          </>
        }
        copy="From the first priority to the final follow-up, Amarktai keeps customer context, conversations and CRM administration connected."
        secondary="See How It Works"
        secondaryHref="/how-it-works"
      >
        <Preview
          title="Product overview"
          items={[
            ["Today", "The next priority is clear"],
            ["Calls", "Context and closeout stay connected"],
            ["Assistant", "Ask from approved working context"],
            ["Follow-up", "Review and finish the work"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Product overview"
            title="Useful at every point in the sales day."
            copy="Each capability answers a practical question: what should I do, what do I need to know, and what must happen next?"
          />
          <div className="marketing-grid marketing-grid--3">
            {productFeatures.map(([icon, title, copy]) => (
              <FeatureCard key={title} icon={icon} title={title} copy={copy} />
            ))}
          </div>
        </div>
      </section>
      <CTASection
        title="Bring the whole sales day into focus."
        copy="Start with one salesperson or set up a shared workspace for the team."
      />
    </MarketingLayout>
  );
}

export function HowItWorksPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Easy from the first login"
        title={
          <>
            From setup to selling, <em>step by step.</em>
          </>
        }
        copy="Amarktai guides the business from a secure workspace and approved company knowledge into a clear daily sales workflow."
        secondary="Explore Product"
        secondaryHref="/product"
      >
        <Preview
          title="Workspace readiness"
          items={[
            ["Business", "Company information added"],
            ["Knowledge", "Review and approve discoveries"],
            ["CRM", "Connect and test workflows"],
            ["Today", "Start selling"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            eyebrow="The full journey"
            title="Ten clear steps. No technical training required."
            copy="Salespeople see familiar language and useful next steps while connection and safety details stay underneath."
          />
          <div className="marketing-steps-large">
            {journey.map(([number, title, copy]) => (
              <article className="marketing-step-large" key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <CTASection
        title="Start with the business. End with a clearer sales day."
        copy="Choose an individual or team workspace and let the guided setup lead the way."
      />
    </MarketingLayout>
  );
}

export function IndividualsPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="For individual salespeople"
        title={
          <>
            Spend more time selling. <em>Remember less.</em>
          </>
        }
        copy="A focused workspace for independent salespeople, consultants, small business owners and solo operators who need the next action to stay clear."
        primary="Get Started"
        secondary="See the Product"
        secondaryHref="/product"
      >
        <Preview
          title="My sales day"
          items={[
            ["Next prospect", "A customer is ready for follow-up"],
            ["Before the call", "Context and objective prepared"],
            ["After the call", "Outcome and next step confirmed"],
            ["Personal results", "Open commitments stay visible"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Focused on your work"
            title="Everything you need. None of the management clutter."
            copy="Use Amarktai as a calm Sales Assistant around the selling you already do."
          />
          <div className="marketing-grid marketing-grid--3">
            {individualBenefits.map(([icon, title, copy]) => (
              <FeatureCard key={title} icon={icon} title={title} copy={copy} />
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-split">
          <div>
            <SectionHeader
              eyebrow="Keep momentum"
              title="Move from conversation to commitment without losing the thread."
              copy="Customer context, the call outcome and follow-up stay part of the same sales story."
            />
            <TickList
              items={[
                "One clear priority at a time",
                "Approved business context close at hand",
                "Visible follow-up until it is done",
                "Personal reporting without team administration",
              ]}
            />
          </div>
          <div className="marketing-split__panel">
            <div className="marketing-knowledge-stack">
              <article>
                <small>Now</small>
                <strong>Prepare tomorrow's product consultation</strong>
              </article>
              <article>
                <small>Waiting for review</small>
                <strong>Follow-up email draft</strong>
              </article>
              <article>
                <small>Friday</small>
                <strong>Callback with confirmed context</strong>
              </article>
            </div>
          </div>
        </div>
      </section>
      <CTASection
        title="Give your sales day one dependable home."
        copy="Create an individual workspace and start with the work that matters next."
        secondary="Contact Us"
      />
    </MarketingLayout>
  );
}

export function TeamsPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="For sales teams and companies"
        title={
          <>
            One consistent workspace. <em>Better team visibility.</em>
          </>
        }
        copy="Give every salesperson approved company context and a clear workflow while managers see where attention, coaching and follow-through are needed."
        primary="Set up your team"
        secondary="How It Works"
        secondaryHref="/how-it-works"
      >
        <Preview
          title="Team attention"
          items={[
            ["Follow-up visibility", "Three commitments due today"],
            ["Workload", "One salesperson needs support"],
            ["Quality review", "Two completed calls ready"],
            ["CRM health", "Owner mapping requires attention"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="One core workspace"
            title="Consistent for the team. Useful for the manager."
            copy="Individuals stay focused on selling while managers get the visibility needed to support the operating rhythm."
          />
          <div className="marketing-grid marketing-grid--3">
            {teamBenefits.map(([icon, title, copy]) => (
              <FeatureCard key={title} icon={icon} title={title} copy={copy} />
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container marketing-split">
          <div className="marketing-split__panel">
            <div className="marketing-knowledge-stack">
              <article>
                <small>Shared context</small>
                <strong>Approved product and service knowledge</strong>
              </article>
              <article>
                <small>Manager attention</small>
                <strong>Overdue work and stalled follow-up</strong>
              </article>
              <article>
                <small>Assurance</small>
                <strong>Approvals, evidence and visible outcomes</strong>
              </article>
            </div>
          </div>
          <div>
            <SectionHeader
              eyebrow="Support, not surveillance"
              title="Help managers focus on the moments that need them."
              copy="Amarktai surfaces attention and operating evidence without pretending that raw activity is the same as good selling."
            />
            <TickList
              items={[
                "Workload and follow-up exceptions",
                "Appropriate coaching and quality review",
                "Pipeline and CRM attention",
                "Clear review queues and reports",
              ]}
            />
          </div>
        </div>
      </section>
      <CTASection
        title="Give the team one clear way to prepare and follow through."
        copy="Set up the company workspace, connect the CRM and bring the sales rhythm together."
        primary="Set up your team"
      />
    </MarketingLayout>
  );
}

export function IntegrationsPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Connect the system you already use"
        title={
          <>
            Keep your CRM. <em>Add a clearer sales day.</em>
          </>
        }
        copy="Amarktai brings authorised customer context and available sales workflows into one workspace without asking the business to replace its system."
        primary="Get Started"
        secondary="Contact about compatibility"
        secondaryHref="/contact"
      >
        <Preview
          title="Connection readiness"
          items={[
            ["Connect once", "Authorise the selected CRM"],
            ["Test", "Confirm available workflows"],
            ["Ready", "Use proven capabilities in the sales day"],
            ["Stay informed", "See when a connection needs attention"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="CRM connections"
            title="A familiar system underneath. A focused workspace on top."
            copy="Every connection is configured and tested for the functions the CRM actually makes available."
          />
          <div className="marketing-grid marketing-grid--3">
            {integrations.map(([initials, name, kind, copy]) => (
              <article className="marketing-card" key={name}>
                <span className="marketing-icon font-display text-xs font-bold">
                  {initials}
                </span>
                <p className="marketing-card__detail">{kind}</p>
                <h3>{name}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container">
          <SectionHeader
            eyebrow="Communication through the connected system"
            title="Use the channels available in your verified setup."
            copy="Email, SMS, WhatsApp, calling and calendar actions can be prepared where the selected CRM and configuration support them."
          />
          <div className="marketing-grid marketing-grid--4">
            <FeatureCard
              icon={Mail}
              title="Email"
              copy="Prepare and review CRM-native email where available."
            />
            <FeatureCard
              icon={MessageCircle}
              title="SMS and WhatsApp"
              copy="Use supported messaging channels through the connected CRM."
            />
            <FeatureCard
              icon={PhoneCall}
              title="Calls"
              copy="Open the available dialler or call flow after it passes setup."
            />
            <FeatureCard
              icon={CalendarCheck}
              title="Calendar"
              copy="Prepare supported appointment actions where configured."
            />
          </div>
          <p className="mt-7 text-sm font-bold text-[#92a9c8]">
            Available capabilities depend on the connected CRM and verified
            setup.
          </p>
        </div>
      </section>
      <CTASection
        title="Not sure whether your CRM fits?"
        copy="Tell us what your team uses and which sales workflows matter. We will discuss the appropriate setup path."
        primary="Contact Us"
        primaryHref="/contact"
        secondary="Get Started"
        secondaryHref={accountLinks.getStarted}
      />
    </MarketingLayout>
  );
}

export function PricingPage() {
  return (
    <MarketingLayout>
      <PageHero
        eyebrow="Plan structure"
        title={
          <>
            Simple plans for individuals and <em>sales teams.</em>
          </>
        }
        copy="Choose a monthly subscription for one salesperson or a team. Paid self-service checkout is not available yet; create a workspace for the trial or contact sales for assisted setup."
        primary="Contact Us"
        primaryHref="/contact"
        secondary="Get Started"
        secondaryHref={accountLinks.getStarted}
      >
        <Preview
          title="Plan fit"
          items={[
            ["Trial", "$0 · 50 AI credits"],
            ["Starter", "$29 · 500 AI credits"],
            ["Professional", "$79 · up to 3 users"],
            ["Team", "$199 · up to 10 users"],
          ]}
        />
      </PageHero>
      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Plans for real sales work"
            title="One source of truth for every plan."
            copy="Every subscription includes deterministic CRM work without AI-credit charges. AI credits are used only for language, transcript and reasoning features."
          />
          <div className="marketing-pricing-grid">
            {PRICING_PLANS.map(plan => (
              <article className="marketing-plan" key={plan.name}>
                <span className="marketing-plan__status">
                  {plan.monthlyUsdCents === 0
                    ? "Trial"
                    : "Monthly subscription"}
                </span>
                <h2>{plan.name}</h2>
                <p className="marketing-plan__price">
                  <strong>${plan.monthlyUsdCents / 100}</strong> / month
                </p>
                <p className="marketing-plan__audience">
                  {plan.includedUsers === 1
                    ? "1 included user"
                    : `Up to ${plan.includedUsers} included users`}{" "}
                  ·{" "}
                  {plan.crmConnections === "launch-crms"
                    ? "Available launch CRM connectors"
                    : `${plan.crmConnections} CRM connection`}
                </p>
                <p className="marketing-plan__summary">
                  {plan.includedAiCredits.toLocaleString()} included AI credits
                  each month
                  {plan.managementIntelligence
                    ? " · management intelligence included"
                    : ""}
                  .
                </p>
                <TickList items={plan.features} />
                <Link
                  href={
                    plan.key === "team" ? "/contact" : accountLinks.getStarted
                  }
                  className="marketing-button marketing-button--secondary"
                >
                  {plan.key === "trial"
                    ? "Start trial"
                    : plan.key === "team"
                      ? "Contact sales"
                      : "Create workspace"}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-container">
          <SectionHeader
            eyebrow="How AI credits work"
            title="Routine CRM work does not consume AI credits."
            copy={`Add 1,000 AI credits for $${AI_CREDIT_ECONOMICS.retailPackUsdCents / 100}. Top-ups and paid subscriptions are currently arranged with sales; the site does not claim an automated checkout.`}
          />
          <div className="marketing-grid marketing-grid--4">
            <FeatureCard
              icon={Users}
              title="Included without AI credits"
              copy={ZERO_AI_CREDIT_FEATURES.slice(0, 2).join(", ") + "."}
            />
            <FeatureCard
              icon={Network}
              title="Deterministic sales work"
              copy={ZERO_AI_CREDIT_FEATURES.slice(2, 5).join(", ") + "."}
            />
            <FeatureCard
              icon={Wrench}
              title="Uses AI credits"
              copy={AI_CREDIT_FEATURES.slice(0, 3).join(", ") + "."}
            />
            <FeatureCard
              icon={Sparkles}
              title="Advanced AI assistance"
              copy={AI_CREDIT_FEATURES.slice(3).join(", ") + "."}
            />
          </div>
        </div>
      </section>
      <CTASection
        title="Start with a workspace, then connect the CRM you use."
        copy="The trial can be created now. Contact sales for a paid subscription, team rollout or CRM compatibility review."
        primary="Contact Us"
        primaryHref="/contact"
        secondary="Get Started"
        secondaryHref={accountLinks.getStarted}
      />
    </MarketingLayout>
  );
}
