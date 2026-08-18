import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Activity, Cable, CheckCircle2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const services = [
  { key: "genie" as const, title: "CRM workspace bridge", readiness: (data: ReturnType<typeof useConnectionData>) => data?.genie.configured, text: "Reviewed browser workflows connect approved actions to the CRM only after live selector calibration and an authorised session are in place." },
  { key: "outlook" as const, title: "Messaging and calendar link", readiness: (data: ReturnType<typeof useConnectionData>) => data?.outlook.ready, text: "Communication and calendar capabilities remain inactive until the organisation connection, permissions, sender, and live verification are complete." },
  { key: "genx" as const, title: "Amarktai intelligence service", readiness: (data: ReturnType<typeof useConnectionData>) => data?.genx.ready, text: "Focused guidance, coaching, and summaries run through a server-side intelligence service. Configuration details remain private." },
];

function useConnectionData() { return trpc.integrations.list.useQuery().data; }

export default function Connections() {
  const query = trpc.integrations.list.useQuery();
  const create = trpc.integrations.createProfile.useMutation({ onSuccess: () => { query.refetch(); toast.success("Connection profile saved."); }, onError: error => toast.error(error.message) });
  return <DashboardLayout><div className="mx-auto max-w-[1450px]"><header className="border-b border-white/10 pb-7"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">AMARKTAI NETWORK / CONNECTION HEALTH</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">Know what is ready—and what still needs work.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF] sm:text-base">A saved profile records the intended connection. Readiness reflects only the current server configuration; a real external action must still be tested and evidenced before it is called live.</p></header>
    <section className="mt-8 grid gap-5 xl:grid-cols-3">{services.map(service => { const ready = service.readiness(query.data); return <article key={service.key} className="flex min-h-[320px] flex-col rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6 shadow-[0_18px_40px_rgba(0,0,0,.16)]"><span className="grid size-12 place-items-center rounded-2xl bg-[#153B7A] text-[#94B9FF]"><Cable size={20}/></span><div className="mt-7 flex items-start justify-between gap-3"><h2 className="font-display text-3xl font-bold leading-[.92] tracking-[-.055em] text-white">{service.title}</h2><Readiness ready={Boolean(ready)}/></div><p className="mt-5 text-sm leading-6 text-[#A9BFDF]">{service.text}</p><Button variant="outline" disabled={create.isPending} onClick={() => create.mutate({ provider: service.key, displayName: `${service.title} profile`, scopeSummary: service.text })} className="mt-auto border-white/15 bg-white/5 text-white hover:bg-white/10"><Plus className="mr-2 size-4"/>Save connection profile</Button></article>; })}</section>
    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-5 shadow-[0_18px_40px_rgba(0,0,0,.16)] sm:p-6"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#94B9FF]"><Activity size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">SAVED PROFILES</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Connection records</h2></div></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{query.data?.profiles.length ? query.data.profiles.map(profile => <article key={profile.id} className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"><div className="flex items-center justify-between gap-3"><p className="font-bold text-white">{profile.displayName}</p><span className="rounded-full bg-[#153B7A] px-2.5 py-1 text-[10px] font-black uppercase tracking-[.12em] text-[#94B9FF]">{profile.status.replaceAll("_", " ")}</span></div><p className="mt-2 text-xs leading-5 text-[#9DB3D5]">{profile.scopeSummary || "No scope summary was saved."}</p></article>) : <p className="rounded-xl border border-dashed border-white/15 bg-white/[.03] p-5 text-sm text-[#8FA9CE]">No connection profiles are saved yet.</p>}</div></section>
  </div></DashboardLayout>;
}

function Readiness({ ready }: { ready: boolean }) { return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.11em]", ready ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-[#A9BFDF]")}>{ready && <CheckCircle2 size={12}/>} {ready ? "Configured" : "Not configured"}</span>; }
