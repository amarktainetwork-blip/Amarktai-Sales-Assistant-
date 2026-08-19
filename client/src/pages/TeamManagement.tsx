import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BellRing, CheckCircle2, MailPlus, RefreshCw, ShieldCheck, UserRoundCog, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Member = {
  memberId: number;
  userId: number;
  name: string | null;
  email: string | null;
  role: "owner" | "manager" | "salesperson" | "auditor";
  isActive: boolean;
  hasPassword: boolean;
  createdAt: string;
};
type TeamResponse = { organisation: { id: number; name: string; role: string }; members: Member[] };
type ManagementSettings = {
  reportMode: "daily_full" | "exceptions_only";
  overdueTaskThreshold: number;
  staleOpportunityThreshold: number;
  noNextStepThreshold: number;
  includeHealthyPeople: boolean;
};

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

export default function TeamManagement() {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [settings, setSettings] = useState<ManagementSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "salesperson" | "auditor">("salesperson");
  const [sending, setSending] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [team, management] = await Promise.all([
        api<TeamResponse>("/api/team-admin/members"),
        api<ManagementSettings>("/api/management-settings"),
      ]);
      setData(team);
      setSettings(management);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load team administration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      const result = await api<{ ok: boolean; emailState: string }>("/api/team-admin/invite", { method: "POST", body: JSON.stringify({ name, email, role }) });
      toast.success(result.emailState === "invite_sent" ? "Invitation sent." : "Existing Amarktai user added and notified.");
      setName(""); setEmail(""); setRole("salesperson");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not invite team member.");
    } finally {
      setSending(false);
    }
  }

  async function updateMember(member: Member, patch: Record<string, unknown>) {
    try {
      await api<{ ok: boolean }>(`/api/team-admin/members/${member.memberId}`, { method: "PATCH", body: JSON.stringify(patch) });
      toast.success("Member access updated.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update member.");
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setSavingSettings(true);
    try {
      setSettings(await api<ManagementSettings>("/api/management-settings", { method: "PUT", body: JSON.stringify(settings) }));
      toast.success("Management Intelligence settings saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Management Intelligence settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  const threshold = (key: keyof Pick<ManagementSettings, "overdueTaskThreshold" | "staleOpportunityThreshold" | "noNextStepThreshold">, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: Math.max(0, Math.min(1000, Number.parseInt(value || "0", 10) || 0)) });
  };

  return <DashboardLayout><div className="mx-auto max-w-[1500px]">
    <header className="flex flex-col gap-5 border-b border-white/10 pb-7 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">AMARKTAI / TEAM ADMINISTRATION</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.07em] text-white sm:text-5xl">Give every salesperson their own protected workspace.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">Invite salespeople and managers into the same company. Each person signs in separately; CRM owner mappings then attribute normalized work and management intelligence to the right member.</p>
      </div>
      <Button variant="outline" onClick={() => void refresh()} className="border-white/15 bg-white/5 text-white hover:bg-white/10"><RefreshCw className="mr-2 size-4"/>Refresh</Button>
    </header>

    <div className="mt-7 grid gap-6 xl:grid-cols-[.72fr_1.28fr]">
      <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><MailPlus size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">NEW MEMBER</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Send secure invitation</h2></div></div>
        <form onSubmit={invite} className="mt-6 grid gap-4">
          <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Name<Input required value={name} onChange={event => setName(event.target.value)} className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
          <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Email<Input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
          <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Organisation role<select value={role} onChange={event => setRole(event.target.value as typeof role)} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"><option value="salesperson">Salesperson</option><option value="manager">Manager</option><option value="auditor">Auditor / read only</option></select></label>
          <Button disabled={sending} className="mt-2 h-12 bg-[#1B64F2] hover:bg-[#2B76FF]">{sending ? "Sending…" : "Send invitation"}</Button>
        </form>
        <p className="mt-4 text-xs leading-5 text-[#829DC3]">Amarktai emails a password-setup link. No temporary plaintext password is stored or shown to management. SMTP must be configured.</p>
      </section>

      <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><Users size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">{data?.organisation.name ?? "ORGANISATION"}</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Members</h2></div></div>
        {loading ? <p className="mt-6 text-sm text-[#A9BFDF]">Loading members…</p> : <div className="mt-5 space-y-3">{data?.members.map(member => <article key={member.memberId} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-[#0B1B37] p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-white">{member.name || member.email || `Member ${member.userId}`}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${member.isActive ? "bg-emerald-400/10 text-emerald-200" : "bg-white/10 text-[#A9BFDF]"}`}>{member.isActive ? "Active" : "Inactive"}</span>{member.hasPassword ? <CheckCircle2 className="size-4 text-emerald-300"/> : <span className="text-xs text-amber-200">Invite pending</span>}</div><p className="mt-1 text-xs text-[#8FA9CE]">{member.email} · {member.role}</p></div><div className="flex flex-wrap items-center gap-2">{member.role !== "owner" && <><select value={member.role} onChange={event => void updateMember(member, { role: event.target.value })} className="h-9 rounded-lg border border-white/15 bg-[#08172F] px-2 text-xs text-white"><option value="salesperson">Salesperson</option><option value="manager">Manager</option><option value="auditor">Auditor</option></select><Button size="sm" variant="outline" onClick={() => void updateMember(member, { isActive: !member.isActive })} className="border-white/15 bg-white/5 text-white hover:bg-white/10">{member.isActive ? "Deactivate" : "Reactivate"}</Button></>} {member.role === "owner" && <span className="inline-flex items-center gap-1 text-xs font-bold text-[#9FC2FF]"><ShieldCheck size={14}/>Owner</span>}</div></article>)}{!data?.members.length && <p className="text-sm text-[#A9BFDF]">No members yet.</p>}</div>}
      </section>
    </div>

    {settings && <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><BellRing size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">MANAGEMENT INTELLIGENCE</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Choose when management gets interrupted.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">These thresholds are deterministic CRM rules. They do not monitor private browsing, keystrokes, webcams or unrelated employee activity and do not consume GenX credits.</p></div></div><Button disabled={savingSettings} onClick={() => void saveSettings()} className="bg-[#1B64F2] hover:bg-[#2B76FF]">{savingSettings ? "Saving…" : "Save management rules"}</Button></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        <label className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-xs font-black uppercase tracking-[.1em] text-[#9EB6DB]">Email mode<select value={settings.reportMode} onChange={event => setSettings({ ...settings, reportMode: event.target.value as ManagementSettings["reportMode"] })} className="mt-3 h-10 w-full rounded-lg border border-white/15 bg-[#08172F] px-2 text-sm font-semibold normal-case tracking-normal text-white"><option value="exceptions_only">Exceptions only</option><option value="daily_full">Daily full brief</option></select></label>
        <label className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-xs font-black uppercase tracking-[.1em] text-[#9EB6DB]">Overdue tasks<Input type="number" min={0} max={1000} value={settings.overdueTaskThreshold} onChange={event => threshold("overdueTaskThreshold", event.target.value)} className="mt-3 border-white/15 bg-[#08172F] text-white"/><span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-[#7693BB]">0 disables this trigger.</span></label>
        <label className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-xs font-black uppercase tracking-[.1em] text-[#9EB6DB]">Stale opportunities<Input type="number" min={0} max={1000} value={settings.staleOpportunityThreshold} onChange={event => threshold("staleOpportunityThreshold", event.target.value)} className="mt-3 border-white/15 bg-[#08172F] text-white"/><span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-[#7693BB]">0 disables this trigger.</span></label>
        <label className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-xs font-black uppercase tracking-[.1em] text-[#9EB6DB]">Missing next steps<Input type="number" min={0} max={1000} value={settings.noNextStepThreshold} onChange={event => threshold("noNextStepThreshold", event.target.value)} className="mt-3 border-white/15 bg-[#08172F] text-white"/><span className="mt-2 block text-[11px] font-normal normal-case tracking-normal text-[#7693BB]">0 disables this trigger.</span></label>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-[#C9D7ED]"><input type="checkbox" checked={settings.includeHealthyPeople} onChange={event => setSettings({ ...settings, includeHealthyPeople: event.target.checked })} className="size-4"/>Include healthy/on-track people in Daily Full Brief. Exceptions Only never emails healthy people.</label>
    </section>}

    <section className="mt-6 rounded-2xl border border-white/10 bg-[#0E2142] p-5"><div className="flex gap-3"><UserRoundCog className="mt-0.5 size-5 shrink-0 text-[#83AEFF]"/><p className="text-sm leading-6 text-[#A9BFDF]">CRM users are mapped separately to these Amarktai members. That prevents a company-wide CRM sync from being repeated once per salesperson and keeps management metrics attributable to the correct owner.</p></div></section>
  </div></DashboardLayout>;
}
