import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BadgeDollarSign, Bot, Loader2, Save, ShieldCheck, Target, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Policy = { mode: "advise" | "review" | "auto_preapproved"; autoActionTypes: string[]; requireReviewForCommunications?: boolean; requireReviewForStageChanges?: boolean };
type Capabilities = { policy: Policy; actionTypes: string[] };
type Wallet = { balance: number; used: number; purchased: number; plan: { key: string; name: string; includedAiCredits: number }; entries: Array<{ id: number; creditsDelta: number; transactionType: string; feature?: string; occurredAt: string }> };
type Member = { userId: number; name: string | null; email: string | null; role: string; isActive: boolean };
type TargetRow = { userId: number; dailyActivityTarget: number; monthlyWonValueTargetMinor: number; maxOverdueTasks: number };

const autoOptions = [
  ["append_contact_note", "Add factual CRM notes"], ["schedule_callback", "Create callbacks/tasks"], ["complete_active_task", "Complete known tasks"], ["create_activity", "Log CRM activities"],
  ["update_contact", "Update contact fields"], ["update_opportunity", "Update opportunity fields"], ["send_email", "Send email"], ["send_sms", "Send SMS"], ["send_whatsapp", "Send WhatsApp"],
] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
  return body as T;
}

export default function AdminControls() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [capabilityData, creditData, memberData, targetData] = await Promise.all([
        request<Capabilities>("/api/sales-automation/capabilities"), request<Wallet>("/api/ai-credits"), request<{ members: Member[] }>("/api/team-admin/members"), request<{ targets: TargetRow[]; currency: string }>("/api/sales-targets"),
      ]);
      setPolicy(capabilityData.policy); setWallet(creditData); setMembers(memberData.members); setTargets(targetData.targets); setCurrency(targetData.currency);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Management controls could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function row(userId: number) { return targets.find(target => target.userId === userId) || { userId, dailyActivityTarget: 0, monthlyWonValueTargetMinor: 0, maxOverdueTasks: 0 }; }
  function updateTarget(userId: number, patch: Partial<TargetRow>) { setTargets(current => { const exists = current.some(target => target.userId === userId); return exists ? current.map(target => target.userId === userId ? { ...target, ...patch } : target) : [...current, { ...row(userId), ...patch }]; }); }
  function toggleAuto(actionType: string) { if (!policy) return; setPolicy({ ...policy, autoActionTypes: policy.autoActionTypes.includes(actionType) ? policy.autoActionTypes.filter(value => value !== actionType) : [...policy.autoActionTypes, actionType] }); }

  async function savePolicy() {
    if (!policy) return;
    try { setSaving("policy"); const result = await request<{ policy: Policy }>("/api/sales-automation/policy", { method: "PUT", body: JSON.stringify(policy) }); setPolicy(result.policy); toast.success("Automation policy saved."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Policy could not be saved."); }
    finally { setSaving(null); }
  }
  async function saveTargets() {
    try { setSaving("targets"); const result = await request<{ targets: TargetRow[] }>("/api/sales-targets", { method: "PUT", body: JSON.stringify({ targets }) }); setTargets(result.targets); toast.success("Sales targets saved."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Targets could not be saved."); }
    finally { setSaving(null); }
  }

  if (loading) return <DashboardLayout><div className="grid min-h-[60vh] place-items-center"><Loader2 className="size-7 animate-spin text-[#8CB7FF]"/></div></DashboardLayout>;
  return <DashboardLayout><div className="mx-auto max-w-[1500px] space-y-6">
    <header className="border-b border-white/10 pb-7"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">MANAGEMENT CONTROLS</p><h1 className="mt-2 font-display text-5xl font-bold tracking-[-.07em] text-white">Decide what Amarktai may do automatically.</h1><p className="mt-3 max-w-4xl text-sm leading-6 text-[#A9BFDF]">Set the automation boundary, salesperson targets and AI budget. CRM monitoring, task arithmetic and management exceptions remain deterministic and do not consume AI Credits.</p></header>

    <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]"><article className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><ShieldCheck size={20}/></span><div><p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">AUTOMATION POLICY</p><h2 className="font-display text-3xl font-bold text-white">Human control where it matters.</h2></div></div>
      <label className="mt-5 grid gap-2"><span className="text-xs font-bold text-[#A9BFDF]">Operating mode</span><select value={policy?.mode || "review"} onChange={e => policy && setPolicy({ ...policy, mode: e.target.value as Policy["mode"] })} className="h-12 rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"><option value="advise">Advise only</option><option value="review">Review before execution</option><option value="auto_preapproved">Auto-execute pre-approved actions</option></select></label>
      <div className="mt-5"><p className="text-xs font-bold text-[#A9BFDF]">Actions management explicitly allows in auto mode</p><div className="mt-3 grid gap-2 md:grid-cols-2">{autoOptions.map(([value, label]) => <label key={value} className="flex cursor-pointer gap-3 rounded-xl border border-white/10 bg-[#08172F] p-3 text-sm text-[#C5D6EF]"><input type="checkbox" checked={Boolean(policy?.autoActionTypes.includes(value))} onChange={() => toggleAuto(value)} className="mt-0.5"/><span>{label}</span></label>)}</div></div>
      <div className="mt-5 space-y-2"><label className="flex items-center gap-3 text-sm text-[#C5D6EF]"><input type="checkbox" checked={policy?.requireReviewForCommunications !== false} onChange={e => policy && setPolicy({ ...policy, requireReviewForCommunications: e.target.checked })}/>Always review outbound customer communications</label><label className="flex items-center gap-3 text-sm text-[#C5D6EF]"><input type="checkbox" checked={policy?.requireReviewForStageChanges !== false} onChange={e => policy && setPolicy({ ...policy, requireReviewForStageChanges: e.target.checked })}/>Always review pipeline/status changes</label></div>
      <Button onClick={savePolicy} disabled={saving === "policy"} className="mt-6 bg-[#1B64F2] hover:bg-[#2B76FF]"><Save className="mr-2 size-4"/>{saving === "policy" ? "Saving…" : "Save automation policy"}</Button>
    </article>

    <article className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><BadgeDollarSign size={20}/></span><div><p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">AI CREDIT POOL</p><h2 className="font-display text-3xl font-bold text-white">{wallet?.balance ?? 0} credits available</h2></div></div><div className="mt-5 grid grid-cols-3 gap-3"><Metric label="Plan" value={wallet?.plan.name || "Trial"}/><Metric label="Used" value={wallet?.used || 0}/><Metric label="Purchased" value={wallet?.purchased || 0}/></div><p className="mt-5 rounded-xl bg-[#08172F] p-4 text-sm leading-6 text-[#A9BFDF]">Included allowance: <strong className="text-white">{wallet?.plan.includedAiCredits || 0}</strong> per plan period. AI Credits are reserved for language/reasoning work; CRM sync, rules, management thresholds and deterministic actions remain zero-credit operations.</p><div className="mt-5 max-h-56 space-y-2 overflow-auto">{wallet?.entries.slice(0, 8).map(entry => <div key={entry.id} className="flex items-center justify-between rounded-xl border border-white/8 px-3 py-2 text-xs"><span className="text-[#9DB3D5]">{entry.feature || entry.transactionType}</span><span className={entry.creditsDelta >= 0 ? "font-bold text-emerald-300" : "font-bold text-amber-200"}>{entry.creditsDelta >= 0 ? "+" : ""}{entry.creditsDelta}</span></div>)}</div></article></section>

    <section className="rounded-[1.75rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><Target size={20}/></span><div><p className="text-[10px] font-black uppercase tracking-[.13em] text-[#7FAAF8]">SALESPERSON TARGETS</p><h2 className="font-display text-3xl font-bold text-white">Targets Management Intelligence can explain.</h2></div></div><Button onClick={saveTargets} disabled={saving === "targets"} className="bg-[#1B64F2] hover:bg-[#2B76FF]"><Save className="mr-2 size-4"/>{saving === "targets" ? "Saving…" : "Save targets"}</Button></div>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]"><th className="pb-3">Salesperson</th><th className="pb-3">Daily CRM activity</th><th className="pb-3">Monthly won target ({currency})</th><th className="pb-3">Maximum overdue tasks</th></tr></thead><tbody>{members.filter(member => member.isActive && ["salesperson", "manager", "owner"].includes(member.role)).map(member => { const target = row(member.userId); return <tr key={member.userId} className="border-t border-white/8"><td className="py-4 pr-4"><p className="font-bold text-white">{member.name || member.email || `User ${member.userId}`}</p><p className="text-xs text-[#829CC4]">{member.role}</p></td><td className="py-4 pr-4"><Input type="number" min={0} value={target.dailyActivityTarget} onChange={e => updateTarget(member.userId, { dailyActivityTarget: Number(e.target.value) })} className="w-40 border-white/15 bg-[#08172F] text-white"/></td><td className="py-4 pr-4"><Input type="number" min={0} step="0.01" value={(target.monthlyWonValueTargetMinor / 100).toFixed(2)} onChange={e => updateTarget(member.userId, { monthlyWonValueTargetMinor: Math.round(Number(e.target.value) * 100) })} className="w-52 border-white/15 bg-[#08172F] text-white"/></td><td className="py-4"><Input type="number" min={0} value={target.maxOverdueTasks} onChange={e => updateTarget(member.userId, { maxOverdueTasks: Number(e.target.value) })} className="w-40 border-white/15 bg-[#08172F] text-white"/></td></tr>; })}</tbody></table></div><p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#829CC4]"><Users className="mt-0.5 size-4 shrink-0"/>Amarktai compares actual CRM ownership/activity with these explicit targets. It does not generate a hidden AI employee score.</p>
    </section>

    <section className="rounded-[1.5rem] border border-[#3D69AD]/30 bg-[#102A56] p-5"><div className="flex gap-3"><Bot className="mt-0.5 size-5 text-[#9FC2FF]"/><p className="text-sm leading-6 text-[#C5D6EF]"><strong className="text-white">Management Intelligence remains deterministic.</strong> GenX can optionally explain a complex situation, but it does not decide whether someone missed a target, has overdue tasks or has stale revenue.</p></div></section>
  </div></DashboardLayout>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl bg-[#08172F] p-3"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">{label}</p><p className="mt-1 font-display text-2xl font-bold text-white">{value}</p></div>; }
