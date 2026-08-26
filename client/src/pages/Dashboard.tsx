import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Headphones,
  Network,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const query = trpc.assistant.operationsDashboard.useQuery();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const isManager = organisation.data?.role === "owner" || organisation.data?.role === "manager";
  const teamIntelligence = trpc.management.teamIntelligence.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(isManager && organisationId) }
  );
  const today = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId) }
  );
  const companySetup = trpc.companySetup.get.useQuery();
  const exportData = trpc.assistant.exportWorkspaceData.useMutation({
    onSuccess: file => {
      const binary = atob(file.base64);
      const bytes = Uint8Array.from(binary, character =>
        character.charCodeAt(0)
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: file.contentType })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`${file.filename} is ready.`);
    },
    onError: error => toast.error(`Export failed: ${error.message}`),
  });
  const data = query.data;
  if (query.isLoading)
    return (
      <DashboardLayout>
        <Loading />
      </DashboardLayout>
    );
  if (query.isError)
    return (
      <DashboardLayout>
        <ApiError detail={query.error.message} retry={() => query.refetch()} />
      </DashboardLayout>
    );
  if (!data)
    return (
      <DashboardLayout>
        <Empty
          title="No sales activity is available yet."
          text="The dashboard will populate as follow-ups, calls, approvals and CRM activity are recorded."
        />
      </DashboardLayout>
    );
  if (isManager)
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-[1600px]">
          <header className="flex flex-col gap-4 border-b border-white/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#83AEFF]">TEAM TODAY</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white">Keep the team moving.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#A9BFDF]">See workload, follow-ups and the work that needs a manager’s attention—without opening anyone’s private workspace.</p></div>
            <Button onClick={() => navigate("/team")} className="h-11 rounded-xl bg-[#1B64F2] px-4 font-bold hover:bg-[#2B76FF]">Open team view <ArrowRight className="ml-2 size-4" /></Button>
          </header>
          <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Clock3} label="Overdue work" value={teamIntelligence.data?.summary.overdueTasks ?? 0} detail="Across mapped salespeople" alert={(teamIntelligence.data?.summary.overdueTasks ?? 0) > 0} />
            <Metric icon={Workflow} label="Stale opportunities" value={teamIntelligence.data?.summary.staleOpportunities ?? 0} detail="Across the team" alert={(teamIntelligence.data?.summary.staleOpportunities ?? 0) > 0} />
            <Metric icon={Headphones} label="People needing attention" value={teamIntelligence.data?.summary.needsAttention ?? 0} detail={`${teamIntelligence.data?.summary.mappedSalespeople ?? 0} mapped salespeople`} />
            <Metric icon={ShieldCheck} label="Pipeline at risk" value={teamIntelligence.data?.summary.atRisk ?? 0} detail="Team target exceptions" alert={(teamIntelligence.data?.summary.atRisk ?? 0) > 0} />
          </section>
          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel><Heading icon={Target} eyebrow="PIPELINE" title="People needing attention" /><p className="mt-4 text-sm leading-6 text-[#A9BFDF]">{teamIntelligence.data ? `${teamIntelligence.data.summary.overdueTasks} overdue task(s), ${teamIntelligence.data.summary.staleOpportunities} stale opportunity(s), and ${teamIntelligence.data.summary.needsAttention} mapped teammate(s) needing attention.` : "Team pipeline data will appear when CRM activity is available."}</p><Button variant="outline" onClick={() => navigate("/team")} className="mt-5 border-white/15 bg-white/5 text-white hover:bg-white/10">Review team workload</Button></Panel>
            <Panel><Heading icon={Activity} eyebrow="EXCEPTIONS" title="Approvals and risks" /><p className="mt-4 text-sm leading-6 text-[#A9BFDF]">{teamIntelligence.data?.summary.atRisk ?? 0} teammate target exception(s) need attention. Management reporting remains aggregated; private notes, call detail and assistant history stay with each salesperson.</p><Button variant="outline" onClick={() => navigate("/workspace")} className="mt-5 border-white/15 bg-white/5 text-white hover:bg-white/10">Open approvals</Button></Panel>
          </section>
        </div>
      </DashboardLayout>
    );
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px]">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-[#83AEFF]">
              TODAY
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">
              What should I do now?
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#A9BFDF] sm:text-base">
              See your next best action, today’s follow-ups and only the activity that helps you sell.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "operational_report", format: "csv" })
              }
              variant="outline"
              className="h-11 rounded-xl border-white/15 bg-white/5 px-4 text-[#DCE8FA] hover:bg-white/10 hover:text-white"
            >
              <Download className="mr-2 size-4" />
              {exportData.isPending ? "Preparing export…" : "Report CSV"}
            </Button>
            <Button
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "conversation_log", format: "pdf" })
              }
              variant="outline"
              className="h-11 rounded-xl border-white/15 bg-white/5 px-4 text-[#DCE8FA] hover:bg-white/10 hover:text-white"
            >
              <Download className="mr-2 size-4" />
              {exportData.isPending ? "Preparing export…" : "Call logs PDF"}
            </Button>
            <Button
              onClick={() => navigate("/workflows")}
              className="h-11 rounded-xl bg-[#1B64F2] px-4 font-bold hover:bg-[#2B76FF]"
            >
              <Workflow className="mr-2 size-4" />
              Prepare follow-up
            </Button>
            <Button
              onClick={() => navigate("/calls")}
              variant="outline"
              className="h-11 rounded-xl border-white/15 bg-white/5 px-4 text-[#DCE8FA] hover:bg-white/10 hover:text-white"
            >
              <Headphones className="mr-2 size-4" />
              Start call session
            </Button>
          </div>
        </header>
        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            icon={ShieldCheck}
            label="Needs review"
            value={data.metrics.reviewRequired}
            detail="External work waiting for a decision"
          />
          <Metric
            icon={Clock3}
            label="Open callbacks"
            value={data.metrics.openCallbacks}
            detail={`${data.metrics.dueTodayCallbacks} due today · ${data.metrics.overdueCallbacks} overdue`}
            alert={data.metrics.overdueCallbacks > 0}
          />
          <Metric
            icon={Headphones}
            label="Live calls"
            value={data.metrics.activeCalls}
            detail={`${data.metrics.callsReadyForReview} ready for review`}
          />
          <Metric
            icon={CheckCircle2}
            label="Executed actions"
            value={data.metrics.executedActions}
            detail={`${data.metrics.blockedActions} blocked with a recorded reason`}
            alert={data.metrics.blockedActions > 0}
          />
          <Metric
            icon={Workflow}
            label="Work ready for review"
            value={data.metrics.preparedWorkflows}
            detail="Prepared sales work in progress"
          />
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <Panel>
            <Heading
              icon={Target}
              eyebrow="TODAY"
              title="Priority sales work"
            />
            {today.data ? (
              <>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Due today", today.data.metrics.dueToday],
                    ["Overdue", today.data.metrics.overdue],
                    [
                      "Stale opportunities",
                      today.data.metrics.staleOpportunities,
                    ],
                    ["No next step", today.data.metrics.noNextStep],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-[#0B1B37] p-3">
                      <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#849FC5]">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-white">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {today.data.queues.priority.slice(0, 5).map(item => (
                    <button
                      key={`${item.connectedSystemId}:${item.externalId}`}
                      onClick={() => navigate("/today")}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-white/10 bg-[#0B1B37] p-3 text-left"
                    >
                      <span>
                        <strong className="text-sm text-white">
                          {item.name}
                        </strong>
                        <span className="mt-1 block text-xs text-[#92ABCF]">
                          {[item.pipeline, item.stage]
                            .filter(Boolean)
                            .join(" · ") || "Opportunity"}
                        </span>
                      </span>
                      <span className="max-w-[55%] text-right text-xs text-[#A9BFDF]">
                        {item.reasons.slice(0, 2).join(" · ")}
                      </span>
                    </button>
                  ))}
                  {!today.data.queues.priority.length && (
                    <Empty
                      title="No priority opportunity needs attention."
                      text="Synchronized CRM opportunities with due work, stale activity or missing next steps will appear here."
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="mt-5 text-sm text-[#8FA9CE]">
                Today priorities are not available yet.
              </p>
            )}
          </Panel>
          <Panel>
            <Heading
              icon={ShieldCheck}
              eyebrow="COMPANY KNOWLEDGE"
              title="Approved selling context"
            />
            <div className="mt-5 space-y-3">
              <div className="rounded-xl bg-[#0B1B37] p-4">
                <p className="text-xs font-bold text-[#849FC5]">
                  Business profile
                </p>
                <p className="mt-1 font-bold text-white">
                  {companySetup.data?.profile?.companyName || "Not completed"}
                </p>
              </div>
              <div className="rounded-xl bg-[#0B1B37] p-4">
                <p className="text-xs font-bold text-[#849FC5]">
                  Website knowledge
                </p>
                <p className="mt-1 font-bold capitalize text-white">
                  {companySetup.data?.profile?.discoveryStatus?.replaceAll(
                    "_",
                    " "
                  ) || "Not reviewed"}
                </p>
              </div>
              <button
                onClick={() => navigate("/knowledge")}
                className="inline-flex items-center gap-1 text-sm font-bold text-[#83AEFF]"
              >
                Open company knowledge <ArrowRight size={15} />
              </button>
            </div>
          </Panel>
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <Panel>
            <Heading
              icon={ShieldCheck}
              eyebrow="DECISIONS REQUIRED"
              title="Review queue"
            />
            <div className="mt-5 space-y-3">
              {data.queues.reviewProposals.length ? (
                data.queues.reviewProposals.map(item => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white">{item.title}</p>
                        <p className="mt-1 text-sm text-[#A9BFDF]">
                          {item.targetLabel} ·{" "}
                          {item.actionType.replaceAll("_", " ")}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate("/workspace")}
                        className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-[#83AEFF]"
                      >
                        Open review <ArrowRight size={15} />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <Empty
                  title="No decisions are waiting."
                  text="Prepared external actions will appear here before they can run."
                />
              )}
            </div>
          </Panel>
          <Panel>
            <Heading
              icon={CalendarClock}
              eyebrow="WORKLOAD"
              title="Callback focus"
            />
            <Queue
              label="Overdue"
              items={data.queues.overdueCallbacks}
              empty="No overdue callbacks."
              alert
            />
            <Queue
              label="Due today"
              items={data.queues.dueTodayCallbacks}
              empty="Nothing is due today."
            />
          </Panel>
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
          <Panel>
            <Heading
              icon={Headphones}
              eyebrow="CONVERSATIONS"
              title="Call work"
            />
            <Queue
              label="Live now"
              items={data.queues.activeCalls}
              empty="No live sessions are in progress."
            />
            <Queue
              label="Ready for review"
              items={data.queues.callsReadyForReview}
              empty="No call summaries are waiting."
            />
            <button
              onClick={() => navigate("/calls")}
              className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[#83AEFF]"
            >
              Open call desk <ArrowRight size={15} />
            </button>
          </Panel>
          <Panel>
            <Heading
              icon={Activity}
              eyebrow="SALES ASSISTANT"
              title="Recent Sales Assistant activity"
            />
            <div className="mt-5 space-y-2">
              {data.recent.agentActivity.length ? (
                data.recent.agentActivity.map(event => (
                  <ActivityCard
                    key={event.id}
                    summary={event.summary}
                    label={event.eventType}
                    date={event.createdAt}
                  />
                ))
              ) : (
                <Empty
                  title="No Sales Assistant activity yet."
                  text="Call preparation, coaching and approved CRM work will appear here."
                />
              )}
            </div>
          </Panel>
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-[.95fr_1.05fr]">
          <Panel>
            <Heading
              icon={Network}
              eyebrow="CRM"
              title="Connected sales systems"
            />
            <div className="mt-5">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#82AAEE]">
                Saved connection profiles
              </p>
              <div className="mt-3 space-y-2">
                {data.recent.connections.length ? (
                  data.recent.connections.map(item => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B1B37] p-3"
                    >
                      <div>
                        <p className="font-bold capitalize text-white">
                          {item.provider}
                        </p>
                        <p className="mt-1 text-xs text-[#9DB3D5]">
                          {item.displayName}
                        </p>
                      </div>
                      <Status text={item.status} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#8FA9CE]">
                    No connection profiles are saved yet.
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => navigate("/connections")}
              className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-[#83AEFF]"
            >
              Open connection settings <ArrowRight size={15} />
            </button>
          </Panel>
          <Panel>
            <Heading
              icon={Activity}
              eyebrow="AUDIT ACTIVITY"
              title="The recent decision trail"
            />
            <div className="mt-5 space-y-2">
              {data.recent.audit.length ? (
                data.recent.audit.map(event => (
                  <ActivityCard
                    key={event.id}
                    summary={event.summary}
                    label={event.eventType}
                    date={event.createdAt}
                  />
                ))
              ) : (
                <Empty
                  title="No audit records yet."
                  text="A clear activity trail starts when sales work begins."
                />
              )}
            </div>
          </Panel>
        </section>
      </div>
    </DashboardLayout>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-5 shadow-[0_18px_40px_rgba(0,0,0,.16)] sm:p-6">
      {children}
    </section>
  );
}
function Heading({
  icon: Icon,
  eyebrow,
  title,
}: {
  icon: typeof ShieldCheck;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#94B9FF]">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
          {eyebrow}
        </p>
        <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">
          {title}
        </h2>
      </div>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  detail,
  alert = false,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: number;
  detail: string;
  alert?: boolean;
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-[#A9BFDF]">{label}</p>
          <p className="mt-2 font-display text-4xl font-bold tracking-[-.07em] text-white">
            {value}
          </p>
        </div>
        <span
          className={cn(
            "grid size-10 place-items-center rounded-xl",
            alert
              ? "bg-amber-400/15 text-amber-200"
              : "bg-[#153B7A] text-[#94B9FF]"
          )}
        >
          <Icon size={18} />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#849FC5]">{detail}</p>
    </Panel>
  );
}
function Queue({
  label,
  items,
  empty,
  alert = false,
}: {
  label: string;
  items: Array<{
    id: number;
    leadLabel: string;
    title?: string;
    status?: string;
    dueAt?: Date | null;
  }>;
  empty: string;
  alert?: boolean;
}) {
  return (
    <div className="mt-5">
      <p
        className={cn(
          "text-[10px] font-black uppercase tracking-[.14em]",
          alert ? "text-amber-200" : "text-[#82AAEE]"
        )}
      >
        {label}
      </p>
      <div className="mt-2 space-y-2">
        {items.length ? (
          items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B1B37] px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-bold text-white">{item.leadLabel}</p>
                <p className="mt-0.5 text-xs text-[#92ABCF]">
                  {item.title ||
                    item.status?.replaceAll("_", " ") ||
                    "Workspace item"}
                </p>
              </div>
              {item.dueAt && (
                <p className="text-xs font-semibold text-[#9EB6DB]">
                  {new Date(item.dueAt).toLocaleDateString()}
                </p>
              )}
            </div>
          ))
        ) : (
          <p className="rounded-xl bg-white/[.04] px-3 py-3 text-sm text-[#8EA8CF]">
            {empty}
          </p>
        )}
      </div>
    </div>
  );
}
function ActivityCard({
  summary,
  label,
  date,
}: {
  summary: string;
  label: string;
  date: Date;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-[#0B1B37] p-3">
      <p className="text-sm font-semibold text-[#E4ECFA]">{summary}</p>
      <p className="mt-1 text-xs text-[#829CC2]">
        {label.replaceAll("_", " ")} · {new Date(date).toLocaleString()}
      </p>
    </article>
  );
}
function Readiness({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0B1B37] px-3 py-3">
      <p className="text-sm font-semibold text-[#DCE8FA]">{label}</p>
      <span
        className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em]",
          ready
            ? "bg-emerald-400/15 text-emerald-200"
            : "bg-white/8 text-[#9EB6DB]"
        )}
      >
        {ready ? "Configured" : "Not configured"}
      </span>
    </div>
  );
}
function Status({ text }: { text: string }) {
  return (
    <span className="rounded-full bg-[#153B7A] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em] text-[#94B9FF]">
      {text.replaceAll("_", " ")}
    </span>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[.03] p-5 text-center">
      <p className="font-bold text-[#E4ECFA]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8FA9CE]">
        {text}
      </p>
    </div>
  );
}
function Loading() {
  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 md:grid-cols-3">
      <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
      <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
      <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
    </div>
  );
}
function ApiError({ detail, retry }: { detail: string; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl rounded-[1.5rem] border border-rose-300/20 bg-rose-400/10 p-6 text-[#FCE8EC]">
      <p className="font-display text-2xl font-bold">
        The sales dashboard could not load.
      </p>
      <p className="mt-3 text-sm leading-6 text-rose-100/90">
        {detail ||
          "The workspace request failed. Check your connection or selected organisation, then retry."}
      </p>
      <Button onClick={retry} className="mt-5 bg-[#1B64F2] hover:bg-[#2B76FF]">
        Retry dashboard request
      </Button>
    </div>
  );
}
