import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  ListChecks,
  Loader2,
  Mail,
  Play,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

function money(valueMinor: number | null, currency: string | null) {
  if (valueMinor == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(valueMinor / 100);
  } catch {
    return `${valueMinor / 100}`;
  }
}

export default function Today() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const today = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId) }
  );
  const startCall = trpc.calls.startFromToday.useMutation({
    onSuccess: result =>
      navigate(`/live-calls?sessionId=${result.callSessionId}`),
  });
  const priority = today.data?.queues.priority ?? [];
  const [selected, setSelected] = useState(0);
  const current = priority[selected];
  useEffect(() => {
    setSelected(index =>
      priority.length ? Math.min(index, priority.length - 1) : 0
    );
  }, [priority.length]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if (event.key.toLowerCase() === "n" && priority.length) {
        event.preventDefault();
        setSelected(index => (index + 1) % priority.length);
      }
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("today-queue")?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [priority.length]);
  if (today.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <Loading />
      </DashboardLayout>
    );
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1700px]">
        <header className="flex flex-col gap-6 border-b border-white/10 pb-7 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
              AMARKTAI / TODAY
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">
              Make the next best move obvious.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF] sm:text-base">
              This queue is calculated from synchronized CRM tasks and
              opportunities. It does not need an AI request to identify overdue
              work, stale opportunities, or records without a next step.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => today.refetch()}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
            >
              <RotateCcw className="mr-2 size-4" />
              Refresh
            </Button>
            <Button
              onClick={() => navigate("/workflows")}
              className="bg-[#1B64F2] hover:bg-[#2B76FF]"
            >
              <ListChecks className="mr-2 size-4" />
              Prepare work
            </Button>
          </div>
        </header>
        {today.data?.requiresOwnerMapping && (
          <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-400/[.07] p-4 text-sm leading-6 text-amber-100">
            <strong>
              Map CRM owners to Amarktai members before using a salesperson
              queue.
            </strong>{" "}
            The system has shared CRM data but no verified external owner
            mapping for this account, so it will not guess which records belong
            to the signed-in salesperson.
          </div>
        )}
        <section className="mt-7 grid gap-4 md:grid-cols-2 2xl:grid-cols-6">
          <Metric
            icon={CalendarClock}
            label="Due today"
            value={today.data?.metrics.dueToday ?? 0}
            tone="blue"
          />
          <Metric
            icon={AlarmClock}
            label="Overdue"
            value={today.data?.metrics.overdue ?? 0}
            tone="rose"
          />
          <Metric
            icon={Mail}
            label="Inbound action"
            value={today.data?.metrics.inboundNeedsAction ?? 0}
            tone="rose"
          />
          <Metric
            icon={CircleAlert}
            label="Stale opportunities"
            value={today.data?.metrics.staleOpportunities ?? 0}
            tone="amber"
          />
          <Metric
            icon={ListChecks}
            label="No next step"
            value={today.data?.metrics.noNextStep ?? 0}
            tone="amber"
          />
          <Metric
            icon={Play}
            label="Priority records"
            value={today.data?.metrics.priorityRecords ?? 0}
            tone="blue"
          />
        </section>
        <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_440px]">
          <article
            id="today-queue"
            tabIndex={-1}
            className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-5 outline-none sm:p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
                  PRIORITY WORK
                </p>
                <h2 className="font-display text-3xl font-bold tracking-[-.055em] text-white">
                  Work in the right order.
                </h2>
              </div>
              <span className="rounded-full bg-[#153B7A] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.11em] text-[#A9C7FF]">
                Press N for next
              </span>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">
                  <tr>
                    <th className="pb-3 pr-4">Opportunity</th>
                    <th className="pb-3 pr-4">Stage</th>
                    <th className="pb-3 pr-4">Value</th>
                    <th className="pb-3 pr-4">Why now</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {priority.length ? (
                    priority.map((record, index) => (
                      <tr
                        key={record.id}
                        onClick={() => setSelected(index)}
                        className={cn(
                          "cursor-pointer border-b border-white/[.07] transition",
                          selected === index
                            ? "bg-[#153B7A]/45"
                            : "hover:bg-white/[.035]"
                        )}
                      >
                        <td className="py-4 pr-4">
                          <p className="font-bold text-white">{record.name}</p>
                          <p className="mt-1 text-xs text-[#8FA9CE]">
                            {record.pipeline || "No pipeline"}
                          </p>
                        </td>
                        <td className="py-4 pr-4 text-sm text-[#B7C9E6]">
                          {record.stage || "Unstaged"}
                        </td>
                        <td className="py-4 pr-4 font-semibold text-[#D4E4FF]">
                          {money(record.valueMinor, record.currency)}
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {record.reasons.map(reason => (
                              <span
                                key={reason}
                                className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-100"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={event => {
                              event.stopPropagation();
                              startCall.mutate({ opportunityId: record.id });
                            }}
                            className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                          >
                            Start call <ArrowRight className="ml-1 size-3" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-12 text-center text-sm text-[#9DB3D5]"
                      >
                        No priority records are available yet. Connect and
                        synchronize a CRM, then map its owners to Amarktai
                        members.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
          <SalesSession
            record={current}
            onNext={() =>
              priority.length &&
              setSelected(index => (index + 1) % priority.length)
            }
            onPrepare={() => navigate("/workflows")}
            onStart={() =>
              current && startCall.mutate({ opportunityId: current.id })
            }
            starting={startCall.isPending}
          />
        </section>
        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <TaskList
            title="Overdue tasks"
            items={today.data?.queues.overdueTasks ?? []}
            empty="No overdue synchronized tasks."
          />
          <TaskList
            title="Due today"
            items={today.data?.queues.dueToday ?? []}
            empty="No tasks are due today."
          />
        </section>
        <InboundList items={today.data?.queues.inbound ?? []} />
      </div>
    </DashboardLayout>
  );
}

function SalesSession({
  record,
  onNext,
  onPrepare,
  onStart,
  starting,
}: {
  record:
    | {
        name: string;
        stage: string | null;
        valueMinor: number | null;
        currency: string | null;
        reasons: string[];
        staleDays: number;
        id: number;
      }
    | undefined;
  onNext: () => void;
  onPrepare: () => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <aside className="rounded-[1.5rem] border border-[#3D69AD]/40 bg-[#0E2142] p-6 shadow-[0_18px_40px_rgba(0,0,0,.2)]">
      <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
        SALES SESSION
      </p>
      <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.06em] text-white">
        Next customer
      </h2>
      {record ? (
        <>
          <div className="mt-7 rounded-2xl bg-[#08172F] p-5">
            <p className="text-2xl font-bold text-white">{record.name}</p>
            <p className="mt-2 text-sm text-[#A9BFDF]">
              {record.stage || "Unstaged opportunity"} ·{" "}
              {money(record.valueMinor, record.currency)}
            </p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">
                WHY NOW
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-[#D2E0F7]">
                {record.reasons.map(reason => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
            <div className="mt-4 rounded-xl bg-[#153B7A]/55 p-3 text-sm font-semibold text-[#DDE9FF]">
              Your next action: review the CRM context and prepare a governed
              follow-up.
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            <Button
              onClick={onStart}
              disabled={starting}
              className="bg-[#1B64F2] hover:bg-[#2B76FF]"
            >
              <Play className="mr-2 size-4" />
              {starting ? "Opening call…" : "Start call"}
            </Button>
            <Button
              onClick={onPrepare}
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
            >
              Prepare governed work
            </Button>
            <Button
              onClick={onNext}
              variant="outline"
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
            >
              Next record <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-6 text-sm leading-7 text-[#A9BFDF]">
          The next-record panel activates when synchronized records meet a
          deterministic priority rule.
        </p>
      )}
    </aside>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: number;
  tone: "blue" | "rose" | "amber";
}) {
  const tones = {
    blue: "bg-[#153B7A] text-[#A9C7FF]",
    rose: "bg-rose-400/15 text-rose-100",
    amber: "bg-amber-400/15 text-amber-100",
  };
  return (
    <article className="rounded-2xl border border-white/10 bg-[#0E2142] p-5">
      <span
        className={cn(
          "grid size-10 place-items-center rounded-xl",
          tones[tone]
        )}
      >
        <Icon size={18} />
      </span>
      <p className="mt-5 text-3xl font-bold tracking-[-.05em] text-white">
        {value}
      </p>
      <p className="mt-1 text-sm text-[#9DB3D5]">{label}</p>
    </article>
  );
}
function TaskList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{
    id: number;
    title: string;
    dueAt: Date | null;
    status: string;
    raw: Record<string, unknown>;
  }>;
  empty: string;
}) {
  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">
        {title}
      </h2>
      <div className="mt-4 space-y-2">
        {items.length ? (
          items.map(task => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-4 rounded-xl bg-[#08172F] p-3"
            >
              <div>
                <p className="font-semibold text-white">{task.title}</p>
                <p className="mt-1 text-xs text-[#8FA9CE]">
                  {String(task.raw.sourceKind || "CRM task").replaceAll(
                    "_",
                    " "
                  )}{" "}
                  · {task.status}
                </p>
              </div>
              <p className="text-xs font-bold text-[#C4D7F5]">
                {task.dueAt
                  ? new Date(task.dueAt).toLocaleString()
                  : "No due date"}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[.03] p-5 text-sm text-[#8FA9CE]">
            {empty}
          </p>
        )}
      </div>
    </article>
  );
}
function InboundList({
  items,
}: {
  items: Array<{
    id: number;
    senderReference: string;
    subject: string | null;
    channel: string;
    classification: Record<string, unknown> | null;
    receivedAt: Date;
  }>;
}) {
  return (
    <article className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <div className="flex items-center gap-3">
        <Mail className="text-[#8CB7FF]" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
            INBOUND
          </p>
          <h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">
            Replies needing attention
          </h2>
        </div>
      </div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {items.length ? (
          items.map(message => (
            <div key={message.id} className="rounded-xl bg-[#08172F] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-white">
                  {message.senderReference}
                </p>
                <span className="rounded-full bg-[#153B7A] px-2 py-1 text-[9px] font-black uppercase text-[#A9C7FF]">
                  {String(
                    message.classification?.category || message.channel
                  ).replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#B9CAE3]">
                {message.subject || "No subject"}
              </p>
              <p className="mt-2 text-xs text-[#7896C1]">
                {new Date(message.receivedAt).toLocaleString()} · reply remains
                review-controlled
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-[#8FA9CE]">
            No actionable inbound replies.
          </p>
        )}
      </div>
    </article>
  );
}
function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-[#A9BFDF]">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin" />
        Loading synchronized work…
      </div>
    </div>
  );
}
