import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  BarChart3,
  CircleAlert,
  Loader2,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";

function money(valueMinor: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(valueMinor / 100);
  } catch {
    return String(valueMinor / 100);
  }
}

export default function TeamIntelligence() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const query = trpc.management.teamIntelligence.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId), retry: false }
  );
  if (query.isLoading || organisation.isLoading)
    return (
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-sm text-[#66758A]">
          <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
          Loading team priorities…
        </div>
      </DashboardLayout>
    );
  if (query.error)
    return (
      <DashboardLayout>
        <div
          role="alert"
          className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
        >
          {friendlyError(
            query.error,
            "Team priorities could not be loaded. Try again."
          )}
          <Button
            variant="outline"
            className="mt-4 block"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      </DashboardLayout>
    );
  const data = query.data;
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
                Team intelligence
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                See where management attention is needed.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A]">
                Focus on overdue work, unanswered customers, stale opportunities
                and missing next steps across the team.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate("/team/manage")}>
                <UserPlus className="mr-2 h-4 w-4" />
                Manage team
              </Button>
              <Button variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            icon={Users}
            label="Salespeople"
            value={data?.summary.mappedSalespeople ?? 0}
            detail="Linked to CRM work"
          />
          <Metric
            icon={AlertTriangle}
            label="Need attention"
            value={data?.summary.needsAttention ?? 0}
            detail="People with open exceptions"
            alert
          />
          <Metric
            icon={CircleAlert}
            label="Overdue tasks"
            value={data?.summary.overdueTasks ?? 0}
            detail="Past their due date"
            alert
          />
          <Metric
            icon={BarChart3}
            label="Stale opportunities"
            value={data?.summary.staleOpportunities ?? 0}
            detail="Without recent activity"
            alert
          />
          <Metric
            icon={BarChart3}
            label="Pipeline at risk"
            value={money(data?.summary.pipelineAtRiskMinor ?? 0)}
            detail="Value on stale opportunities"
            alert
          />
        </section>
        <section className="overflow-hidden rounded-3xl border border-[#DCE4EE] bg-white shadow-sm">
          <div className="border-b border-[#E5EAF0] p-5 sm:p-6">
            <h2 className="font-display text-2xl font-bold">
              People needing attention
            </h2>
            <p className="mt-1 text-sm text-[#66758A]">
              Start with the largest overdue workload or pipeline risk.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#F7F9FC] text-xs font-bold text-[#66758A]">
                <tr>
                  <th className="p-4">Salesperson</th>
                  <th className="p-4 text-right">Overdue</th>
                  <th className="p-4 text-right">Stale deals</th>
                  <th className="p-4 text-right">Missing next step</th>
                  <th className="p-4 text-right">Pipeline at risk</th>
                </tr>
              </thead>
              <tbody>
                {data?.people.length ? (
                  data.people.map(person => (
                    <tr
                      key={person.externalUserId}
                      className="border-t border-[#E8EDF3]"
                    >
                      <td className="p-4">
                        <p className="font-bold">{person.name}</p>
                        <p className="mt-1 text-xs text-[#8290A3]">
                          {person.userId
                            ? "Linked team member"
                            : "Not linked to a team member"}
                        </p>
                      </td>
                      <td className="p-4 text-right font-semibold">
                        {person.overdueTasks}
                      </td>
                      <td className="p-4 text-right font-semibold">
                        {person.staleOpportunities}
                      </td>
                      <td className="p-4 text-right font-semibold">
                        {person.noNextStep}
                      </td>
                      <td className="p-4 text-right font-semibold">
                        {money(person.pipelineAtRiskMinor)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-10 text-center text-sm text-[#66758A]"
                    >
                      No team exceptions are available yet. Connect and
                      synchronize a CRM, then link CRM salespeople to team
                      members.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  alert = false,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  detail: string;
  alert?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-[#66758A]">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tracking-[-.05em]">
            {value}
          </p>
        </div>
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ${alert ? "bg-amber-50 text-amber-700" : "bg-[#EDF3FF] text-[#3F70D8]"}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-xs text-[#8290A3]">{detail}</p>
    </article>
  );
}
