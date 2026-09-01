import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  AlarmClock,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CircleAlert,
  Headphones,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function money(valueMinor: number | null, currency: string | null) {
  if (valueMinor == null) return "";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(valueMinor / 100);
  } catch {
    return "";
  }
}

function dueLabel(value: Date | null) {
  if (!value) return "No due time";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Today() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const today = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId) }
  );
  const utils = trpc.useUtils();
  const [reminder, setReminder] = useState("");
  const [selected, setSelected] = useState(0);

  const saveReminder = trpc.memory.command.useMutation({
    onSuccess: () => {
      setReminder("");
      utils.sales.today.invalidate();
      toast.success("Reminder saved.");
    },
    onError: () => toast.error("That reminder could not be saved. Try again."),
  });
  const updateReminder = trpc.memory.updateReminder.useMutation({
    onSuccess: () => utils.sales.today.invalidate(),
    onError: () => toast.error("That reminder could not be updated."),
  });
  const startCall = trpc.calls.startFromToday.useMutation({
    onSuccess: result => navigate(`/calls?sessionId=${result.callSessionId}`),
    onError: error => {
      const callingUnavailable = /GENIE_DIALLER|calling|dialler/i.test(
        error.message
      );
      toast.error(
        callingUnavailable
          ? "CRM calling isn't available yet. You can still use your phone and keep Amarktai beside the call."
          : "The call companion could not open. Try again."
      );
    },
  });

  const priority = today.data?.queues.priority ?? [];
  const current = priority[selected];

  useEffect(() => {
    setSelected(index =>
      priority.length ? Math.min(index, priority.length - 1) : 0
    );
  }, [priority.length]);

  useEffect(() => {
    if (!organisationId) return;
    let active = true;
    void (async () => {
      try {
        const statusResponse = await fetch("/api/mailbox", {
          credentials: "include",
        });
        if (!statusResponse.ok) return;
        const status = (await statusResponse.json()) as { connected?: boolean };
        if (!status.connected) return;
        const response = await fetch("/api/mailbox/sync", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (active && response.ok) await utils.sales.today.invalidate();
      } catch {
        // Home remains usable with the last safe mailbox state when refresh fails.
      }
    })();
    return () => {
      active = false;
    };
  }, [organisationId]);

  const ask = (prompt: string) =>
    navigate(`/assistant?prompt=${encodeURIComponent(prompt)}`);

  if (today.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-[#66758A]">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Loader2 className="h-5 w-5 animate-spin text-[#3F70D8]" />
            Getting your day ready…
          </div>
        </div>
      </DashboardLayout>
    );

  if (today.isError)
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-xl rounded-3xl border border-[#DCE4EE] bg-white p-8 text-center text-[#26354A] shadow-sm">
          <CircleAlert className="mx-auto h-7 w-7 text-amber-600" />
          <h1 className="mt-4 font-display text-3xl font-bold tracking-[-.05em]">
            I couldn't load today's work.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#66758A]">
            Nothing has been changed. Check the CRM connection and try again.
          </p>
          <Button className="mt-5" onClick={() => void today.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </div>
      </DashboardLayout>
    );

  const metrics = today.data?.metrics;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
                Today
              </p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Focus on what needs you now.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66758A]">
                Your priorities, follow-ups and customer replies in one place.
                Ask Amarktai whenever you want help deciding what to do next.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void today.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh
              </Button>
              <Button onClick={() => navigate("/assistant")}>
                <Bot className="mr-2 h-4 w-4" /> Ask Amarktai
              </Button>
            </div>
          </div>
        </header>

        {today.data?.requiresOwnerMapping ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <strong>
              Your CRM account still needs to be matched to your Amarktai user.
            </strong>{" "}
            Ask your manager to link your salesperson record so this page can
            show only your own customers and tasks.
          </div>
        ) : null}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={AlarmClock}
            label="Overdue"
            value={metrics?.overdue ?? 0}
            onClick={() => ask("What are my overdue tasks?")}
          />
          <MetricCard
            icon={CalendarClock}
            label="Due today"
            value={metrics?.dueToday ?? 0}
            onClick={() => ask("What do I have due today?")}
          />
          <MetricCard
            icon={Mail}
            label="Replies"
            value={metrics?.inboundNeedsAction ?? 0}
            onClick={() => ask("Which customers are waiting for a reply?")}
          />
          <MetricCard
            icon={UserRound}
            label="Needs attention"
            value={metrics?.priorityRecords ?? 0}
            onClick={() => ask("Who should I contact next?")}
          />
        </section>

        <section className="mt-5 rounded-3xl border border-[#DCE4EE] bg-[#F3F7FF] p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#3F70D8]" />
            <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
              Ask about your day
            </h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "What should I do first?",
              "What are my overdue tasks?",
              "Who is waiting for a reply?",
              "Prepare me for my next call.",
            ].map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                className="rounded-full border border-[#C9D7EC] bg-white px-3 py-2 text-xs font-bold text-[#40536B] transition hover:border-[#8FAFE4] hover:text-[#315BB6]"
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#8290A3]">
                  Priority customers
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">
                  Start here
                </h2>
              </div>
              {priority.length ? (
                <span className="rounded-full bg-[#EDF3FF] px-3 py-1 text-xs font-bold text-[#3F70D8]">
                  {priority.length} to review
                </span>
              ) : null}
            </div>

            <div className="mt-5 space-y-2">
              {priority.length ? (
                priority.slice(0, 10).map((record, index) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelected(index)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected === index
                        ? "border-[#9CB8E8] bg-[#F3F7FF]"
                        : "border-[#E1E7EF] bg-white hover:border-[#BDCDE2]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-[#26354A]">
                          {record.name}
                        </p>
                        <p className="mt-1 text-xs text-[#718096]">
                          {[record.pipeline, record.stage]
                            .filter(Boolean)
                            .join(" · ") || "Customer opportunity"}
                          {record.valueMinor != null
                            ? ` · ${money(record.valueMinor, record.currency)}`
                            : ""}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[#8290A3]" />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#526277]">
                      {record.reasons.join(" · ")}
                    </p>
                  </button>
                ))
              ) : (
                <Empty text="No customers need urgent attention right now." />
              )}
            </div>
          </section>

          <aside className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#8290A3]">
              Next customer
            </p>
            {current ? (
              <>
                <h2 className="mt-3 font-display text-3xl font-bold tracking-[-.05em]">
                  {current.name}
                </h2>
                <p className="mt-2 text-sm text-[#66758A]">
                  {current.stage || "Current opportunity"}
                  {current.valueMinor != null
                    ? ` · ${money(current.valueMinor, current.currency)}`
                    : ""}
                </p>
                <div className="mt-5 rounded-2xl bg-[#F7F9FC] p-4">
                  <p className="text-xs font-bold text-[#8290A3]">
                    Why this matters now
                  </p>
                  <ul className="mt-2 space-y-2 text-sm leading-5 text-[#526277]">
                    {current.reasons.map(reason => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-5 grid gap-2">
                  <Button
                    onClick={() =>
                      ask(`Prepare me for my next call with ${current.name}.`)
                    }
                  >
                    <Bot className="mr-2 h-4 w-4" /> Prepare with Amarktai
                  </Button>
                  <Button
                    variant="outline"
                    disabled={startCall.isPending}
                    onClick={() =>
                      startCall.mutate({
                        opportunityId: current.id,
                        callingMode: "genie",
                      })
                    }
                  >
                    <Headphones className="mr-2 h-4 w-4" />
                    {startCall.isPending ? "Opening…" : "Open call companion"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={startCall.isPending}
                    onClick={() =>
                      startCall.mutate({
                        opportunityId: current.id,
                        callingMode: "external",
                      })
                    }
                  >
                    <Phone className="mr-2 h-4 w-4" /> Use my phone
                  </Button>
                </div>
              </>
            ) : (
              <Empty text="When a customer needs attention, the next one will appear here." />
            )}
          </aside>
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <TaskPanel
            title="Overdue tasks"
            items={today.data?.queues.overdueTasks ?? []}
            empty="No overdue tasks."
          />
          <TaskPanel
            title="Due today"
            items={today.data?.queues.dueToday ?? []}
            empty="No CRM tasks due today."
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <SimpleList
            title="Reminders"
            items={(today.data?.queues.reminders ?? []).map(item => ({
              id: item.id,
              title: item.title,
              detail: dueLabel(item.dueAt),
            }))}
            empty="No reminders due."
            onComplete={id =>
              updateReminder.mutate({ reminderId: id, status: "completed" })
            }
          />
          <SimpleList
            title="Callbacks"
            items={(today.data?.queues.callbacks ?? []).map(item => ({
              id: item.id,
              title: `${item.leadLabel}: ${item.title}`,
              detail: dueLabel(item.dueAt),
            }))}
            empty="No callbacks due."
          />
        </section>

        <section className="mt-6 rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-bold text-[#526277]">
              Quick reminder
              <Input
                value={reminder}
                onChange={event => setReminder(event.target.value)}
                placeholder="Remind me tomorrow at 2 to call John"
                className="mt-2"
              />
            </label>
            <Button
              disabled={reminder.trim().length < 8 || saveReminder.isPending}
              onClick={() => saveReminder.mutate({ command: reminder })}
            >
              {saveReminder.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Save reminder
            </Button>
          </div>
        </section>

        <InboundPanel
          items={today.data?.queues.inbound ?? []}
          onAsk={() => ask("Which customers are waiting for a reply?")}
        />
      </div>
    </DashboardLayout>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: typeof AlarmClock;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-[#DCE4EE] bg-white p-5 text-left shadow-sm transition hover:border-[#9CB8E8] hover:bg-[#FAFCFF]"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#EDF3FF] text-[#3F70D8]">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-4 text-3xl font-bold tracking-[-.04em]">{value}</p>
      <p className="mt-1 text-sm text-[#718096]">{label}</p>
    </button>
  );
}

function TaskPanel({
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
  }>;
  empty: string;
}) {
  return (
    <article className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
        {title}
      </h2>
      <div className="mt-4 space-y-2">
        {items.length ? (
          items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-[#F7F9FC] p-4"
            >
              <p className="font-semibold text-[#33445B]">{item.title}</p>
              <span className="shrink-0 text-xs text-[#718096]">
                {dueLabel(item.dueAt)}
              </span>
            </div>
          ))
        ) : (
          <Empty text={empty} />
        )}
      </div>
    </article>
  );
}

function SimpleList({
  title,
  items,
  empty,
  onComplete,
}: {
  title: string;
  items: Array<{ id: number; title: string; detail: string }>;
  empty: string;
  onComplete?: (id: number) => void;
}) {
  return (
    <article className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
        {title}
      </h2>
      <div className="mt-4 space-y-2">
        {items.length ? (
          items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-[#F7F9FC] p-4"
            >
              <div>
                <p className="font-semibold text-[#33445B]">{item.title}</p>
                <p className="mt-1 text-xs text-[#718096]">{item.detail}</p>
              </div>
              {onComplete ? (
                <button
                  type="button"
                  onClick={() => onComplete(item.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#CBD7E6] text-[#526277] hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                  aria-label={`Complete ${item.title}`}
                >
                  <Check className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ))
        ) : (
          <Empty text={empty} />
        )}
      </div>
    </article>
  );
}

function InboundPanel({
  items,
  onAsk,
}: {
  items: Array<{
    id: number;
    senderReference: string;
    subject: string | null;
    channel: string;
    receivedAt: Date;
  }>;
  onAsk: () => void;
}) {
  return (
    <article className="mt-6 rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5 text-[#3F70D8]" />
          <div>
            <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
              Customer replies
            </h2>
            <p className="mt-1 text-sm text-[#718096]">
              Messages that may need your attention.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onAsk}>
          <Bot className="mr-2 h-4 w-4" /> Ask Amarktai
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.length ? (
          items.map(item => (
            <div key={item.id} className="rounded-2xl bg-[#F7F9FC] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[#33445B]">
                  {item.senderReference}
                </p>
                <span className="text-[10px] font-bold uppercase text-[#8290A3]">
                  {item.channel}
                </span>
              </div>
              <p className="mt-2 text-sm text-[#66758A]">
                {item.subject || "Customer reply"}
              </p>
              <p className="mt-2 text-xs text-[#8290A3]">
                {new Date(item.receivedAt).toLocaleString()}
              </p>
            </div>
          ))
        ) : (
          <div className="md:col-span-2">
            <Empty text="No customer replies need attention right now." />
          </div>
        )}
      </div>
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#D7E0EA] bg-[#FAFCFF] p-5 text-sm text-[#8290A3]">
      {text}
    </p>
  );
}
