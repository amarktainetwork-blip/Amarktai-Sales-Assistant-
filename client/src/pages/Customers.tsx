import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Headphones,
  Mail,
  MonitorUp,
  Phone,
  Search,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

export default function Customers() {
  const [, navigate] = useLocation();
  const customers = trpc.sales.customers.useQuery(undefined, { retry: false });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (customers.data ?? []).filter(
      customer =>
        !term ||
        `${customer.name} ${customer.companyName || ""} ${customer.email || ""} ${customer.phone || ""} ${customer.lifecycleStage || ""}`
          .toLowerCase()
          .includes(term)
    );
  }, [customers.data, query]);

  useEffect(() => {
    if (!visible.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visible.some(customer => customer.id === selectedId))
      setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  const selected = visible.find(customer => customer.id === selectedId) ?? null;

  const ask = (prompt: string) =>
    navigate(`/assistant?prompt=${encodeURIComponent(prompt)}`);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1440px] space-y-5 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="handover-kicker">Customers</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Every customer, already in context.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A] sm:text-base">
                Work from the relationship, not from CRM screens. AmarktAI brings the customer, company, opportunity, recent activity and next step together so you can decide, call and follow up from here.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="handover-status">
                {customers.data?.length ?? 0} synced customers
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
            onChange={event => setQuery(event.target.value)}
            placeholder="Search customers, companies, email, phone or stage"
            className="h-12 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {query ? (
            <span className="text-xs font-semibold text-[#8290A3]">
              {visible.length} result{visible.length === 1 ? "" : "s"}
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
        ) : customers.isLoading ? (
          <section className="handover-surface grid min-h-64 place-items-center p-8 text-sm font-semibold text-[#66758A]">
            Loading your customer workspace…
          </section>
        ) : visible.length ? (
          <section className="grid min-h-[620px] gap-5 xl:grid-cols-[380px_1fr]">
            <aside className="handover-surface overflow-hidden">
              <div className="border-b border-[#E3E9F1] bg-[#FAFCFF] px-5 py-4">
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#7A899C]">
                  Customer list
                </p>
                <p className="mt-1 text-sm text-[#66758A]">
                  Select a person to open the full selling context.
                </p>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-2">
                {visible.map(customer => {
                  const active = customer.id === selected?.id;
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => setSelectedId(customer.id)}
                      className={`mb-1 flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
                        active
                          ? "border-[#AFC4EB] bg-[#F1F6FF] shadow-sm"
                          : "border-transparent bg-white hover:border-[#E0E7F0] hover:bg-[#FAFCFF]"
                      }`}
                    >
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${active ? "bg-[#2F6FED] text-white" : "bg-[#EDF3FF] text-[#2F6FED]"}`}>
                        <UserRound className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-[#25364B]">
                          {customer.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[#708097]">
                          {customer.companyName || "No linked company"}
                        </span>
                        <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#55708F] ring-1 ring-[#DCE4EE]">
                          {customer.lifecycleStage || "Customer"}
                        </span>
                      </span>
                      <ArrowRight className={`mt-2 h-4 w-4 shrink-0 ${active ? "text-[#2F6FED]" : "text-[#9AA8B9]"}`} />
                    </button>
                  );
                })}
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
                      <p className="mt-2 flex items-center gap-2 text-sm text-[#66758A]">
                        <Building2 className="h-4 w-4 text-[#2F6FED]" />
                        {selected.companyName || "No linked company"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          ask(`Give me the complete sales brief for ${selected.name}. What matters now, what happened recently, and what should I do next?`)
                        }
                      >
                        <Bot className="mr-2 h-4 w-4" /> Ask AmarktAI
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate(`/calls?contactId=${selected.id}`)}
                      >
                        <Headphones className="mr-2 h-4 w-4" /> Call
                      </Button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <ContactFact icon={Mail} label="Email" value={selected.email || "Not recorded"} />
                    <ContactFact icon={Phone} label="Phone" value={selected.phone || "Not recorded"} />
                    <ContactFact
                      icon={BriefcaseBusiness}
                      label="Opportunity"
                      value={selected.openOpportunity?.name || "No open opportunity"}
                    />
                    <ContactFact
                      icon={CalendarClock}
                      label="Next step"
                      value={
                        selected.nextAction?.title ||
                        (selected.openOpportunity?.nextStepAt
                          ? `Opportunity follow-up · ${new Date(selected.openOpportunity.nextStepAt).toLocaleDateString()}`
                          : "No next step recorded")
                      }
                    />
                  </div>
                </section>

                <section className="grid gap-5 lg:grid-cols-2">
                  <div className="handover-surface p-5 sm:p-6">
                    <p className="handover-kicker">Relationship</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                      What happened recently
                    </h3>
                    <div className="mt-4 handover-soft-surface p-4">
                      {selected.lastInteraction ? (
                        <>
                          <p className="font-bold capitalize text-[#33445B]">
                            {selected.lastInteraction.activityType.replaceAll("_", " ")}
                          </p>
                          <p className="mt-1 text-xs text-[#8290A3]">
                            {new Date(selected.lastInteraction.occurredAt).toLocaleString()}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-[#66758A]">
                          No recent interaction is recorded yet.
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() =>
                        ask(`Summarise my relationship history with ${selected.name} and flag anything I should know before contacting them.`)
                      }
                    >
                      Summarise relationship
                    </Button>
                  </div>

                  <div className="handover-surface p-5 sm:p-6">
                    <p className="handover-kicker">Opportunity</p>
                    <h3 className="mt-2 font-display text-2xl font-bold tracking-[-.035em]">
                      Deal context
                    </h3>
                    {selected.openOpportunity ? (
                      <div className="mt-4 handover-soft-surface p-4">
                        <p className="font-bold text-[#33445B]">
                          {selected.openOpportunity.name}
                        </p>
                        <p className="mt-1 text-sm text-[#66758A]">
                          {selected.openOpportunity.stage || "Stage not recorded"}
                        </p>
                        {selected.openOpportunity.nextStepAt ? (
                          <p className="mt-3 text-xs font-semibold text-[#55708F]">
                            Next step: {new Date(selected.openOpportunity.nextStepAt).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-4 handover-soft-surface p-4 text-sm text-[#66758A]">
                        No open opportunity is currently linked to this customer.
                      </div>
                    )}
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() =>
                        ask(`What is the best next sales action for ${selected.name} based on their current opportunity and recent history?`)
                      }
                    >
                      Recommend next action
                    </Button>
                  </div>
                </section>

                <section className="flex flex-col gap-3 rounded-2xl border border-[#DCE4EE] bg-[#F8FAFD] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#33445B]">Need the original record?</p>
                    <p className="mt-1 text-xs text-[#718096]">
                      The source CRM remains available for recovery and specialist work, but normal selling should happen in AmarktAI.
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => navigate("/crm")}>
                    <MonitorUp className="mr-2 h-4 w-4" /> Open source CRM
                  </Button>
                </section>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-12 text-center shadow-sm">
            <Users className="mx-auto h-9 w-9 text-[#2F6FED]" />
            <h2 className="mt-4 font-display text-2xl font-bold tracking-[-.035em]">
              {query ? "No customers match that search." : "No customers have synced yet."}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#66758A]">
              {query
                ? "Try a different name, company, email or stage."
                : "Connect the company CRM once. AmarktAI will bring customer records into this workspace automatically."}
            </p>
            {!query ? (
              <Button className="mt-5" onClick={() => navigate("/connections")}>
                Open CRM setup
              </Button>
            ) : null}
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
