import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  Building2,
  Headphones,
  Mail,
  MonitorUp,
  Phone,
  Search,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

export default function Customers() {
  const [, navigate] = useLocation();
  const customers = trpc.sales.customers.useQuery(undefined, { retry: false });
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (customers.data ?? []).filter(
      customer =>
        !term ||
        `${customer.name} ${customer.companyName || ""} ${customer.email || ""} ${customer.phone || ""}`
          .toLowerCase()
          .includes(term)
    );
  }, [customers.data, query]);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
            Customers
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] sm:text-5xl">
            Know who you are speaking to.
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
            Find a customer, see the latest relationship context, and move
            naturally into the Assistant, a call, or the CRM.
          </p>
        </header>
        <label className="flex items-center gap-3 rounded-xl border border-[#DCE4EE] bg-white px-4 shadow-sm">
          <Search className="h-4 w-4 text-[#3F70D8]" />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search name, company, email or phone"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </label>

        {customers.isError ? (
          <section
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"
          >
            <p className="font-bold">Customers could not be loaded.</p>
            <p className="mt-2 text-sm">
              {friendlyError(
                customers.error,
                "Check the CRM connection and try again."
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
        ) : null}
        {customers.isLoading ? (
          <p className="text-sm text-[#66758A]">Loading customers…</p>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map(customer => (
              <article
                key={customer.id}
                className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-bold">
                      {customer.name}
                    </h2>
                    <p className="mt-1 flex items-center gap-1 text-xs text-[#66758A]">
                      <Building2 className="h-3 w-3" />
                      {customer.companyName || "No linked company"}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#EDF3FF] px-2.5 py-1 text-[9px] font-black uppercase text-[#3F70D8]">
                    {customer.lifecycleStage || "Customer"}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-[#526277]">
                  {customer.email ? (
                    <p className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-[#3F70D8]" />
                      {customer.email}
                    </p>
                  ) : null}
                  {customer.phone ? (
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-[#3F70D8]" />
                      {customer.phone}
                    </p>
                  ) : null}
                </div>
                <dl className="mt-4 space-y-3 rounded-xl bg-[#F7F9FC] p-4 text-xs">
                  <Fact
                    label="Last interaction"
                    value={
                      customer.lastInteraction
                        ? `${customer.lastInteraction.activityType.replaceAll("_", " ")} · ${new Date(customer.lastInteraction.occurredAt).toLocaleDateString()}`
                        : "No recent interaction"
                    }
                  />
                  <Fact
                    label="Open opportunity"
                    value={
                      customer.openOpportunity
                        ? `${customer.openOpportunity.name}${customer.openOpportunity.stage ? ` · ${customer.openOpportunity.stage}` : ""}`
                        : "None found"
                    }
                  />
                  <Fact
                    label="Next step"
                    value={
                      customer.nextAction
                        ? `${customer.nextAction.title}${customer.nextAction.dueAt ? ` · ${new Date(customer.nextAction.dueAt).toLocaleDateString()}` : ""}`
                        : customer.openOpportunity?.nextStepAt
                          ? `Opportunity next step · ${new Date(customer.openOpportunity.nextStepAt).toLocaleDateString()}`
                          : "No next step found"
                    }
                  />
                </dl>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/assistant?prompt=${encodeURIComponent(`What do we know about ${customer.name}?`)}`
                      )
                    }
                  >
                    <Bot className="mr-1 h-4 w-4" />
                    Ask
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/calls?contactId=${customer.id}`)}
                  >
                    <Headphones className="mr-1 h-4 w-4" />
                    Call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate("/crm")}
                  >
                    <MonitorUp className="mr-1 h-4 w-4" />
                    CRM
                  </Button>
                </div>
              </article>
            ))}
          </section>
        )}

        {!customers.isLoading && !customers.isError && !visible.length ? (
          <section className="rounded-2xl border border-dashed border-[#C9D4E2] bg-white p-10 text-center">
            <Users className="mx-auto h-8 w-8 text-[#3F70D8]" />
            <h2 className="mt-3 font-bold">
              {query
                ? "No customers match this search."
                : "No CRM customers yet."}
            </h2>
            <p className="mt-2 text-sm text-[#66758A]">
              {query
                ? "Change the search and try again."
                : "Connect a CRM and customers will appear here automatically."}
            </p>
            {!query ? (
              <Button className="mt-5" onClick={() => navigate("/connections")}>
                Open connections
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold text-[#8290A3]">{label}</dt>
      <dd className="mt-1 text-[#33445B]">{value}</dd>
    </div>
  );
}
