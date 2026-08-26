import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Download,
  Headphones,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export default function Reports() {
  const report = trpc.assistant.operationsDashboard.useQuery();
  const exportData = trpc.assistant.exportWorkspaceData.useMutation({
    onSuccess: file => {
      const bytes = Uint8Array.from(atob(file.base64), character =>
        character.charCodeAt(0)
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: file.contentType })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`${file.filename} is ready.`);
    },
    onError: error => toast.error(`Export failed: ${error.message}`),
  });
  const data = report.data;
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1500px] text-[#EEF5FF]">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
              REPORTS
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">
              Sales activity and results.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">
              Review recorded calls, follow-ups, approvals and Sales Assistant
              activity. Empty values mean no matching workspace activity has
              been recorded.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "operational_report", format: "csv" })
              }
              variant="outline"
              className="border-white/15 bg-white/5 text-white"
            >
              <Download className="mr-2 size-4" />
              Sales report CSV
            </Button>
            <Button
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "conversation_log", format: "pdf" })
              }
              variant="outline"
              className="border-white/15 bg-white/5 text-white"
            >
              <Download className="mr-2 size-4" />
              Call log PDF
            </Button>
          </div>
        </header>
        {report.isLoading && (
          <p className="mt-7 text-sm text-[#A9BFDF]">Preparing reports…</p>
        )}
        {report.isError && (
          <section className="mt-7 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-5">
            <p className="font-bold text-rose-100">
              Reports could not be loaded.
            </p>
            <p className="mt-2 text-sm text-rose-100/80">
              {report.error.message}
            </p>
            <Button
              onClick={() => report.refetch()}
              className="mt-4 bg-[#1B64F2]"
            >
              Retry reports
            </Button>
          </section>
        )}
        {data && (
          <>
            <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                icon={CalendarClock}
                label="Open follow-ups"
                value={data.metrics.openCallbacks}
                detail={`${data.metrics.dueTodayCallbacks} due today · ${data.metrics.overdueCallbacks} overdue`}
              />
              <Metric
                icon={Headphones}
                label="Calls in progress"
                value={data.metrics.activeCalls}
                detail={`${data.metrics.callsReadyForReview} outcomes ready for review`}
              />
              <Metric
                icon={ShieldCheck}
                label="Awaiting approval"
                value={data.metrics.reviewRequired}
                detail="Prepared actions waiting for a decision"
              />
              <Metric
                icon={CheckCircle2}
                label="Completed actions"
                value={data.metrics.executedActions}
                detail={`${data.metrics.blockedActions} actions need attention`}
              />
              <Metric
                icon={Activity}
                label="Work prepared"
                value={data.metrics.preparedWorkflows}
                detail="Recorded Sales Assistant workflows"
              />
            </section>
            <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportPanel
                title="Recent Sales Assistant activity"
                empty="No Sales Assistant activity has been recorded yet."
                items={data.recent.agentActivity.map(item => ({
                  id: item.id,
                  title: item.summary,
                  detail: `${item.eventType.replaceAll("_", " ")} · ${new Date(item.createdAt).toLocaleString()}`,
                }))}
              />
              <ReportPanel
                title="Recent decisions and results"
                empty="No approval or result history has been recorded yet."
                items={data.recent.audit.map(item => ({
                  id: item.id,
                  title: item.summary,
                  detail: `${item.eventType.replaceAll("_", " ")} · ${new Date(item.createdAt).toLocaleString()}`,
                }))}
              />
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#0E2142] p-5">
      <span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#94B9FF]">
        <Icon size={18} />
      </span>
      <p className="mt-4 text-sm font-semibold text-[#A9BFDF]">{label}</p>
      <p className="mt-1 font-display text-4xl font-bold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-[#849FC5]">{detail}</p>
    </article>
  );
}
function ReportPanel({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ id: number; title: string; detail: string }>;
  empty: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0E2142] p-5 sm:p-6">
      <h2 className="font-display text-2xl font-bold text-white">{title}</h2>
      <div className="mt-4 space-y-2">
        {items.length ? (
          items.map(item => (
            <article
              key={item.id}
              className="rounded-xl border border-white/10 bg-[#0B1B37] p-3"
            >
              <p className="text-sm font-semibold text-[#E4ECFA]">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-[#829CC2]">{item.detail}</p>
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-[#8EA8CF]">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}
