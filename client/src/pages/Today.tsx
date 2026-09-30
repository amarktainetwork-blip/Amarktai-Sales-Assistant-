import { formatOrganisationWorkDueDate } from "@shared/organisationWorkspace";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { refreshSalesDay } from "@/lib/refreshSalesDay";
import { trpc } from "@/lib/trpc";
import {
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
  if (status === "attention") return "CRM sync needs attention";
  if (!value) return "Waiting for first CRM sync";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).valueOf()) / 1000)
  );
  if (seconds <= 15) return "Live CRM truth · updated just now";
  if (seconds <= 45) return `Live CRM truth · updated ${seconds}s ago`;
  if (seconds < 60) return `Refreshing CRM truth · last confirmed ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `CRM truth confirmed ${minutes} minute${minutes === 1 ? "" : "s"} ago · refreshing automatically`;
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
      refetchInterval: 10_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    }
  );
  const utils = trpc.useUtils();
  const syncAll = trpc.connectedSystems.syncAll.useMutation();
  const [activeTab, setActiveTab] = useState<
    "now" | "queue" | "schedule" | "replies" | "internal"
  >("now");
  const [showAll, setShowAll] = useState(false);
  const [workCategoryFilter, setWorkCategoryFilter] = useState("all");
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
  const workGroups = today.data?.workGroups ?? [];
  const current = callQueue.find(item => item.contactEligibleNow !== false);
  const replyQueue = callQueue.filter(
    item => item.primaryKind === "inbound_reply"
  );
  const currentCustomer = trpc.sales.customerDetail.useQuery(
    { contactId: current?.contactId ?? 1 },
    { enabled: Boolean(current?.contactId), retry: false }
  );
  const remainingQueue = current
    ? callQueue.filter(item => item.key !== current.key)
    : callQueue;
  const queueForView =
    workCategoryFilter === "all"
      ? remainingQueue
      : callQueue.filter(
          item => item.workCategoryKey === workCategoryFilter
        );
  const visibleQueue = showAll ? queueForView : queueForView.slice(0, 7);
  const workspace = today.data?.workspace.organisation;
  const taskMetrics = today.data?.taskData.metrics;
  const inboundNeedsAction =
    today.data?.metrics.inboundNeedsAction ?? inboundQueue.length;
  const sourceTaskCount =
    (taskMetrics?.overdue ?? 0) + (taskMetrics?.dueToday ?? 0);
  const preferredName =
    organisation.data?.memberOnboarding.preferredName?.trim() || "there";
  const greetingName =
    preferredName === "there" ? preferredName : preferredName.split(/\s+/)[0];
  const localHour = (() => {
    try {
      return Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: workspace?.timezone || "UTC",
          hour: "2-digit",
          hour12: false,
        }).format(new Date())
      );
    } catch {
      return new Date().getHours();
    }
  })();
  const greeting =
    localHour < 12
      ? "Good morning"
      : localHour < 18
        ? "Good afternoon"
        : "Good evening";

  useEffect(() => {
    if (
      workCategoryFilter !== "all" &&
      !workGroups.some(group => group.key === workCategoryFilter)
    )
      setWorkCategoryFilter("all");
  }, [workCategoryFilter, workGroups]);

  useEffect(() => {
    if (!organisationId) return;
    let active = true;
    void (async () => {
      try {
        const statusResponse = await fetch("/api/mailbox", {
          credentials: "include",
          cache: "no-store",
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
        if (active && response.ok)
          await Promise.all([
            utils.sales.today.invalidate(),
            utils.sales.inbox.invalidate(),
          ]);
      } catch {
        // Last safe synchronized state remains available.
      }
    })();
    return () => {
      active = false;
    };
  }, [organisationId, utils.sales.inbox, utils.sales.today]);

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
        invalidateCustomerDetail: () => utils.sales.customerDetail.invalidate(),
        invalidateInbox: () => utils.sales.inbox.invalidate(),
        invalidateNewLeadAlerts: () => utils.sales.newLeadAlerts.invalidate(),
        invalidateTracker: () => utils.sales.tracker.invalidate(),
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
      ? formatOrganisationWorkDueDate(new Date(value), workspace || {})
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
      <div id="today-page" data-today-workspace className="amk-day">
        <header className="amk-day__header">
          <div>
            <p className="amk-day__eyebrow">Your sales day</p>
            <h1>
              {greeting}, {greetingName}.
            </h1>
            <p className="amk-day__orientation">
              {sourceTaskCount
                ? `${taskMetrics?.overdue ?? 0} overdue CRM task${(taskMetrics?.overdue ?? 0) === 1 ? "" : "s"} and ${taskMetrics?.dueToday ?? 0} due today. ${current ? `Your next best action is ${current.name}.` : "No customer should be contacted before their preferred window."}`
                : current
                  ? `Your next best action is ${current.name}.`
                  : callQueue.length
                    ? "Remaining customer work is protected for the correct contact windows."
                    : "Nothing needs immediate attention. Upcoming commitments stay protected below."}
            </p>
            <p className="amk-day__freshness">
              <span aria-hidden="true" />
              {freshnessLabel(
                today.data?.freshness.lastSuccessfulAt,
                today.data?.freshness.status
              )}
            </p>
          </div>
          <div className="amk-day__header-actions">
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
          <div className="amk-day__warning">
            Your CRM salesperson record needs to be matched before a personal
            work queue can be shown safely.
          </div>
        ) : null}

        <section data-today-summary className="amk-day__pulse">
          <div className="amk-day__pulse-intro">
            <span>Today at a glance</span>
            <strong>
              {taskMetrics?.overdue ?? 0} overdue · {taskMetrics?.dueToday ?? 0} due today
            </strong>
          </div>
          <div className="amk-day__metric">
            <strong aria-hidden="true">{inboundNeedsAction}</strong>
            <span className="sr-only">{inboundNeedsAction} replies</span>
            <span aria-hidden="true">Replies</span>
          </div>
          <div className="amk-day__metric">
            <strong>{newLeads.length}</strong>
            <span>New leads</span>
          </div>
          <div className="amk-day__metric">
            <strong>{taskMetrics?.overdue ?? 0}</strong>
            <span>Overdue</span>
          </div>
          <div className="amk-day__metric">
            <strong>{taskMetrics?.dueToday ?? 0}</strong>
            <span>Due today</span>
          </div>
          <div className="amk-day__flow" aria-label="Sales workflow">
            <span>Today</span>
            <ArrowRight />
            <span>Context</span>
            <ArrowRight />
            <span>Call</span>
            <ArrowRight />
            <span>AmarktAI prepares admin</span>
            <ArrowRight />
            <span>Review</span>
            <ArrowRight />
            <span>Next</span>
          </div>
        </section>

        <div
          className="amk-day__tabs"
          role="tablist"
          aria-label="Today workspace"
        >
          {[
            ["now", "Now", callQueue.length],
            ["queue", "Queue", Math.max(0, callQueue.length - 1)],
            ["schedule", "Schedule", upcoming.length],
            ["replies", "Replies", replyQueue.length],
            ["internal", "Internal", assignedTaskExceptions.length],
          ].map(([key, label, count]) => (
            <button
              key={String(key)}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              className={`${activeTab === key ? "is-active" : ""}${key === "internal" && Number(count) > 0 ? " has-internal" : ""}`}
              onClick={() =>
                setActiveTab(
                  key as "now" | "queue" | "schedule" | "replies" | "internal"
                )
              }
            >
              <span>{String(label)}</span>
              <small>{Number(count)}</small>
            </button>
          ))}
        </div>

        <div className="amk-day__body">
          {activeTab === "internal" && assignedTaskExceptions.length ? (
            <section data-today-internal-work className="amk-internal">
              <div className="amk-internal__head">
                <span className="amk-internal__icon">
                  <ClipboardCheck />
                </span>
                <div>
                  <p className="amk-day__eyebrow">Internal work</p>
                  <h2>
                    {assignedTaskExceptions.length === 1
                      ? "1 assigned task to work"
                      : `${assignedTaskExceptions.length} assigned tasks to work`}
                  </h2>
                  <p>
                    Work the task here with the related customer context. You
                    should not need to search Genie just to understand who the
                    task is about or what happened recently.
                  </p>
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
              <div className="amk-internal__list">
                {assignedTaskExceptions.map(item => (
                  <article key={item.id} className="amk-internal__card">
                    <div className="amk-internal__topline">
                      <div>
                        <div className="amk-internal__meta">
                          <span>{item.workType}</span>
                          <span>{item.reason}</span>
                          {item.dueAt ? <span>{dateLabel(item.dueAt)}</span> : null}
                        </div>
                        <h3>{item.title}</h3>
                      </div>
                      <strong className="amk-internal__customer">
                        {item.contactName || "No related CRM contact"}
                      </strong>
                    </div>

                    <div className="amk-internal__instruction">
                      <p className="amk-day__eyebrow">Task instruction</p>
                      <p>
                        {item.detail ||
                          "No additional task notes were supplied by the CRM. The task title above is the instruction."}
                      </p>
                    </div>

                    {item.contactId ? (
                      <>
                        <div className="amk-internal__facts">
                          <TodayContextFact
                            label="Contact"
                            value={
                              [item.contactEmail, item.contactPhone]
                                .filter(Boolean)
                                .join(" · ") || "No contact details available"
                            }
                          />
                          <TodayContextFact
                            label="Course / interest"
                            value={
                              item.courseInterest ||
                              item.interestValues?.[0] ||
                              "No course interest recorded"
                            }
                          />
                          <TodayContextFact
                            label="CRM stage"
                            value={
                              item.opportunity?.stage ||
                              item.lifecycleStage ||
                              "No current stage"
                            }
                          />
                          <TodayContextFact
                            label="Latest activity"
                            value={
                              item.latestActivity
                                ? `${item.latestActivity.activityType} · ${dateLabel(item.latestActivity.occurredAt)}`
                                : "No recent activity found"
                            }
                          />
                        </div>

                        {item.contactPreference || item.tags?.length ? (
                          <div className="amk-internal__tags">
                            {item.contactPreference ? (
                              <span>Best contact: {item.contactPreference}</span>
                            ) : null}
                            {item.tags?.slice(0, 4).map(tag => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        ) : null}

                        {item.recentActivities?.length ? (
                          <div className="amk-internal__history">
                            <p className="amk-day__eyebrow">Recent CRM context</p>
                            {item.recentActivities.map((activity, index) => (
                              <div
                                key={`${activity.activityType}:${new Date(activity.occurredAt).valueOf()}:${index}`}
                                className="amk-internal__history-row"
                              >
                                <strong>{activity.activityType}</strong>
                                <span>{dateLabel(activity.occurredAt)}</span>
                                {activity.body ? <p>{activity.body}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="amk-internal__actions">
                          {item.personallyOwned ? (
                            <Button
                              onClick={() =>
                                navigate(`/customers?contactId=${item.contactId}`)
                              }
                            >
                              <UserRound className="mr-2 h-4 w-4" />
                              Open customer
                            </Button>
                          ) : (
                            <span className="amk-internal__scope-note">
                              Colleague-owned lead · task-linked context shown here
                            </span>
                          )}
                          <Button
                            variant="outline"
                            onClick={() => {
                              const prompt = [
                                `Help me work this internal CRM task: ${item.title}.`,
                                item.contactName
                                  ? `Customer: ${item.contactName}.`
                                  : "",
                                item.courseInterest
                                  ? `Course/interest: ${item.courseInterest}.`
                                  : "",
                                item.opportunity?.stage
                                  ? `CRM stage: ${item.opportunity.stage}.`
                                  : "",
                                "Summarise what matters, what this task is asking me to do, and the safest next action.",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              navigate(
                                `/assistant?${item.personallyOwned ? `contactId=${item.contactId}&` : ""}prompt=${encodeURIComponent(prompt)}`
                              );
                            }}
                          >
                            <Sparkles className="mr-2 h-4 w-4" />
                            Prepare with AmarktAI
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="amk-internal__missing">
                        This CRM task is not linked to a customer record. The task
                        remains visible so it cannot be missed, but no customer
                        context can be safely inferred.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "now" ? (
            current ? (
              <section data-today-primary className="amk-now">
                <div className="amk-now__topline">
                  <div>
                    <p className="amk-day__eyebrow">Do this next</p>
                    <span data-today-signal className="amk-now__signal">
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
                  {current.dueAt ? (
                    <p className="amk-now__due">
                      Due {dateLabel(current.dueAt)}
                    </p>
                  ) : null}
                </div>

                <div className="amk-now__grid">
                  <div className="amk-now__story">
                    <h2>{current.name}</h2>
                    <p className="amk-now__headline">{current.headline}</p>
                    {current.workCount > 1 ? (
                      <p className="amk-day__eyebrow">
                        {current.workCount} CRM work items are grouped for this customer
                      </p>
                    ) : null}

                    <div className="amk-now__identity">
                      {current.courseInterest ? (
                        <span>
                          <small>Course interest</small>
                          <strong>{current.courseInterest}</strong>
                        </span>
                      ) : null}
                      {current.phone ? (
                        <span>
                          <small>Phone</small>
                          <strong>{current.phone}</strong>
                        </span>
                      ) : null}
                      {current.email ? (
                        <span>
                          <small>Email</small>
                          <strong>{current.email}</strong>
                        </span>
                      ) : null}
                    </div>

                    {current.interestValues.length || current.tags.length ? (
                      <div className="amk-now__tags">
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
                      <div className="amk-now__reasons">
                        <p className="amk-day__eyebrow">
                          Why AmarktAI put them first
                        </p>
                        <ul>
                          {current.reasons.slice(0, 4).map(reason => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {currentCustomer.data ? (
                      <div data-today-context className="amk-now__context">
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
                              ? currentCustomer.data.lastInteraction
                                  .activityType +
                                " · " +
                                dateLabel(
                                  currentCustomer.data.lastInteraction
                                    .occurredAt
                                )
                              : "No recent activity"
                          }
                        />
                      </div>
                    ) : null}
                  </div>

                  <aside className="amk-now__actions">
                    <div>
                      <p className="amk-day__eyebrow">Best next move</p>
                      <h3>
                        {current.primaryKind === "inbound_reply"
                          ? "Read the customer reply while it is fresh."
                          : "Open the conversation with the full customer story."}
                      </h3>
                    </div>
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
                    <p className="amk-now__promise">
                      After the conversation, AmarktAI prepares the follow-up
                      and CRM admin for Review. Nothing customer-facing is sent
                      from here.
                    </p>
                  </aside>
                </div>
              </section>
            ) : (
              <section data-today-empty className="amk-day__empty">
                <CheckCircle2 />
                <p className="amk-day__eyebrow">Clear for now</p>
                <h2>
                  {callQueue.length
                    ? "No customer should be contacted yet."
                    : "Immediate work is clear."}
                </h2>
                <p>
                  {callQueue.length
                    ? "The remaining people are protected by their preferred contact windows. They will move forward automatically when it is appropriate to call."
                    : "Future follow-ups remain scheduled, but nothing needs your attention right now."}
                </p>
                {upcoming[0] ? (
                  <div className="amk-day__next-commitment">
                    <span>Next protected commitment</span>
                    <strong>{upcoming[0].title}</strong>
                    <small>{dateLabel(upcoming[0].dueAt)}</small>
                  </div>
                ) : null}
              </section>
            )
          ) : null}

          {activeTab === "schedule" && upcoming.length ? (
            <section className="amk-schedule">
              <div className="amk-schedule__intro">
                <p className="amk-day__eyebrow">Protected schedule</p>
                <h2>Future promises stay visible before they become urgent.</h2>
                <p>
                  AmarktAI keeps scheduled work out of the immediate queue until
                  it approaches, then brings it forward before you can miss it.
                </p>
              </div>
              <div className="amk-schedule__list">
                {upcoming.slice(0, 4).map((item, index) => (
                  <div key={item.id} className="amk-schedule__row">
                    <span className="amk-schedule__number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <strong>{item.title}</strong>
                    <span>{dateLabel(item.dueAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === "queue" ? (
            queueForView.length ? (
              <section data-today-queue className="amk-queue">
                <div className="amk-queue__head">
                  <div>
                    <p className="amk-day__eyebrow">Up next</p>
                    <h2>Keep moving without deciding who to find next.</h2>
                  </div>
                  <span>{queueForView.length} shown</span>
                </div>
                {workGroups.length ? (
                  <div
                    aria-label="Filter work by category"
                    className="mb-4 flex flex-wrap gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setWorkCategoryFilter("all");
                        setShowAll(false);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        workCategoryFilter === "all"
                          ? "border-[#315FDD] bg-[#E2E8FA] text-[#244FC3]"
                          : "border-[#D7E0E4] bg-white text-[#596A75] hover:bg-[#F3F1EC]"
                      }`}
                    >
                      All · {callQueue.length}
                    </button>
                    {workGroups.map(group => (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => {
                          setWorkCategoryFilter(group.key);
                          setShowAll(true);
                        }}
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                          workCategoryFilter === group.key
                            ? "border-[#315FDD] bg-[#E2E8FA] text-[#244FC3]"
                            : "border-[#D7E0E4] bg-white text-[#596A75] hover:bg-[#F3F1EC]"
                        }`}
                      >
                        {group.label} · {group.count}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="amk-queue__list">
                  {visibleQueue.map((item, offset) => {
                    const index = offset + 1;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() =>
                          navigate(`/customers?contactId=${item.contactId}`)
                        }
                        className="amk-queue__row"
                      >
                        <span className="amk-queue__number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="amk-queue__person">
                          <strong>{item.name}</strong>
                          <small>
                            {item.courseInterest
                              ? item.headline + " · " + item.courseInterest
                              : item.headline}
                            {item.workCount > 1
                              ? ` · ${item.workCount} work items`
                              : ""}
                            {item.contactEligibleNow === false &&
                            item.contactPreferenceLabel
                              ? ` · Best contact: ${item.contactPreferenceLabel}`
                              : ""}
                          </small>
                        </span>
                        {item.dueAt ? (
                          <span className="amk-queue__due">
                            {dateLabel(item.dueAt)}
                          </span>
                        ) : null}
                        <ArrowRight className="amk-queue__arrow" />
                      </button>
                    );
                  })}
                  {queueForView.length > 7 ? (
                    <button
                      type="button"
                      onClick={() => setShowAll(value => !value)}
                      className="amk-queue__more"
                    >
                      {showAll
                        ? "Show priority view"
                        : `Show all ${queueForView.length} people`}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="amk-day__empty amk-day__empty--compact">
                <CheckCircle2 />
                <h2>No additional people are waiting.</h2>
                <p>
                  The current customer is the only person needing attention.
                </p>
              </section>
            )
          ) : null}

          {activeTab === "schedule" && !upcoming.length ? (
            <section className="amk-day__empty amk-day__empty--compact">
              <CheckCircle2 />
              <h2>No future commitments are scheduled.</h2>
              <p>New timed work will appear here when the CRM provides it.</p>
            </section>
          ) : null}

          {activeTab === "replies" ? (
            <section className="amk-replies">
              <div className="amk-queue__head">
                <div>
                  <p className="amk-day__eyebrow">Customer replies</p>
                  <h2>Only replies that still need action.</h2>
                </div>
                <span>{replyQueue.length} open</span>
              </div>
              {replyQueue.length ? (
                <div className="amk-queue__list">
                  {replyQueue.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      className="amk-queue__row"
                      onClick={() =>
                        navigate(
                          `/inbox?contactId=${encodeURIComponent(item.contactId)}`
                        )
                      }
                    >
                      <span className="amk-queue__number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="amk-queue__person">
                        <strong>{item.name}</strong>
                        <small>{item.headline}</small>
                      </span>
                      {item.dueAt ? (
                        <span className="amk-queue__due">
                          {dateLabel(item.dueAt)}
                        </span>
                      ) : null}
                      <Mail className="amk-queue__arrow" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="amk-day__empty amk-day__empty--compact">
                  <CheckCircle2 />
                  <h2>No customer replies need action.</h2>
                  <p>Handled communication stays out of this queue.</p>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}

function TodayContextFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="amk-now__fact">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}
