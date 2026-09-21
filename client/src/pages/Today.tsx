import { formatOrganisationDate } from "@shared/organisationWorkspace";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { refreshSalesDay } from "@/lib/refreshSalesDay";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Headphones,
  Loader2,
  Mail,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

function freshnessLabel(value?: Date | string | null, status?: string) {
  if (status === "attention") return "Sync needs attention";
  if (!value) return "Waiting for first CRM sync";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).valueOf()) / 1000)
  );
  if (seconds < 60) return "Updated moments ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return "Using the last successful CRM sync";
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
  const syncAll = trpc.connectedSystems.syncAll.useMutation();
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshInFlight = useRef(false);

  const startCall = trpc.calls.startLive.useMutation({
    onSuccess: (result, variables) =>
      navigate(
        `/calls?sessionId=${result.callSessionId}${
          variables.contactId ? `&contactId=${variables.contactId}` : ""
        }`
      ),
    onError: () =>
      toast.error("The call workspace could not open. Nothing was changed."),
  });

  const callQueue = today.data?.queues.callQueue ?? [];
  const inboundQueue = today.data?.queues.inbound ?? [];
  const newLeads = today.data?.queues.newLeads ?? [];
  const assignedTaskExceptions =
    today.data?.queues.assignedTaskExceptions ?? [];
  const upcoming = today.data?.queues.upcoming ?? [];
  const current = callQueue[0];
  const currentCustomer = trpc.sales.customerDetail.useQuery(
    { contactId: current?.contactId ?? 1 },
    { enabled: Boolean(current?.contactId), retry: false }
  );
  const visibleQueue = showAll ? callQueue.slice(1) : callQueue.slice(1, 8);
  const workspace = today.data?.workspace.organisation;
  const taskMetrics = today.data?.taskData.metrics;

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
        // Last safe synchronized state remains available.
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
          "CRM refresh was incomplete. Existing data is still safe."
        );
      else if (mailboxWarning)
        toast.warning(
          "Sales data refreshed. Recent replies may take a moment."
        );
      else toast.success("Your sales day is up to date.");
    } catch {
      toast.error(
        "Refresh could not finish. Existing sales data is still safe."
      );
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }

  const dateLabel = (value?: Date | string | null) =>
    value
      ? formatOrganisationDate(new Date(value), workspace || {})
      : "No due time";

  const openAssistant = () => {
    if (!current) return navigate("/assistant");
    navigate(
      `/assistant?contactId=${current.contactId}&prompt=${encodeURIComponent(
        "Prepare me for this customer. Tell me why they are next, what matters from the history, what I should ask on the call, and what follow-up will likely be needed."
      )}`
    );
  };

  if (today.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-[#667085]">
          <div className="flex items-center gap-3 text-base font-medium">
            <Loader2 className="h-5 w-5 animate-spin" />
            Building your sales day…
          </div>
        </div>
      </DashboardLayout>
    );

  if (today.isError)
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-[#20283A]">
            Your work queue could not be loaded.
          </h1>
          <p className="mt-2 text-base leading-6 text-[#667085]">
            Nothing has been changed. Your last synchronized customer data is
            still safe.
          </p>
          <Button className="mt-5" onClick={() => void today.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout>
      <div
        data-today-workspace
        className="mx-auto max-w-[1220px] space-y-5 text-[#20283A]"
      >
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-base font-medium text-[#7A8497]">Today</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em]">
              {assignedTaskExceptions.length
                ? "An assigned task needs attention."
                : current
                  ? `Next: ${current.name}`
                  : "You are caught up."}
            </h1>
            <p className="mt-1 text-sm text-[#667085]">
              {freshnessLabel(
                today.data?.freshness.lastSuccessfulAt,
                today.data?.freshness.status
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => void refreshDay()}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button variant="outline" onClick={() => navigate("/reviews")}>
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Review
            </Button>
          </div>
        </header>

        {today.data?.requiresOwnerMapping ? (
          <div className="rounded-xl bg-[#FFF8E8] px-4 py-3 text-base text-[#6E5720]">
            Your CRM salesperson record needs to be matched before a personal
            work queue can be shown safely.
          </div>
        ) : null}

        <section data-today-summary className="border-y border-[#E2E0DB] py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#667085]">
            <strong className="font-semibold text-[#30353C]">
              {callQueue.length} {callQueue.length === 1 ? "person" : "people"}{" "}
              to work
            </strong>
            <span>{inboundQueue.length} replies</span>
            <span>{newLeads.length} new leads</span>
            <span>{taskMetrics?.overdue ?? 0} overdue</span>
            <span>{taskMetrics?.dueToday ?? 0} due today</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#7A7F86]">
            <span className="font-semibold text-[#4B5663]">Today</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>Context</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>Call</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>AmarktAI prepares admin</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>Review</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>Next</span>
          </div>
        </section>

        {assignedTaskExceptions.length ? (
          <section
            data-today-task-safety
            className="rounded-2xl border border-[#F0D9A6] bg-[#FFFBF1] p-5 shadow-[0_10px_30px_rgba(120,82,18,.06)]"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFF0C8] text-[#8A6318]">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-[#293145]">
                    {assignedTaskExceptions.length === 1
                      ? "1 assigned task needs attention"
                      : `${assignedTaskExceptions.length} assigned tasks need attention`}
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6A6255]">
                    The CRM assignment is current, but the matching customer
                    record is not in your personal contact snapshot yet. The
                    task stays visible here so it cannot be missed.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => void refreshDay()}
                disabled={refreshing}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh context
              </Button>
            </div>
            <div className="mt-4 grid gap-3">
              {assignedTaskExceptions.slice(0, 4).map(item => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-[#EEE2C6] bg-white/80 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#8A6318]">
                      <span>{item.reason}</span>
                      {item.dueAt ? (
                        <span className="text-[#7A8497]">
                          {dateLabel(item.dueAt)}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-[#293145]">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-[#667085]">
                      {item.detail ||
                        "Customer details are still syncing from the assigned CRM task."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => navigate(`/crm/${item.connectedSystemId}`)}
                  >
                    Open CRM context
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {current ? (
          <section
            data-today-primary
            className="rounded-2xl bg-white p-6 shadow-[0_8px_28px_rgba(38,50,71,.06)] sm:p-7"
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#7A8497]">
                    Why this person is next
                  </p>
                  <span data-today-signal>
                    {current.primaryKind === "inbound_reply"
                      ? "Customer replied"
                      : current.primaryKind === "confirmed_follow_up"
                        ? "Scheduled follow-up"
                        : current.primaryKind === "overdue_task"
                          ? "Overdue"
                          : current.primaryKind === "due_today"
                            ? "Due today"
                            : "New lead"}
                  </span>
                </div>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-.035em]">
                  {current.name}
                </h2>
                <p className="mt-2 text-base leading-6 text-[#4E5C70]">
                  {current.headline}
                </p>

                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#667085]">
                  {current.courseInterest ? (
                    <span>
                      <strong className="font-semibold text-[#293145]">
                        Interest:
                      </strong>{" "}
                      {current.courseInterest}
                    </span>
                  ) : null}
                  {current.dueAt ? (
                    <span>
                      <strong className="font-semibold text-[#293145]">
                        Due:
                      </strong>{" "}
                      {dateLabel(current.dueAt)}
                    </span>
                  ) : null}
                  {current.phone ? <span>{current.phone}</span> : null}
                  {current.email ? <span>{current.email}</span> : null}
                </div>

                {current.interestValues.length || current.tags.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[...current.interestValues, ...current.tags]
                      .filter(Boolean)
                      .slice(0, 5)
                      .map(value => (
                        <span data-today-tag key={value}>
                          {value}
                        </span>
                      ))}
                  </div>
                ) : null}

                {current.reasons.length ? (
                  <div className="mt-5 space-y-1.5 text-base leading-6 text-[#5B687A]">
                    {current.reasons.slice(0, 4).map(reason => (
                      <p key={reason}>• {reason}</p>
                    ))}
                  </div>
                ) : null}

                {currentCustomer.data ? (
                  <div
                    data-today-context
                    className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    <TodayContextFact
                      label="Opportunity"
                      value={
                        currentCustomer.data.openOpportunity?.stage ||
                        currentCustomer.data.openOpportunity?.name ||
                        "No open opportunity"
                      }
                    />
                    <TodayContextFact
                      label="Current task"
                      value={
                        currentCustomer.data.nextAction?.title ||
                        "No current task"
                      }
                    />
                    <TodayContextFact
                      label="Latest activity"
                      value={
                        currentCustomer.data.lastInteraction
                          ? currentCustomer.data.lastInteraction.activityType +
                            " · " +
                            dateLabel(
                              currentCustomer.data.lastInteraction.occurredAt
                            )
                          : "No recent activity"
                      }
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex min-w-[190px] flex-col gap-2">
                {current.primaryKind === "inbound_reply" ? (
                  <Button size="lg" onClick={() => navigate("/inbox")}>
                    <Mail className="mr-2 h-4 w-4" />
                    Read reply
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
                    {startCall.isPending ? "Opening…" : "Start call"}
                  </Button>
                )}
                <Button variant="outline" onClick={openAssistant}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Prepare with AmarktAI
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate(`/customers?contactId=${current.contactId}`)
                  }
                >
                  <UserRound className="mr-2 h-4 w-4" />
                  Customer context
                </Button>
              </div>
            </div>

            <div className="mt-6 border-t border-[#ECEEF2] pt-4 text-sm text-[#7A8497]">
              After the conversation, AmarktAI prepares the follow-up and CRM
              admin for Review. You stay focused on the customer.
            </div>
          </section>
        ) : (
          <section
            data-today-empty
            className="rounded-2xl bg-white p-8 text-center shadow-[0_8px_28px_rgba(38,50,71,.05)]"
          >
            <CheckCircle2 className="mx-auto h-8 w-8 text-[#5B8067]" />
            <h2 className="mt-3 text-2xl font-semibold">
              Immediate work is clear.
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-base leading-6 text-[#667085]">
              Future follow-ups remain scheduled, but nothing needs your
              attention right now.
            </p>
            {upcoming[0] ? (
              <div className="mx-auto mt-5 max-w-xl rounded-xl border border-[#E2E5EE] bg-white px-4 py-3 text-left">
                <p className="text-xs font-semibold uppercase tracking-[.08em] text-[#8A93A5]">
                  Next protected commitment
                </p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#293145]">
                    {upcoming[0].title}
                  </span>
                  <span className="text-sm text-[#667085]">
                    {dateLabel(upcoming[0].dueAt)}
                  </span>
                </div>
              </div>
            ) : null}
          </section>
        )}

        {upcoming.length ? (
          <section className="rounded-2xl border border-[#E5E7EE] bg-white/80 px-5 py-4 shadow-[0_8px_24px_rgba(31,39,63,.035)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#293145]">
                  Protected schedule
                </p>
                <p className="mt-0.5 text-sm text-[#667085]">
                  Future work stays out of Today until it approaches, but
                  AmarktAI is already watching it.
                </p>
              </div>
              <span className="rounded-full bg-[#EEEFFF] px-3 py-1 text-xs font-semibold text-[#5558C9]">
                {upcoming.length} upcoming
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {upcoming.slice(0, 4).map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[#F8F9FC] px-3 py-2.5"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-[#3F485C]">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-[#7A8497]">
                    {dateLabel(item.dueAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {callQueue.length > 1 ? (
          <section data-today-queue>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#293145]">
                Up next
              </h2>
              <span className="text-sm text-[#8A93A5]">
                {callQueue.length - 1} remaining
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl bg-white shadow-[0_6px_22px_rgba(38,50,71,.045)]">
              {visibleQueue.map((item, offset) => {
                const index = offset + 1;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      navigate(`/customers?contactId=${item.contactId}`)
                    }
                    className="flex w-full items-center gap-4 border-b border-[#F0F2F4] px-5 py-3.5 text-left last:border-b-0 hover:bg-[#FAFBFC]"
                  >
                    <span className="w-6 shrink-0 text-sm font-medium text-[#9AA2AE]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-[#2F3D52]">
                        {item.name}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-[#707A8F]">
                        {item.courseInterest
                          ? item.headline + " · " + item.courseInterest
                          : item.headline}
                      </span>
                    </span>
                    {item.dueAt ? (
                      <span className="hidden shrink-0 text-sm text-[#8A93A5] md:block">
                        {dateLabel(item.dueAt)}
                      </span>
                    ) : null}
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#A3AAB4]" />
                  </button>
                );
              })}
              {callQueue.length > 8 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(value => !value)}
                  className="w-full px-5 py-3 text-center text-sm font-semibold text-[#596B84] hover:bg-[#FAFBFC]"
                >
                  {showAll
                    ? "Show priority view"
                    : `Show all ${callQueue.length} people`}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function TodayContextFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E5E8F0] bg-[#FAFBFD] px-3 py-2.5">
      <p className="text-xs font-semibold text-[#7A8497]">{label}</p>
      <p className="mt-1 text-sm font-medium leading-5 text-[#364154]">
        {value}
      </p>
    </div>
  );
}
