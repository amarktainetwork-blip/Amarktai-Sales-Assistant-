import {
  ArrowRight,
  Check,
  ChevronRight,
  Command,
  Eye,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { MarketingLayout } from "./MarketingLayout";
import { accountLinks } from "./site";

const operatingLoop = [
  ["01", "Understand", "Approved company knowledge and the CRM context that matters."],
  ["02", "Prioritise", "The customers, callbacks and opportunities that need attention now."],
  ["03", "Prepare", "History, talking points and the next sensible move before the conversation."],
  ["04", "Act", "Draft the follow-up, note, task or CRM change with review where it matters."],
  ["05", "Verify", "Read the result back from the CRM before the work is treated as complete."],
] as const;

const assistantPrompts = [
  "Who actually needs my attention this morning?",
  "Get me ready for the next customer call.",
  "Draft the follow-up and schedule the callback for Friday.",
  "What changed in the pipeline since yesterday?",
] as const;

const trustItems = [
  ["CRM stays the source of record", "Amarktai works with the system your team already uses rather than creating a second truth."],
  ["Private work stays private", "Salespeople keep their assistant conversations and working context to themselves."],
  ["Managers get the right oversight", "Team attention, exceptions and performance are visible without exposing private assistant conversations."],
  ["External work is governed", "Sensitive actions can require review, and CRM writes are read back before success is reported."],
] as const;

function WorkspaceScene() {
  return (
    <div className="home-v2-workspace" aria-label="Illustrative Amarktai sales workspace">
      <div className="home-v2-workspace__topbar">
        <div className="home-v2-window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="home-v2-workspace__label">Amarktai · Today</span>
        <span className="home-v2-live"><i /> CRM connected</span>
      </div>

      <div className="home-v2-workspace__body">
        <aside className="home-v2-workspace__rail" aria-hidden="true">
          <span className="is-active">T</span>
          <span>C</span>
          <span>A</span>
          <span>R</span>
        </aside>

        <div className="home-v2-workspace__queue">
          <div className="home-v2-panel-heading">
            <div>
              <small>YOUR DAY</small>
              <strong>Attention first</strong>
            </div>
            <span>Live context</span>
          </div>

          <div className="home-v2-priority is-now">
            <div className="home-v2-priority__number">01</div>
            <div>
              <small>NEXT</small>
              <strong>Prepare the customer conversation</strong>
              <p>History, open work and talking points are ready together.</p>
            </div>
            <ChevronRight size={17} />
          </div>

          <div className="home-v2-priority">
            <div className="home-v2-priority__number">02</div>
            <div>
              <small>FOLLOW-UP</small>
              <strong>Review the drafted response</strong>
              <p>Nothing customer-facing is sent just because AI suggested it.</p>
            </div>
            <ChevronRight size={17} />
          </div>

          <div className="home-v2-priority">
            <div className="home-v2-priority__number">03</div>
            <div>
              <small>CRM</small>
              <strong>Verify the completed update</strong>
              <p>Amarktai reads the result back before the task disappears.</p>
            </div>
            <ChevronRight size={17} />
          </div>
        </div>

        <div className="home-v2-workspace__assistant">
          <div className="home-v2-panel-heading">
            <div>
              <small>ASSISTANT</small>
              <strong>Ask in plain language</strong>
            </div>
            <MessageSquareText size={18} />
          </div>

          <div className="home-v2-chat-line is-user">
            Who should I speak to first?
          </div>
          <div className="home-v2-chat-line is-assistant">
            <span className="home-v2-ai-mark">ai</span>
            <p>
              Start with the customer whose follow-up is due and whose opportunity still has an unresolved next step. I have the call context ready.
            </p>
          </div>
          <button type="button" className="home-v2-assistant-action" tabIndex={-1}>
            <span><Sparkles size={15} /> Prepare conversation</span>
            <ArrowRight size={16} />
          </button>
          <div className="home-v2-assistant-foot">
            <ShieldCheck size={14} /> Governed actions · verified CRM readback
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <MarketingLayout>
      <section className="home-v2-hero">
        <div className="home-v2-ambient" aria-hidden="true">
          <span className="home-v2-ambient__line home-v2-ambient__line--one" />
          <span className="home-v2-ambient__line home-v2-ambient__line--two" />
          <span className="home-v2-ambient__dot home-v2-ambient__dot--one" />
          <span className="home-v2-ambient__dot home-v2-ambient__dot--two" />
        </div>
        <div className="home-v2-shell home-v2-hero__grid">
          <div className="home-v2-hero__copy">
            <p className="home-v2-kicker">Amarktai Network / Sales Assistant</p>
            <h1>Your sales day,<br /><em>without the drag.</em></h1>
            <p className="home-v2-hero__lead">
              Amarktai works beside the CRM your team already uses. It helps you decide what matters, prepare the conversation, do the follow-through and verify the result — without turning salespeople into CRM administrators.
            </p>
            <div className="home-v2-actions">
              <Link href={accountLinks.getStarted} className="home-v2-button home-v2-button--dark">
                Enter the workspace <ArrowRight size={17} />
              </Link>
              <Link href="/how-it-works" className="home-v2-text-link">
                See the operating loop <ChevronRight size={16} />
              </Link>
            </div>
            <div className="home-v2-proofline" aria-label="Product principles">
              <span><Check size={13} /> Your CRM stays the source of record</span>
              <span><Check size={13} /> Private salesperson workspaces</span>
              <span><Check size={13} /> Governed external actions</span>
            </div>
          </div>
          <div className="home-v2-hero__scene">
            <div className="home-v2-scene-label">THE WORKSPACE, NOT ANOTHER CRM</div>
            <WorkspaceScene />
          </div>
        </div>
      </section>

      <section className="home-v2-statement">
        <div className="home-v2-shell">
          <div className="home-v2-statement__grid">
            <p className="home-v2-index">01 / THE PROBLEM</p>
            <div>
              <h2>Stop managing the work <em>around</em> selling.</h2>
              <p>
                Sales teams already have CRMs, inboxes, calendars, notes and reports. The missing layer is a worker that understands the day across those systems and keeps the next action moving.
              </p>
            </div>
          </div>
          <div className="home-v2-loop" aria-label="Amarktai operating loop">
            {operatingLoop.map(([number, title, copy]) => (
              <article key={number} className="home-v2-loop__item">
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-v2-split">
        <div className="home-v2-shell home-v2-split__grid">
          <div className="home-v2-split__copy">
            <p className="home-v2-index">02 / HOW IT FEELS</p>
            <h2>Your CRM on one side.<br />Amarktai on the other.</h2>
            <p>
              Keep the actual customer record visible while the Assistant works through context, questions and next actions beside it. No bouncing between an AI chat window and the system where the work actually lives.
            </p>
            <div className="home-v2-inline-points">
              <span><Eye size={17} /> See the real CRM</span>
              <span><Command size={17} /> Ask for work naturally</span>
              <span><ShieldCheck size={17} /> Verify before calling it done</span>
            </div>
            <Link href="/product" className="home-v2-text-link home-v2-text-link--dark">
              Explore the product <ArrowRight size={16} />
            </Link>
          </div>
          <div className="home-v2-crm-stage" aria-hidden="true">
            <div className="home-v2-crm-stage__crm">
              <small>YOUR CRM</small>
              <strong>Customer record</strong>
              <div className="home-v2-crm-lines">
                <i /><i /><i /><i />
              </div>
              <div className="home-v2-crm-table">
                <span /><span /><span /><span /><span /><span />
              </div>
            </div>
            <div className="home-v2-crm-stage__bridge">
              <span>context</span>
              <ArrowRight size={18} />
              <span>readback</span>
            </div>
            <div className="home-v2-crm-stage__assistant">
              <small>AMARKTAI</small>
              <strong>Work beside the record</strong>
              <p>“Prepare this call, then draft the follow-up.”</p>
              <div><Sparkles size={15} /> Context ready</div>
              <div><ShieldCheck size={15} /> Review before action</div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-v2-roles">
        <div className="home-v2-shell">
          <div className="home-v2-roles__intro">
            <p className="home-v2-index">03 / ONE SYSTEM, TWO EXPERIENCES</p>
            <h2>Focused for the seller.<br />Useful for the manager.</h2>
          </div>
          <div className="home-v2-role-row">
            <div className="home-v2-role-row__number">A</div>
            <div>
              <small>SALESPERSON</small>
              <h3>“What should I do now?”</h3>
            </div>
            <p>
              Today, customers, calls, follow-ups, knowledge and the Assistant — without team-management clutter or somebody else’s private work.
            </p>
            <Link href="/individuals"><ArrowRight size={20} /></Link>
          </div>
          <div className="home-v2-role-row">
            <div className="home-v2-role-row__number">B</div>
            <div>
              <small>MANAGER</small>
              <h3>“Where does the team need attention?”</h3>
            </div>
            <p>
              Pipeline, overdue work, exceptions, calls and team performance — with company knowledge and CRM capability shared at the right level.
            </p>
            <Link href="/teams"><ArrowRight size={20} /></Link>
          </div>
        </div>
      </section>

      <section className="home-v2-ask">
        <div className="home-v2-shell home-v2-ask__grid">
          <div>
            <p className="home-v2-index">04 / ASK LIKE A TEAMMATE</p>
            <h2>No command language.<br />No workflow builder first.</h2>
            <p>
              Start with the outcome. Amarktai works out the safe path from the context and the capabilities actually available in the connected CRM.
            </p>
          </div>
          <div className="home-v2-prompts">
            {assistantPrompts.map((prompt, index) => (
              <div className="home-v2-prompt" key={prompt}>
                <span>0{index + 1}</span>
                <p>{prompt}</p>
                <ArrowRight size={17} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-v2-trust">
        <div className="home-v2-shell">
          <div className="home-v2-trust__heading">
            <p className="home-v2-index">05 / BUILT TO WORK INSIDE A REAL BUSINESS</p>
            <h2>Useful autonomy needs boundaries.</h2>
            <p>
              Amarktai is designed to help salespeople move faster without quietly inventing a second customer database or pretending an external action succeeded when it did not.
            </p>
          </div>
          <div className="home-v2-trust__list">
            {trustItems.map(([title, copy], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
          <div className="home-v2-trust__seal">
            <LockKeyhole size={18} />
            <span>Company knowledge is approved. Private salesperson context stays private.</span>
          </div>
        </div>
      </section>

      <section className="home-v2-integrations">
        <div className="home-v2-shell home-v2-integrations__grid">
          <div>
            <p className="home-v2-index">06 / KEEP THE CRM</p>
            <h2>Connect the system your team already lives in.</h2>
          </div>
          <div className="home-v2-integration-line" aria-label="Supported CRM connection targets">
            <span>Genie</span>
            <i />
            <span>HubSpot</span>
            <i />
            <span>Salesforce</span>
            <i />
            <span>Pipedrive</span>
            <i />
            <span>Zoho</span>
            <i />
            <span>Browser CRM</span>
          </div>
          <Link href="/integrations" className="home-v2-text-link home-v2-text-link--dark">
            See connection options <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="home-v2-final">
        <div className="home-v2-shell home-v2-final__inner">
          <div>
            <p className="home-v2-kicker">Amarktai Sales Assistant</p>
            <h2>Keep the CRM.<br />Change the way the day gets done.</h2>
          </div>
          <div className="home-v2-final__action">
            <p>
              Start with your business, connect the CRM, then give the team a workspace that keeps sales work moving.
            </p>
            <Link href={accountLinks.getStarted} className="home-v2-button home-v2-button--light">
              Get started <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
