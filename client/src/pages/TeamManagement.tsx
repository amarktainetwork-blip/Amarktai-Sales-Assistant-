import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
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
type OwnerMapping = { id: number; connectedSystemId: number; externalUserId: string; displayName: string; email: string | null; isActive: boolean; userId: number | null; memberName: string | null; memberEmail: string | null };
type OwnerMappingResponse = { mappings: OwnerMapping[] };
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
  const [mappings, setMappings] = useState<OwnerMapping[]>([]);
  const [settings, setSettings] = useState<ManagementSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "salesperson" | "auditor">("salesperson");
  const [sending, setSending] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [mapping, setMapping] = useState({ connectedSystemId: "", externalUserId: "", displayName: "", email: "", userId: "" });
  const [savingMapping, setSavingMapping] = useState(false);
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery({ organisationId: organisationId ?? 0 }, { enabled: Boolean(organisationId) });

  const refresh = useCallback(async () => {
    try {
      const [team, management, ownerMappings] = await Promise.all([
        api<TeamResponse>("/api/team-admin/members"),
        api<ManagementSettings>("/api/management-settings"),
        api<OwnerMappingResponse>("/api/team-admin/crm-owner-mappings"),
      ]);
      setData(team);
      setSettings(management);
      setMappings(ownerMappings.mappings);
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

  async function saveOwnerMapping(event: React.FormEvent) {
    event.preventDefault();
    setSavingMapping(true);
    try {
      await api<{ ok: boolean }>("/api/team-admin/crm-owner-mappings", { method: "PUT", body: JSON.stringify({ connectedSystemId: Number(mapping.connectedSystemId), externalUserId: mapping.externalUserId, displayName: mapping.displayName, email: mapping.email || null, userId: mapping.userId ? Number(mapping.userId) : null }) });
      toast.success("CRM owner mapping saved.");
      setMapping({ connectedSystemId: mapping.connectedSystemId, externalUserId: "", displayName: "", email: "", userId: "" });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save CRM owner mapping.");
    } finally {
      setSavingMapping(false);
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

    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><UserRoundCog size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">CRM OWNER MAPPING</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Attribute synchronized CRM work to the right person.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">Map the external owner identifier returned by a connected CRM to an active Amarktai member. Mappings are constrained to this organisation and audited; an unmapped owner remains visible as unmapped rather than being guessed.</p></div></div>
      <form onSubmit={saveOwnerMapping} className="mt-6 grid gap-3 lg:grid-cols-3">
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Connected system<select required value={mapping.connectedSystemId} onChange={event => setMapping({ ...mapping, connectedSystemId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm normal-case tracking-normal text-white"><option value="">Select a system</option>{systems.data?.map(system => <option key={system.id} value={system.id}>{system.displayName} · {system.status}</option>)}</select></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">CRM owner ID<Input required value={mapping.externalUserId} onChange={event => setMapping({ ...mapping, externalUserId: event.target.value })} placeholder="Provider owner ID" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">CRM owner name<Input required value={mapping.displayName} onChange={event => setMapping({ ...mapping, displayName: event.target.value })} placeholder="Name in CRM" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">CRM email (optional)<Input type="email" value={mapping.email} onChange={event => setMapping({ ...mapping, email: event.target.value })} placeholder="owner@company.example" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Amarktai member<select value={mapping.userId} onChange={event => setMapping({ ...mapping, userId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm normal-case tracking-normal text-white"><option value="">Leave unmapped</option>{data?.members.filter(member => member.isActive).map(member => <option key={member.userId} value={member.userId}>{member.name || member.email} · {member.role}</option>)}</select></label>
        <div className="flex items-end"><Button disabled={savingMapping || !systems.data?.length} className="h-11 w-full bg-[#1B64F2] hover:bg-[#2B76FF]">{savingMapping ? "Saving…" : "Save CRM owner mapping"}</Button></div>
      </form>
      {!systems.data?.length && <p className="mt-3 text-xs text-amber-100">Connect a CRM before recording owner mappings.</p>}
      <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[700px] text-left"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]"><tr><th className="pb-3 pr-4">CRM owner</th><th className="pb-3 pr-4">External ID</th><th className="pb-3 pr-4">Connected system</th><th className="pb-3">Amarktai member</th></tr></thead><tbody>{mappings.map(item => <tr key={item.id} className="border-b border-white/[.07]"><td className="py-3 pr-4"><p className="font-semibold text-white">{item.displayName}</p><p className="text-xs text-[#8FA9CE]">{item.email || "No CRM email"}</p></td><td className="py-3 pr-4 font-mono text-xs text-[#B6C9E8]">{item.externalUserId}</td><td className="py-3 pr-4 text-sm text-[#B6C9E8]">#{item.connectedSystemId}</td><td className="py-3 text-sm text-[#B6C9E8]">{item.memberName || item.memberEmail || "Unmapped"}</td></tr>)}{!mappings.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-[#A9BFDF]">No CRM owner mappings yet.</td></tr>}</tbody></table></div>
    </section>

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
