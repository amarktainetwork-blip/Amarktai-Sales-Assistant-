import {
  ArrowRight,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  Headphones,
  MailCheck,
  MessagesSquare,
  PhoneCall,
  Radar,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";
import { Link } from "wouter";
import {
  BrowserWindow,
  CTASection,
  Eyebrow,
  FeatureCard,
  MiniStatus,
  SectionHeader,
  TickList,
} from "./MarketingComponents";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const flow = [
  ["01", "Connect", "Connect the CRM your team already works in."],
  [
    "02",
    "Learn",
    "Review and approve what Amarktai may know about the business.",
  ],
  [
    "03",
    "Sell",
    "Know who to contact, prepare calls and get help through the sales day.",
  ],
  [
    "04",
    "Follow through",
    "Capture outcomes, follow-ups, notes and approved CRM actions.",
  ],
] as const;

const salesDay = [
  ["08", "Morning", "See what needs attention today."],
  ["09", "Next prospect", "Understand why this customer matters now."],
  ["10", "Before the call", "Review customer history and prepare."],
  ["11", "During the call", "Capture notes, transcription and assistance."],
  ["12", "After the call", "Confirm the outcome, follow-up and CRM work."],
  ["→", "Next prospect", "Continue with the context already assembled."],
] as const;

const integrations = [
  ["GE", "Genie"],
  ["HS", "HubSpot"],
  ["SF", "Salesforce"],
  ["PD", "Pipedrive"],
  ["ZO", "Zoho CRM"],
  ["+", "Other CRM"],
] as const;

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="marketing-page-hero">
        <div className="marketing-container marketing-page-hero__grid">
          <div className="marketing-page-hero__copy marketing-reveal">
            <Eyebrow>Amarktai Network · Sales Assistant</Eyebrow>
            <h1>
              Your sales day, <em>organised</em> by Amarktai.
            </h1>
            <p>
              Connect the CRM your team already uses. Know who to contact next,
              prepare every call, capture follow-ups and keep sales work moving
              in one clear workspace.
            </p>
            <div className="marketing-actions">
              <Link
                href={accountLinks.getStarted}
                className="marketing-button marketing-button--primary"
              >
                Get Started <ArrowRight size={17} />
              </Link>
              <Link
                href="/how-it-works"
                className="marketing-button marketing-button--secondary"
              >
                See How It Works
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-[#94acd0]">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[#6da2ff]" />
                For individuals and teams
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[#6da2ff]" />
                Works with your CRM
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[#6da2ff]" />
                Review before external actions
              </span>
            </div>
          </div>
          <div className="marketing-page-hero__visual marketing-reveal marketing-reveal--delay">
            <BrowserWindow>
              <div className="marketing-preview-head">
                <div>
                  <small>Monday · Sales workspace</small>
                  <strong>Good morning, Sam.</strong>
                </div>
                <span>4 priorities</span>
              </div>
              <MiniStatus
                active
                label="Next prospect"
                copy="Mpho Dlamini · follow-up due today"
              />
              <MiniStatus
                label="Prepare the call"
                copy="History, objective and likely questions ready"
              />
              <MiniStatus
                label="Review follow-up"
                copy="Two messages waiting for approval"
              />
              <MiniStatus
                label="Team attention"
                copy="One overdue callback needs support"
              />
              <div className="marketing-preview-action">
                <div>
                  <small>Recommended next step</small>
                  <strong>Open Mpho's pre-call brief</strong>
                </div>
                <span>
                  <ArrowRight size={18} />
                </span>
              </div>
            </BrowserWindow>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            eyebrow="A simple start"
            title="Connect. Learn. Sell. Follow through."
            copy="Amarktai turns setup into a clear daily rhythm without asking salespeople to understand the technology underneath."
          />
          <div className="marketing-flow">
            {flow.map(([number, title, copy]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container marketing-sales-day">
          <div className="sticky top-28">
            <SectionHeader
              eyebrow="A real sales day"
              title="One flow from first priority to next prospect."
              copy="The strongest sales tools disappear into the work. Amarktai brings the context, conversation and follow-through together so the next move stays visible."
            />
            <Link
              href="/product"
              className="marketing-button marketing-button--secondary"
            >
              Explore the product <ArrowRight size={16} />
            </Link>
          </div>
          <div className="marketing-sales-day__timeline">
            {salesDay.map(([number, title, copy]) => (
              <div key={`${number}-${title}`} className="marketing-day-item">
                <span>{number}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Built around the way you sell"
            title="Focused for one. Consistent for a team."
            copy="Use the same sales workspace in the way that fits your business today, without creating two different products."
          />
          <div className="marketing-grid marketing-grid--2">
            <article className="marketing-entry-card">
              <Eyebrow>Individual salesperson</Eyebrow>
              <h3>
                Stay organised without carrying the whole sales day in your
                head.
              </h3>
              <TickList
                items={[
                  "Know who to contact",
                  "Prepare every conversation",
                  "Spend less time on CRM administration",
                ]}
              />
              <Link href="/individuals">
                For Individuals <ArrowRight size={16} />
              </Link>
            </article>
            <article className="marketing-entry-card marketing-entry-card--bright">
              <Eyebrow>Team or company</Eyebrow>
              <h3>
                Give every salesperson one clear way to prepare and follow
                through.
              </h3>
              <TickList
                items={[
                  "Share approved company knowledge",
                  "Keep follow-ups visible",
                  "Help managers see where work is stuck",
                ]}
              />
              <Link href="/teams">
                For Teams <ArrowRight size={16} />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container">
          <SectionHeader
            eyebrow="Keep the system you already use"
            title="Your CRM stays. The sales day gets clearer."
            copy="Amarktai connects customer context and available sales workflows without forcing the business to replace its CRM. Setup and available capabilities depend on the connected system."
          />
          <div className="marketing-logo-grid">
            {integrations.map(([initials, name]) => (
              <div className="marketing-logo-card" key={name}>
                <div>
                  <span>{initials}</span>
                  <strong>{name}</strong>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-9">
            <Link
              href="/integrations"
              className="marketing-button marketing-button--secondary"
            >
              Explore integrations <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container marketing-split">
          <div>
            <SectionHeader
              eyebrow="Approved business knowledge"
              title="A sales assistant that understands what you sell."
              copy="Give Amarktai the company website, review what it discovers, and approve the products, services, policies and information the team may use."
            />
            <TickList
              items={[
                "You decide what becomes trusted company context",
                "Corrections stay connected to their source",
                "Every salesperson works from the same approved information",
              ]}
            />
            <Link
              href="/product"
              className="marketing-button marketing-button--secondary mt-8"
            >
              See Business Knowledge <ArrowRight size={16} />
            </Link>
          </div>
          <div className="marketing-split__panel">
            <Eyebrow>Knowledge review</Eyebrow>
            <div className="marketing-knowledge-stack">
              <article>
                <small>Product · Website source</small>
                <strong>Customer onboarding and sales workflow software</strong>
              </article>
              <article>
                <small>Service · Awaiting review</small>
                <strong>CRM connection and guided commissioning</strong>
              </article>
              <article>
                <small>Approved team context</small>
                <strong>Value proposition confirmed by workspace owner</strong>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Conversation to closeout"
            title="Prepare the call. Stay present. Finish the work."
            copy="Amarktai brings customer context into the conversation, helps capture what happened, and prepares the next steps for review."
          />
          <div className="marketing-grid marketing-grid--3">
            <FeatureCard
              icon={Target}
              title="Before the call"
              copy="Open the customer history, sales objective and useful company context before the conversation starts."
            />
            <FeatureCard
              icon={Headphones}
              title="During the call"
              copy="Use transcription, notes and live assistance where enabled and consented to in the workspace."
            />
            <FeatureCard
              icon={MailCheck}
              title="After the call"
              copy="Confirm the disposition, prepare follow-up and keep approved CRM administration moving."
            />
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--raised">
        <div className="marketing-container marketing-split">
          <div className="marketing-split__panel">
            <Eyebrow>Manager attention</Eyebrow>
            <div className="marketing-knowledge-stack">
              <article>
                <small>Team workload</small>
                <strong>Three follow-ups need attention today</strong>
              </article>
              <article>
                <small>Coaching</small>
                <strong>Two calls are ready for quality review</strong>
              </article>
              <article>
                <small>CRM health</small>
                <strong>One owner mapping needs confirmation</strong>
              </article>
            </div>
          </div>
          <div>
            <SectionHeader
              eyebrow="For managers"
              title="See where support is needed—without turning sales into surveillance."
              copy="Keep an eye on workload, overdue work, follow-up visibility, review queues and CRM health so managers can coach and unblock the team."
            />
            <TickList
              items={[
                "Team workload and overdue work",
                "Pipeline and follow-up attention",
                "Quality, coaching and review queues",
                "Clear operational reporting",
              ]}
            />
            <Link
              href="/teams"
              className="marketing-button marketing-button--secondary mt-8"
            >
              Explore team workspace <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container">
          <SectionHeader
            align="center"
            eyebrow="Control stays with the team"
            title="AI helps. Your team stays in control."
            copy="Approved information, reviewable actions and connected evidence make it easier to use assistance without losing responsibility for the outcome."
          />
          <div className="marketing-grid marketing-grid--4">
            <FeatureCard
              icon={BookOpenCheck}
              title="Approved context"
              copy="Use business information your workspace has reviewed and confirmed."
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Reviewable actions"
              copy="Check important external actions before they are executed."
            />
            <FeatureCard
              icon={Workflow}
              title="Connected evidence"
              copy="Keep preparation, execution status and results together."
            />
            <FeatureCard
              icon={Radar}
              title="Visible outcomes"
              copy="See what succeeded, what failed and what needs attention."
            />
          </div>
        </div>
      </section>

      <CTASection
        title="Make the next sales move easier to see."
        copy="Set up an individual workspace or bring the team into one consistent sales rhythm."
      />
    </MarketingLayout>
  );
}
