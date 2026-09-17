import { formatOrganisationDate } from "@shared/organisationWorkspace";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Headphones,
  Mail,
  MessageSquareText,
  MonitorUp,
  Phone,
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
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialContactId);
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
  const visible = customers.data?.items ?? [];
  const selected = detail.data ?? null;
  const personFirst =
    (selected?.workspace.customerModel || workspace.data?.customerModel) ===
    "individual_consumer";

  useEffect(() => {
    if (!selectedId && visible.length) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  function selectCustomer(id: number) {
    setSelectedId(id);
    window.history.replaceState({}, "", `/customers?contactId=${id}`);
  }

  const dateLabel = (value: Date | string) =>
    formatOrganisationDate(
      new Date(value),
      selected?.workspace.organisation || workspace.data?.organisation || {}
    );

  const ask = (prompt: string) =>
    navigate(
      `/assistant?${selectedId ? `contactId=${selectedId}&` : ""}prompt=${encodeURIComponent(prompt)}`
    );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1440px] space-y-5 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="handover-kicker">Customers</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                {personFirst
                  ? "Know the person before you call."
                  : "Know the customer before you call."}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A] sm:text-base">
                Search the full customer set, open one record, and get the
                useful context without digging through CRM screens. Tasks,
                history, enquiry fields and opportunities stay attached to the
                person you are working.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="handover-status">
                {customers.data?.totalAll ?? 0} synced customers
              </span>
              <Button onClick={() => ask("Who should I contact next and why?")}>
                <Sparkles className="mr-2 h-4 w-4" /> Ask AmarktAI
              </Button>
            </div>
          </div>
        </header>

        <label className="flex items-center gap-3 rounded-2xl border border-[#DCE4EE] bg-white px-4 shadow-sm">
          <Search className="h-4 w-4 text-[#2F6FED]" />
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
          <section className="grid min-h-[620px] gap-5 xl:grid-cols-[360px_1fr]">
            <aside className="handover-surface overflow-hidden">
              <div className="border-b border-[#E3E9F1] bg-[#FAFCFF] px-5 py-4">
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#7A899C]">
                  Customer list
                </p>
                <p className="mt-1 text-sm text-[#66758A]">
                  Select a person. Their working context stays with you.
                </p>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-2">
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
                            ? "bg-[#2F6FED] text-white"
                            : "bg-[#EDF3FF] text-[#2F6FED]"
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
                          active ? "text-[#2F6FED]" : "text-[#9AA8B9]"
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
              <div className="space-y-5">
                <section className="handover-surface p-5 sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-3xl font-bold tracking-[-.045em] text-[#1D2D43] sm:text-4xl">
                          {selected.name}
                        </h2>
                        <span className="rounded-full bg-[#EDF3FF] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] text-[#2F6FED]">
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

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

                {selected.mappedFields.length ? (
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
                  </section>
                ) : null}

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

                <section className="grid gap-5 lg:grid-cols-2">
                  <div className="handover-surface p-5 sm:p-6">
                    <p className="handover-kicker">Recent history</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                      What happened recently
                    </h3>
                    <div className="mt-4 space-y-2">
                      {selected.activities.items.slice(0, 8).length ? (
                        selected.activities.items.slice(0, 8).map(activity => (
                          <div
                            key={activity.id}
                            className="rounded-xl border border-[#E3E9F1] bg-[#FAFCFF] p-3"
                          >
                            <p className="text-sm font-bold capitalize text-[#40536B]">
                              {activity.activityType.replaceAll("_", " ")}
                            </p>
                            <p className="mt-1 text-xs text-[#8290A3]">
                              {dateLabel(activity.occurredAt)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <Empty text="No recent CRM activity is recorded yet." />
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() =>
                        ask(
                          `Summarise my full relationship history with ${selected.name}. Keep it concise and tell me what matters for the next call.`
                        )
                      }
                    >
                      Summarise with AmarktAI
                    </Button>
                  </div>

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
              </div>
            ) : (
              <section className="handover-surface grid place-items-center p-10 text-center">
                <UserRound className="h-8 w-8 text-[#2F6FED]" />
                <p className="mt-3 font-bold">Choose a customer to begin.</p>
              </section>
            )}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-12 text-center shadow-sm">
            <Users className="mx-auto h-9 w-9 text-[#2F6FED]" />
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
      <div className="flex items-center gap-2 text-[#2F6FED]">
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
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#2F6FED]" />
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
