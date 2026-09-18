import { formatOrganisationDate } from "@shared/organisationWorkspace";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refreshSalesDay } from "@/lib/refreshSalesDay";
import { trpc } from "@/lib/trpc";
import {
  AlarmClock,
  ArrowRight,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Headphones,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function inboundCategory(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? String((value as Record<string, unknown>).category || "")
    : "";
}

function freshnessLabel(value?: Date | string | null, status?: string) {
  if (status === "attention") return "CRM sync needs attention";
  if (!value) return "CRM has not synchronized yet";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).valueOf()) / 1000)
  );
  if (seconds < 60) return "CRM updated moments ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `CRM updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "CRM data is available from the last successful sync";
}

export default function Today() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const today = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(organisationId),
      retry: false,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    }
  );
  const utils = trpc.useUtils();
  const [reminder, setReminder] = useState("");
  const [selected, setSelected] = useState(0);
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const syncAll = trpc.connectedSystems.syncAll.useMutation();

  const acknowledgeLead = trpc.sales.workAction.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sales.today.invalidate(),
        utils.sales.newLeadAlerts.invalidate(),
      ]);
    },
  });
  const saveReminder = trpc.memory.command.useMutation({
    onSuccess: () => {
      setReminder("");
      void utils.sales.today.invalidate();
      toast.success("Reminder saved.");
    },
    onError: () => toast.error("That reminder could not be saved. Try again."),
  });
  const startCall = trpc.calls.startLive.useMutation({
    onSuccess: result => navigate(`/calls?sessionId=${result.callSessionId}`),
    onError: () =>
      toast.error(
        "The call workspace could not open. Nothing was changed; try again."
      ),
  });

  const callQueue = today.data?.queues.callQueue ?? [];
  const newLeads = today.data?.queues.newLeads ?? [];
  const inboundQueue = today.data?.queues.inbound ?? [];
  const visibleCallQueue = showAllQueue ? callQueue : callQueue.slice(0, 12);
  const current = callQueue[selected];
  const workspace = today.data?.workspace.organisation;

  useEffect(() => {
    setSelected(index =>
      callQueue.length ? Math.min(index, callQueue.length - 1) : 0
    );
  }, [callQueue.length]);

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
        // The last safe synchronized state remains usable.
      }
    })();
    return () => {
      active = false;
    };
  }, [organisationId, utils.sales.today]);

  async function refreshDay() {
    if (refreshInFlight.current || !organisationId) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const { mailboxWarning, crmWarning } = await refreshSalesDay({
        fetcher: fetch,
        syncCrm: () => syncAll.mutateAsync({ organisationId }),
        invalidateToday: () => utils.sales.today.invalidate(),
        invalidateCustomers: () => utils.sales.customerDirectory.invalidate(),
        refetchToday: () => today.refetch(),
      });
      if (crmWarning)
        toast.warning(
          "Some CRM records could not refresh just now. Existing synchronized data remains available."
        );
      else if (mailboxWarning)
        toast.warning(
          "Sales data refreshed. Recent replies may take a moment to appear."
        );
      else toast.success("Your sales day is up to date.");
    } catch {
      toast.error(
        "Refresh could not finish. Your existing sales data is still safe."
      );
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }

  const ask = (prompt: string, contactId?: number) =>
    navigate(
      `/assistant?${contactId ? `contactId=${contactId}&` : ""}prompt=${encodeURIComponent(prompt)}`
    );

  const openLead = (lead: (typeof newLeads)[number], prepare = false) => {
    const workItemId = lead.workItemIds[0];
    if (organisationId && workItemId)
      acknowledgeLead.mutate({
        organisationId,
        workItemId,
        action: "start",
        transitionKey: `today-new-lead:${workItemId}`,
      });
    navigate(
      prepare
        ? `/assistant?contactId=${lead.contactId}&prompt=${encodeURIComponent("Prepare me for this new lead. Summarise their course interest, enquiry context and what I should ask on the first call.")}`
        : `/customers?contactId=${lead.contactId}`
    );
  };

  const dateLabel = (value?: Date | string | null) =>
    value
      ? formatOrganisationDate(new Date(value), workspace || {})
      : "No due time";

  if (today.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-[#66758A]">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Loader2 className="h-5 w-5 animate-spin text-[#2F6FED]" />
            Building your call day…
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
            Your work queue could not be loaded.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#66758A]">
            Nothing has been changed. Your last synchronized customer data is
            still safe.
          </p>
          <Button
            className="mt-5"
            disabled={today.isFetching}
            onClick={() => void today.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </DashboardLayout>
    );

  const taskMetrics = today.data?.taskData.metrics;
  const metrics = today.data?.metrics;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1380px] space-y-5 text-[#26354A]">
        <header className="overflow-hidden rounded-3xl border border-[#D7E1EE] bg-white shadow-sm">
          <div className="grid gap-0 xl:grid-cols-[1fr_360px]">
            <div className="p-6 sm:p-8">
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#2F6FED]">
                Today · Work what matters
              </p>
              <h1 className="mt-3 max-w-4xl font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Work the hottest customer. AmarktAI handles the admin around it.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-[#66758A] sm:text-base">
                Your queue combines customer replies, possible sales, new leads,
                tasks and CRM history. Handle the next customer, then let AmarktAI
                prepare the follow-up, notes or reminder for Review.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {current ? (
                  current.primaryKind === "inbound_reply" ? (
                    <Button size="lg" onClick={() => navigate("/inbox")}>
                      <Mail className="mr-2 h-4 w-4" />
                      Open reply from {current.name}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      disabled={startCall.isPending}
                      onClick={() =>
                        startCall.mutate({
                          leadLabel: current.name,
                          contactId: current.contactId,
                        })
                      }
                    >
                      <Headphones className="mr-2 h-4 w-4" />
                      {startCall.isPending
                        ? "Opening call workspace…"
                        : `Start with ${current.name}`}
                    </Button>
                  )
                ) : (
                  <Button size="lg" onClick={() => navigate("/customers")}>
                    <UserRound className="mr-2 h-4 w-4" />
                    Open customers
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => navigate("/reviews")}
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Review prepared work
                </Button>
              </div>
              <p className="mt-4 text-xs font-semibold text-[#7A899C]">
                {freshnessLabel(
                  today.data?.freshness.lastSuccessfulAt,
                  today.data?.freshness.status
                )}
              </p>
            </div>

            <div className="border-t border-[#E3E9F1] bg-[#F7FAFF] p-6 xl:border-l xl:border-t-0">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#6C7F98]">
                Daily loop
              </p>
              <div className="mt-4 space-y-3">
                <FlowStep
                  number="1"
                  title="Pick the next person"
                  detail="Today"
                />
                <FlowStep
                  number="2"
                  title="Handle the reply or call"
                  detail="Inbox · Calls"
                />
                <FlowStep
                  number="3"
                  title="Prepare the admin"
                  detail="AmarktAI"
                />
                <FlowStep
                  number="4"
                  title="Approve only what matters"
                  detail="Review"
                />
              </div>
            </div>
          </div>
        </header>

        {today.data?.requiresOwnerMapping ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Your CRM salesperson record still needs to be matched before a safe
            personal work queue can be shown.
          </div>
        ) : null}

        {inboundQueue.length ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] text-white">
                    Customer replies · {inboundQueue.length}
                  </span>
                  {inboundCategory(inboundQueue[0].classification) === "sale_intent" ? (
                    <span className="text-sm font-black text-emerald-800">Possible sale needs attention</span>
                  ) : (
                    <span className="text-sm font-bold text-emerald-800">Reply before starting lower-priority work</span>
                  )}
                </div>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-.04em]">
                  {inboundQueue[0].subject || "New customer message"}
                </h2>
                <p className="mt-1 text-sm font-semibold text-emerald-900/70">
                  Received {dateLabel(inboundQueue[0].receivedAt)}
                </p>
              </div>
              <Button onClick={() => navigate("/inbox")}>
                <Mail className="mr-2 h-4 w-4" /> Open inbox
              </Button>
            </div>
          </section>
        ) : null}

        {newLeads.length ? (
          <section
            data-today-new-leads
            className="rounded-3xl border border-[#BFD2F8] bg-[#EDF4FF] p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[#2F6FED] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] text-white">
                    New leads · {newLeads.length}
                  </span>
                  <span className="text-sm font-bold text-[#315EA8]">
                    Fresh enquiries waiting for first contact
                  </span>
                </div>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-.04em]">
                  {newLeads[0].name}
                </h2>
                <p className="mt-1 text-sm font-semibold text-[#526985]">
                  {newLeads[0].courseInterest
                    ? `Course interest: ${newLeads[0].courseInterest}`
                    : "Course interest not yet identified — open the lead context before calling."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openLead(newLeads[0])}>Open lead</Button>
                <Button
                  variant="outline"
                  onClick={() => openLead(newLeads[0], true)}
                >
                  <Bot className="mr-2 h-4 w-4" /> Prepare call
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-[#DCE4EE] bg-white px-4 py-3 shadow-sm sm:px-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#66758A]">
            <span className="font-black uppercase tracking-[.11em] text-[#2F6FED]">
              Today priority
            </span>
            <span>
              <strong className="text-[#33445B]">1.</strong> Customer replies / possible sales
            </span>
            <span>
              <strong className="text-[#33445B]">2.</strong> New leads
            </span>
            <span>
              <strong className="text-[#33445B]">3.</strong> Overdue tasks
            </span>
            <span>
              <strong className="text-[#33445B]">4.</strong> Tasks due today
            </span>
            <span className="ml-auto text-[#8290A3]">
              Completed work moves to Review or history.
            </span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={Phone}
            label="People to work now"
            value={metrics?.callQueue ?? 0}
            note="Only customer work that still needs attention"
          />
          <Metric
            icon={CalendarClock}
            label="Tasks due today"
            value={taskMetrics?.dueToday ?? 0}
            note={`${taskMetrics?.overdue ?? 0} overdue · ${metrics?.awaitingTaskReview ?? 0} waiting in Review`}
          />
          <Metric
            icon={Mail}
            label="Replies needing action"
            value={metrics?.inboundNeedsAction ?? 0}
            note="Customer replies only"
          />
          <Metric
            icon={UserRound}
            label="New leads"
            value={metrics?.newLeads ?? 0}
            note="Fresh enquiries waiting for first contact"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_390px]">
          <div className="rounded-3xl border border-[#DCE4EE] bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6EBF2] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  Priority queue
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">
                  Your active work, in priority order.
                </h2>
              </div>
              <span className="rounded-full bg-[#EDF4FF] px-3 py-1 text-xs font-bold text-[#315EA8]">
                {callQueue.length}{" "}
                {callQueue.length === 1 ? "person" : "people"}
              </span>
            </div>

            {callQueue.length ? (
              <div className="divide-y divide-[#EDF1F5]">
                {visibleCallQueue.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelected(index)}
                    className={`flex w-full items-center gap-4 px-5 py-4 text-left transition sm:px-6 ${
                      index === selected
                        ? "bg-[#F3F7FF]"
                        : "bg-white hover:bg-[#FAFCFF]"
                    }`}
                  >
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black ${
                        index === selected
                          ? "bg-[#2F6FED] text-white"
                          : "bg-[#EDF3FF] text-[#2F6FED]"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-bold text-[#26354A]">
                          {item.name}
                        </span>
                        {item.workCount > 1 ? (
                          <span className="rounded-full bg-[#EFF2F6] px-2 py-0.5 text-[10px] font-bold text-[#617085]">
                            {item.workCount} items
                          </span>
                        ) : null}
                        {item.primaryKind === "new_lead" ? (
                          <span className="rounded-full bg-[#2F6FED] px-2 py-0.5 text-[10px] font-black uppercase tracking-[.08em] text-white">
                            New lead
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-sm text-[#5D6E83]">
                        {item.headline}
                      </span>
                      <span className="mt-1 block text-xs text-[#8290A3]">
                        {item.reasons.join(" · ")}
                        {item.dueAt ? ` · ${dateLabel(item.dueAt)}` : ""}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#8A99AB]" />
                  </button>
                ))}
                {callQueue.length > 12 ? (
                  <div className="flex justify-center border-t border-[#EDF1F5] bg-[#FAFCFF] px-5 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowAllQueue(value => {
                          if (value && selected >= 12) setSelected(0);
                          return !value;
                        });
                      }}
                    >
                      {showAllQueue
                        ? "Show priority view"
                        : `Show all ${callQueue.length} people`}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="p-8 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
                <h3 className="mt-3 font-display text-2xl font-bold">
                  Immediate queue clear.
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
                  No overdue tasks, due-today customer tasks or actionable
                  replies are waiting right now. Future work remains scheduled
                  without cluttering today.
                </p>
              </div>
            )}
          </div>

          <aside className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
              Next person
            </p>
            {current ? (
              <>
                <h2 className="mt-3 font-display text-3xl font-bold tracking-[-.05em]">
                  {current.name}
                </h2>
                <p className="mt-2 text-sm font-semibold text-[#526277]">
                  {current.headline}
                </p>
                {current.courseInterest ? (
                  <p className="mt-2 rounded-xl bg-[#EDF4FF] px-3 py-2 text-sm font-bold text-[#315EA8]">
                    Course interest: {current.courseInterest}
                  </p>
                ) : null}
                <div className="mt-4 space-y-2 rounded-2xl bg-[#F7F9FC] p-4 text-sm text-[#526277]">
                  {current.reasons.map((reason: string) => (
                    <p key={reason}>• {reason}</p>
                  ))}
                  {current.dueAt ? (
                    <p>• Due {dateLabel(current.dueAt)}</p>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  {current.phone ? (
                    <a
                      href={`tel:${current.phone}`}
                      className="flex items-center gap-2 rounded-xl border border-[#DCE4EE] px-3 py-2 font-semibold text-[#40536B]"
                    >
                      <Phone className="h-4 w-4 text-[#2F6FED]" />
                      {current.phone}
                    </a>
                  ) : null}
                  {current.email ? (
                    <div className="flex items-center gap-2 rounded-xl border border-[#DCE4EE] px-3 py-2 font-semibold text-[#40536B]">
                      <Mail className="h-4 w-4 text-[#2F6FED]" />
                      <span className="truncate">{current.email}</span>
                    </div>
                  ) : null}
                </div>
                <div className="mt-5 grid gap-2">
                  {current.primaryKind === "inbound_reply" ? (
                    <Button onClick={() => navigate("/inbox")}>
                      <Mail className="mr-2 h-4 w-4" />
                      Read customer reply
                    </Button>
                  ) : (
                    <Button
                      disabled={startCall.isPending}
                      onClick={() =>
                        startCall.mutate({
                          leadLabel: current.name,
                          contactId: current.contactId,
                        })
                      }
                    >
                      <Headphones className="mr-2 h-4 w-4" />
                      Open call companion
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      ask(
                        current.primaryKind === "inbound_reply"
                          ? `Prepare a reply to ${current.name}. Use their latest inbound message and CRM history, explain what matters commercially, and draft the response without sending it.`
                          : `Prepare me for my call with ${current.name}. Summarise what matters, what I need to ask, and the likely next step.`,
                        current.contactId
                      )
                    }
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    Prepare with AmarktAI
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      navigate(`/customers?contactId=${current.contactId}`)
                    }
                  >
                    <UserRound className="mr-2 h-4 w-4" />
                    Open customer context
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-5 rounded-2xl bg-[#F7F9FC] p-5 text-sm leading-6 text-[#66758A]">
                Your immediate queue is clear. Search Customers when you want to
                work a specific person or ask AmarktAI who deserves proactive
                attention.
              </div>
            )}
          </aside>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#2F6FED]" />
              <h2 className="font-display text-2xl font-bold tracking-[-.04em]">
                Give the admin to AmarktAI
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[#66758A]">
              Use AmarktAI for the time-consuming work around the call. Customer
              facing actions stay drafted and reviewable.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[
                "Prepare my next call",
                "Summarise the customer history",
                "Draft the follow-up — don't send",
                "What do I need to do after this call?",
              ].map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt, current?.contactId)}
                  className="rounded-xl border border-[#D7E1EE] bg-[#FAFCFF] px-4 py-3 text-left text-sm font-semibold text-[#40516A] transition hover:border-[#9CB8E8] hover:bg-[#F1F6FF]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7A899C]">
                  Quick capture
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold tracking-[-.04em]">
                  Get it out of your head.
                </h2>
              </div>
              <ClipboardCheck className="h-5 w-5 text-[#2F6FED]" />
            </div>
            <label className="mt-4 block text-xs font-bold text-[#526277]">
              Reminder
              <Input
                value={reminder}
                onChange={event => setReminder(event.target.value)}
                placeholder="Remind me tomorrow at 2 to call John"
                className="mt-2"
              />
            </label>
            <Button
              className="mt-3"
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
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => navigate("/reviews")}
            >
              Open Review
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>

        {today.data?.paymentReview.enabled ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            <strong>Manual payment check required.</strong> Payment source
            verification is not automated yet.{" "}
            {today.data.paymentReview.candidates.length} synchronized
            opportunities are in a configured pending-payment stage. Confirm
            payment in the source before preparing any stage change.
          </section>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE4EE] bg-[#F8FAFD] px-4 py-3 text-xs text-[#66758A]">
          <span>
            Future follow-ups stay scheduled and return here automatically when
            they are due.
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshing}
            onClick={() => void refreshDay()}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Refresh sales day
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function FlowStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-xs font-black text-[#2F6FED] ring-1 ring-[#C9D7EC]">
        {number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[#33445B]">{title}</span>
        <span className="block text-xs text-[#8290A3]">{detail}</span>
      </span>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof AlarmClock;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#EDF3FF] text-[#2F6FED]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="font-display text-3xl font-bold tracking-[-.04em]">
          {value}
        </span>
      </div>
      <p className="mt-3 text-sm font-bold text-[#40536B]">{label}</p>
      <p className="mt-1 text-xs leading-5 text-[#8290A3]">{note}</p>
    </div>
  );
}
