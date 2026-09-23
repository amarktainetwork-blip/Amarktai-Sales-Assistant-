import { customerHistory } from "@shared/customerHistory";
import { formatOrganisationDate } from "@shared/organisationWorkspace";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Bot,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Headphones,
  Loader2,
  Mail,
  MessageSquareText,
  MonitorUp,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

function initialContactId() {
  const value = Number(
    new URLSearchParams(window.location.search).get("contactId")
  );
  return Number.isInteger(value) && value > 0 ? value : null;
}

function displayValue(value: unknown) {
  if (value == null || value === "") return "Not recorded";
  if (Array.isArray(value))
    return value.map(String).join(", ") || "Not recorded";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function Customers() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialContactId);
  const [activeCustomerTab, setActiveCustomerTab] = useState<
    "overview" | "conversation" | "tasks" | "opportunity" | "crm"
  >("overview");
  const [page, setPage] = useState(1);

  const workspace = trpc.sales.workspaceContext.useQuery(undefined, {
    retry: false,
  });
  const customers = trpc.sales.customerDirectory.useQuery(
    { page, pageSize: 50, search: query, sort: "updated" },
    { retry: false }
  );
  const detail = trpc.sales.customerDetail.useQuery(
    { contactId: selectedId || 1 },
    { enabled: Boolean(selectedId), retry: false }
  );
  const refreshHistory = trpc.sales.refreshCustomerHistory.useMutation({
    onSuccess: async () => {
      await utils.sales.customerDetail.invalidate();
    },
  });
  const visible = customers.data?.items ?? [];
  const selected = detail.data ?? null;
  const history = selected
    ? customerHistory(selected.activities.items, selected.communications.items)
    : [];
  const personFirst =
    (selected?.workspace.customerModel || workspace.data?.customerModel) ===
    "individual_consumer";

  useEffect(() => {
    if (!selectedId && visible.length) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  function selectCustomer(id: number) {
    setSelectedId(id);
    setActiveCustomerTab("overview");
    window.history.replaceState({}, "", `/customers?contactId=${id}`);
  }

  const dateLabel = (value: Date | string) =>
    formatOrganisationDate(
      new Date(value),
      selected?.workspace.organisation || workspace.data?.organisation || {}
    );

  const ask = (prompt: string, contactId = selected?.id ?? selectedId) =>
    navigate(
      `/assistant?${contactId ? `contactId=${contactId}&` : ""}prompt=${encodeURIComponent(prompt)}`
    );

  return (
    <DashboardLayout>
      <div
        id="customers-page"
        className="amk-customers-page mx-auto max-w-[1440px] text-[#26354A]"
      >
        <header className="rounded-2xl border border-[#DCE4EE] bg-white px-5 py-4 shadow-sm sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="handover-kicker">Customers</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-[-.04em] sm:text-3xl">
                Customer context
              </h1>
              <p className="mt-1 text-sm text-[#66758A]">
                Search, open the person, then call or prepare the next action.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="handover-status">
                {customers.data?.totalAll ?? 0} synced
              </span>
              <Button onClick={() => ask("Who should I contact next and why?")}>
                <Sparkles className="mr-2 h-4 w-4" /> Ask AmarktAI
              </Button>
            </div>
          </div>
        </header>

        <label className="flex items-center gap-3 rounded-2xl border border-[#DCE4EE] bg-white px-4 shadow-sm">
          <Search className="h-4 w-4 text-[#55788B]" />
          <Input
            value={query}
            onChange={event => {
              setPage(1);
              setQuery(event.target.value);
            }}
            placeholder="Search name, email, phone or stage"
            className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {query ? (
            <span className="text-xs font-semibold text-[#8290A3]">
              {customers.data?.total ?? 0} result
              {customers.data?.total === 1 ? "" : "s"}
            </span>
          ) : null}
        </label>

        {customers.isError ? (
          <section
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"
          >
            <p className="font-bold">Customer data could not be loaded.</p>
            <p className="mt-2 text-sm">
              {friendlyError(
                customers.error,
                "Check the CRM connection and try again. Nothing has been changed."
              )}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => void customers.refetch()}
            >
              Try again
            </Button>
          </section>
        ) : customers.isLoading && !selected ? (
          <section className="handover-surface grid min-h-64 place-items-center p-8 text-sm font-semibold text-[#66758A]">
            Loading your customer workspace…
          </section>
        ) : visible.length || selected ? (
          <section className="amk-customers-workspace grid gap-5 xl:grid-cols-[360px_1fr]">
            <aside className="handover-surface overflow-hidden">
              <div className="border-b border-[#E3E9F1] bg-[#FAFCFF] px-5 py-4">
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#7A899C]">
                  Customer list
                </p>
                <p className="mt-1 text-sm text-[#66758A]">
                  Select a person. Their working context stays with you.
                </p>
              </div>
              <div className="amk-customer-list-scroll overflow-y-auto p-2">
                {visible.map(customer => {
                  const active = customer.id === selectedId;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => selectCustomer(customer.id)}
                      className={`mb-1 flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                        active
                          ? "border-[#AFC4EB] bg-[#F1F6FF] shadow-sm"
                          : "border-transparent bg-white hover:border-[#E0E7F0] hover:bg-[#FAFCFF]"
                      }`}
                    >
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                          active
                            ? "bg-[#55788B] text-white"
                            : "bg-[#EAF0F2] text-[#55788B]"
                        }`}
                      >
                        <UserRound className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[#25364B]">
                          {customer.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[#708097]">
                          {customer.email ||
                            customer.phone ||
                            "Contact details not recorded"}
                        </span>
                        <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#55708F] ring-1 ring-[#DCE4EE]">
                          {customer.lifecycleStage || "Customer"}
                        </span>
                      </span>
                      <ArrowRight
                        className={`mt-2 h-4 w-4 shrink-0 ${
                          active ? "text-[#55788B]" : "text-[#9AA8B9]"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[#E8EDF3] p-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(value => value - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs font-semibold text-[#718096]">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!customers.data?.hasNext}
                  onClick={() => setPage(value => value + 1)}
                >
                  Next
                </Button>
              </div>
            </aside>

            {selected ? (
              <div className="amk-customer-detail">
                <section className="handover-surface p-5 sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-3xl font-bold tracking-[-.045em] text-[#1D2D43] sm:text-4xl">
                          {selected.name}
                        </h2>
                        <span className="rounded-full bg-[#EAF0F2] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] text-[#55788B]">
                          {selected.lifecycleStage || "Customer"}
                        </span>
                      </div>
                      {selected.companyName && !personFirst ? (
                        <p className="mt-2 text-sm text-[#66758A]">
                          {selected.companyName}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          navigate(`/calls?contactId=${selected.id}`)
                        }
                      >
                        <Headphones className="mr-2 h-4 w-4" /> Open call
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          ask(
                            `Prepare me for my call with ${selected.name}. Give me the important history, what they asked about, what I need to ask, and the best next step.`
                          )
                        }
                      >
                        <Bot className="mr-2 h-4 w-4" /> Prepare me
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          ask(
                            `Draft a concise follow-up for ${selected.name}. Do not send it. Put anything customer-facing into Review.`
                          )
                        }
                      >
                        <MessageSquareText className="mr-2 h-4 w-4" />
                        Draft follow-up
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <ContactFact
                      icon={Mail}
                      label="Email"
                      value={selected.email || "Not recorded"}
                    />
                    <ContactFact
                      icon={Phone}
                      label="Phone"
                      value={selected.phone || "Not recorded"}
                    />
                    <ContactFact
                      icon={BookOpen}
                      label="Course interest"
                      value={selected.interest.primary || "Not yet identified"}
                    />
                    <ContactFact
                      icon={CalendarClock}
                      label="What needs doing"
                      value={selected.nextAction?.title || "No current task"}
                    />
                    <ContactFact
                      icon={BriefcaseBusiness}
                      label="Current opportunity"
                      value={
                        selected.openOpportunity?.name ||
                        (personFirst
                          ? "Not required for this person"
                          : "None linked")
                      }
                    />
                  </div>
                </section>

                <div
                  className="amk-customer-tabs"
                  role="tablist"
                  aria-label="Customer workspace"
                >
                  {[
                    ["overview", "Overview"],
                    ["conversation", "Conversation"],
                    ["tasks", "Tasks"],
                    ["opportunity", "Opportunity"],
                    ["crm", "CRM fields"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeCustomerTab === key}
                      className={activeCustomerTab === key ? "is-active" : ""}
                      onClick={() =>
                        setActiveCustomerTab(
                          key as
                            | "overview"
                            | "conversation"
                            | "tasks"
                            | "opportunity"
                            | "crm"
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="amk-customer-tab-body">
                  {activeCustomerTab === "overview" ? (
                    <section className="amk-customer-overview handover-surface p-5 sm:p-6">
                      <div>
                        <p className="handover-kicker">What matters now</p>
                        <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                          {selected.nextAction?.title || "No current task"}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[#66758A]">
                          {history[0]
                            ? `Latest context: ${history[0].channel} · ${dateLabel(history[0].occurredAt)}`
                            : "No recent customer conversation is recorded yet."}
                        </p>
                      </div>
                      <div className="amk-customer-overview__actions">
                        <Button
                          onClick={() =>
                            navigate(`/calls?contactId=${selected.id}`)
                          }
                        >
                          <Headphones className="mr-2 h-4 w-4" /> Start call
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            ask(
                              `Prepare me for my call with ${selected.name}. Give me the important history, what they asked about, what I need to ask, and the best next step.`
                            )
                          }
                        >
                          <Bot className="mr-2 h-4 w-4" /> Prepare with AmarktAI
                        </Button>
                      </div>
                    </section>
                  ) : null}

                  {activeCustomerTab === "crm" && selected.mappedFields.length ? (
                  <section className="handover-surface p-5 sm:p-6">
                    <p className="handover-kicker">Customer context</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                      What matters before the call
                    </h3>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {selected.mappedFields.map(field => (
                        <div
                          key={field.sourceFieldId}
                          className="rounded-2xl border border-[#E0E7F0] bg-[#FAFCFF] p-4"
                        >
                          <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7B8CA2]">
                            {field.label}
                          </p>
                          <p className="mt-2 break-words text-sm font-bold leading-5 text-[#33445B]">
                            {displayValue(field.value)}
                          </p>
                        </div>
                      ))}
                    </div>
                    {selected.interest.tags.length ? (
                      <div className="mt-4 border-t border-[#E6EBF2] pt-4">
                        <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7B8CA2]">
                          CRM tags
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selected.interest.tags.slice(0, 10).map(tag => (
                            <span
                              key={tag}
                              className="rounded-full border border-[#D9E2ED] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#526277]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {activeCustomerTab === "tasks" ? (
                <section className="grid gap-5 lg:grid-cols-2">
                  <WorkPanel
                    title="Current work"
                    subtitle="What still needs doing"
                    empty="No current customer tasks."
                    items={selected.tasks.current.slice(0, 8).map(task => ({
                      id: task.id,
                      title: task.title,
                      detail: task.dueAt
                        ? dateLabel(task.dueAt)
                        : "No due time",
                    }))}
                  />
                  <WorkPanel
                    title="Recently completed"
                    subtitle="What has already been handled"
                    empty="No completed task history is recorded yet."
                    items={selected.tasks.completed.slice(0, 8).map(task => ({
                      id: task.id,
                      title: task.title,
                      detail:
                        task.completedAt || task.sourceUpdatedAt
                          ? dateLabel(task.completedAt || task.sourceUpdatedAt!)
                          : "Completed",
                      complete: true,
                    }))}
                  />
                </section>
                ) : null}

                {activeCustomerTab === "conversation" ? (
                <section className="handover-surface p-5 sm:p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="handover-kicker">Messages</p>
                      <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                        Customer conversation & history
                      </h3>
                      <p className="mt-1 text-sm text-[#66758A]">
                        Email, SMS, WhatsApp, calls and notes in one place.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#718096]">
                        {history.length} recent entries
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={refreshHistory.isPending}
                        onClick={() =>
                          selectedId &&
                          refreshHistory.mutate({ contactId: selectedId })
                        }
                      >
                        {refreshHistory.isPending ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        )}
                        Refresh Genie history
                      </Button>
                    </div>
                  </div>
                  {refreshHistory.isError ? (
                    <p role="alert" className="mt-3 text-sm text-red-700">
                      History could not be refreshed. Your saved history is
                      still available. Please try again.
                    </p>
                  ) : null}
                  {refreshHistory.isSuccess ? (
                    <p role="status" className="mt-3 text-sm text-[#526277]">
                      Genie history refreshed.
                    </p>
                  ) : null}
                  <div className="mt-4 space-y-2">
                    {history.length ? (
                      history.slice(0, 30).map(message => (
                        <div
                          key={message.id}
                          className="rounded-2xl border border-[#E0E7F0] bg-[#FAFCFF] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-[#EAF0F2] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] text-[#55788B]">
                                {message.channel} · {message.direction}
                              </span>
                              {message.needsAction ? (
                                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                                  Needs reply
                                </span>
                              ) : null}
                            </div>
                            <span className="text-xs font-semibold text-[#8290A3]">
                              {dateLabel(message.occurredAt)}
                            </span>
                          </div>
                          {message.subject ? (
                            <p className="mt-3 text-sm font-bold text-[#33445B]">
                              {message.subject}
                            </p>
                          ) : null}
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#526277]">
                            {message.body.length > 700
                              ? `${message.body.slice(0, 700)}…`
                              : message.body}
                          </p>
                        </div>
                      ))
                    ) : (
                      <Empty text="No conversation history has been synchronized for this customer yet." />
                    )}
                  </div>
                </section>
                ) : null}

                {activeCustomerTab === "opportunity" ? (
                <section>
                  <div className="handover-surface p-5 sm:p-6">
                    <p className="handover-kicker">Opportunity context</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                      {personFirst ? "Sales journey" : "Deal context"}
                    </h3>
                    {selected.openOpportunity ? (
                      <div className="mt-4 rounded-2xl border border-[#E0E7F0] bg-[#FAFCFF] p-4">
                        <p className="font-bold text-[#33445B]">
                          {selected.openOpportunity.name}
                        </p>
                        <p className="mt-1 text-sm text-[#66758A]">
                          {[
                            selected.openOpportunity.pipeline,
                            selected.openOpportunity.stage,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Current opportunity"}
                        </p>
                        {selected.openOpportunity.nextStepAt ? (
                          <p className="mt-3 text-xs font-semibold text-[#55708F]">
                            Next step:{" "}
                            {dateLabel(selected.openOpportunity.nextStepAt)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-[#E0E7F0] bg-[#FAFCFF] p-4 text-sm leading-6 text-[#66758A]">
                        {personFirst
                          ? "No open opportunity is linked. That does not block the person from being worked — tasks, enquiry context and history remain the primary guide."
                          : "No open opportunity is currently linked to this customer."}
                      </div>
                    )}
                  </div>
                </section>
                ) : null}

                {activeCustomerTab === "crm" ? (
                <section className="flex flex-col gap-3 rounded-2xl border border-[#DCE4EE] bg-[#F8FAFD] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#33445B]">
                      Source CRM is recovery, not the daily workspace.
                    </p>
                    <p className="mt-1 text-xs text-[#718096]">
                      Use it for specialist checks. Normal calling, context,
                      drafting and Review should happen here.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => navigate("/crm")}>
                    <MonitorUp className="mr-2 h-4 w-4" /> Open source CRM
                  </Button>
                </section>
                ) : null}
                </div>
              </div>
            ) : (
              <section className="handover-surface grid place-items-center p-10 text-center">
                <UserRound className="h-8 w-8 text-[#55788B]" />
                <p className="mt-3 font-bold">Choose a customer to begin.</p>
              </section>
            )}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-12 text-center shadow-sm">
            <Users className="mx-auto h-9 w-9 text-[#55788B]" />
            <h2 className="mt-4 font-display text-2xl font-bold tracking-[-.035em]">
              {query
                ? "No customers match that search."
                : "No customers have synced yet."}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              {query
                ? "Try a different name, email, phone, company or stage."
                : "Connect the company CRM once. AmarktAI will bring customer records into the workspace automatically."}
            </p>
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}

function ContactFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="handover-soft-surface min-w-0 p-4">
      <div className="flex items-center gap-2 text-[#55788B]">
        <Icon className="h-4 w-4" />
        <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#7B8CA2]">
          {label}
        </p>
      </div>
      <p className="mt-2 break-words text-sm font-bold leading-5 text-[#33445B]">
        {value}
      </p>
    </div>
  );
}

function WorkPanel({
  title,
  subtitle,
  empty,
  items,
}: {
  title: string;
  subtitle: string;
  empty: string;
  items: Array<{
    id: number;
    title: string;
    detail: string;
    complete?: boolean;
  }>;
}) {
  return (
    <div className="handover-surface p-5 sm:p-6">
      <p className="handover-kicker">{subtitle}</p>
      <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
        {title}
      </h3>
      <div className="mt-4 space-y-2">
        {items.length ? (
          items.map(item => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-[#E3E9F1] bg-[#FAFCFF] p-3"
            >
              {item.complete ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#55788B]" />
              )}
              <div>
                <p className="text-sm font-bold text-[#40536B]">{item.title}</p>
                <p className="mt-1 text-xs text-[#8290A3]">{item.detail}</p>
              </div>
            </div>
          ))
        ) : (
          <Empty text={empty} />
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#D9E1EB] bg-[#FAFCFF] p-4 text-sm text-[#718096]">
      {text}
    </div>
  );
}
