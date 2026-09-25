import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Target, TrendingUp } from "lucide-react";

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    maximumFractionDigits: 0,
  }).format((minor || 0) / 100);
}
function date(value: Date | string | null | undefined, timezone: string) {
  if (!value) return "Sale date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function SalesTracker() {
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const tracker = trpc.sales.tracker.useQuery(
    { organisationId: organisationId || 0 },
    { enabled: Boolean(organisationId), refetchInterval: 60_000 }
  );
  const data = tracker.data;
  const cards = data
    ? ([
        ["Today", data.summary.today, "Closed sales today"],
        ["This week", data.summary.week, "Closed sales since Monday"],
        ["This month", data.summary.month, "Closed sales this month"],
      ] as const)
    : [];
  return (
    <DashboardLayout>
      <main
        className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8"
        data-sales-tracker
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[#55788B]">
              Sales tracker
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#1F2F3D]">
              What you have actually sold
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66758A]">
              Read-only CRM truth. Only opportunities mapped to a confirmed Won
              stage count as sales.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#DCE4EE] bg-white px-3 py-2 text-xs text-[#66758A]">
            <CheckCircle2 className="h-4 w-4" /> No CRM writes
          </div>
        </div>
        {data?.stageMappingRequired ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No CRM pipeline stage is mapped to <strong>Won</strong>, so Sales
            Tracker is deliberately showing no inferred sales. A manager must
            confirm the authoritative Won stage mapping.
          </div>
        ) : null}
        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {cards.map(([label, summary, helper]) => (
            <article
              key={label}
              className="rounded-2xl border border-[#DCE4EE] bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#52647A]">{label}</p>
                <TrendingUp className="h-4 w-4 text-[#55788B]" />
              </div>
              <p className="mt-4 text-3xl font-semibold text-[#1F2F3D]">
                {summary.count}
              </p>
              <p className="mt-1 text-lg font-medium text-[#33445B]">
                {money(summary.valueMinor, data!.currency)}
              </p>
              <p className="mt-3 text-xs text-[#7A8798]">{helper}</p>
            </article>
          ))}
        </section>
        <section className="mt-6 rounded-2xl border border-[#DCE4EE] bg-white p-5">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-[#55788B]" />
            <h2 className="text-lg font-semibold text-[#1F2F3D]">
              Confirmed sales
            </h2>
          </div>
          {tracker.isLoading ? (
            <p className="mt-5 text-sm text-[#66758A]">
              Loading verified CRM sales…
            </p>
          ) : data?.sales.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[#E5EAF0] text-xs uppercase tracking-wide text-[#728197]">
                  <tr>
                    <th className="py-3 pr-4">Customer</th>
                    <th className="py-3 pr-4">Product / opportunity</th>
                    <th className="py-3 pr-4">Sale date</th>
                    <th className="py-3 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map(sale => (
                    <tr
                      key={sale.externalId}
                      className="border-b border-[#EEF2F5] last:border-0"
                    >
                      <td className="py-4 pr-4 font-medium text-[#26384A]">
                        {sale.customer}
                      </td>
                      <td className="py-4 pr-4 text-[#52647A]">
                        {sale.product}
                      </td>
                      <td className="py-4 pr-4 text-[#52647A]">
                        {date(sale.soldAt, data.timezone)}
                      </td>
                      <td className="py-4 text-right font-semibold text-[#26384A]">
                        {sale.valueMinor == null
                          ? "Value not recorded"
                          : money(
                              sale.valueMinor,
                              sale.currency || data.currency
                            )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 text-sm text-[#66758A]">
              No confirmed Won sales are currently synchronized for your CRM
              owner identity.
            </p>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}