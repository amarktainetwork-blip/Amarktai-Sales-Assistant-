import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BellRing, CheckCircle2, FileLock2, Landmark, MailPlus, RefreshCw, ShieldCheck, UserRoundCog, Users } from "lucide-react";
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
type PipelineStageMapping = { id: number; connectedSystemId: number; externalPipelineId: string; externalStageId: string; pipelineLabel: string; stageLabel: string; category: "open" | "qualified" | "proposal" | "won" | "lost" | "other"; isActive: boolean };
type PipelineStageMappingResponse = { mappings: PipelineStageMapping[] };
type ConnectedSystem = { id: number; displayName: string; status: string };
type ManagementSettings = {
  reportMode: "daily_full" | "exceptions_only";
  overdueTaskThreshold: number;
  staleOpportunityThreshold: number;
  noNextStepThreshold: number;
  includeHealthyPeople: boolean;
};
type CompliancePolicy = { transcriptRetentionDays: number; auditRetentionDays: number; operationalRetentionDays: number; outboundConsentRequired: boolean; deletionApprovalRequired: boolean; policyText: string | null };
type DataSubjectRequest = { id: number; requestType: "export" | "deletion"; subjectType: string; subjectReference: string; status: string; createdAt: string };
type EnterpriseSettings = { identityConnections: { id: number; protocol: string; displayName: string; status: string }[]; entitlement: { planKey: string; status: string; providerReference: string | null } | null };
type PlaybookVersion = { id: number; playbookKey: string; version: number; title: string; instructions: string; status: "draft" | "published" | "archived" };
type ConnectorOperations = { jobs: Array<{ id: number; connectedSystemId: number; resourceType: string; scheduleExpression: string; capabilityKey: string; status: string; lastError: string | null }>; receipts: Array<{ id: number; connectedSystemId: number; eventType: string; signatureStatus: string; processingStatus: string; attempts: number; receivedAt: string }> };

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

export default function TeamManagement() {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [mappings, setMappings] = useState<OwnerMapping[]>([]);
  const [pipelineMappings, setPipelineMappings] = useState<PipelineStageMapping[]>([]);
  const [settings, setSettings] = useState<ManagementSettings | null>(null);
  const [compliance, setCompliance] = useState<CompliancePolicy | null>(null);
  const [dataSubjectRequests, setDataSubjectRequests] = useState<DataSubjectRequest[]>([]);
  const [enterprise, setEnterprise] = useState<EnterpriseSettings | null>(null);
  const [playbookVersions, setPlaybookVersions] = useState<PlaybookVersion[]>([]);
  const [playbookDraft, setPlaybookDraft] = useState({ playbookKey: "", title: "", instructions: "" });
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [connectorOperations, setConnectorOperations] = useState<ConnectorOperations>({ jobs: [], receipts: [] });
  const [syncJob, setSyncJob] = useState({ connectedSystemId: "", resourceType: "", scheduleExpression: "", capabilityKey: "" });
  const [savingSyncJob, setSavingSyncJob] = useState(false);
  const [savingCompliance, setSavingCompliance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "salesperson" | "auditor">("salesperson");
  const [sending, setSending] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [mapping, setMapping] = useState({ connectedSystemId: "", externalUserId: "", displayName: "", email: "", userId: "" });
  const [savingMapping, setSavingMapping] = useState(false);
  const [pipelineMapping, setPipelineMapping] = useState({ connectedSystemId: "", externalPipelineId: "", externalStageId: "", pipelineLabel: "", stageLabel: "", category: "other" as PipelineStageMapping["category"] });
  const [savingPipelineMapping, setSavingPipelineMapping] = useState(false);
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery({ organisationId: organisationId ?? 0 }, { enabled: Boolean(organisationId) });

  const refresh = useCallback(async () => {
    try {
      const [team, management, ownerMappings, savedPipelineMappings, savedCompliance, subjectRequests, enterpriseSettings, versionedPlaybooks, operations] = await Promise.all([
        api<TeamResponse>("/api/team-admin/members"),
        api<ManagementSettings>("/api/management-settings"),
        api<OwnerMappingResponse>("/api/team-admin/crm-owner-mappings"),
        api<PipelineStageMappingResponse>("/api/team-admin/crm-pipeline-stage-mappings"),
        api<{ policy: CompliancePolicy | null }>("/api/team-admin/compliance-policy"),
        api<{ requests: DataSubjectRequest[] }>("/api/team-admin/data-subject-requests"),
        api<EnterpriseSettings>("/api/team-admin/enterprise-settings"),
        api<{ playbooks: PlaybookVersion[] }>("/api/team-admin/playbook-versions"),
        api<ConnectorOperations>("/api/team-admin/connector-operations"),
      ]);
      setData(team);
      setSettings(management);
      setMappings(ownerMappings.mappings);
      setPipelineMappings(savedPipelineMappings.mappings);
      setCompliance(savedCompliance.policy ?? { transcriptRetentionDays: 90, auditRetentionDays: 365, operationalRetentionDays: 365, outboundConsentRequired: true, deletionApprovalRequired: true, policyText: null });
      setDataSubjectRequests(subjectRequests.requests);
      setEnterprise(enterpriseSettings);
      setPlaybookVersions(versionedPlaybooks.playbooks);
      setConnectorOperations(operations);
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

  async function saveCompliance() {
    if (!compliance) return;
    setSavingCompliance(true);
    try {
      await api<{ ok: boolean }>("/api/team-admin/compliance-policy", { method: "PUT", body: JSON.stringify(compliance) });
      toast.success("Privacy and retention policy saved.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save privacy policy.");
    } finally {
      setSavingCompliance(false);
    }
  }

  async function reviewDataSubjectRequest(id: number, decision: "approved" | "rejected") {
    try {
      await api<{ ok: boolean }>(`/api/team-admin/data-subject-requests/${id}/review`, { method: "PUT", body: JSON.stringify({ decision }) });
      toast.success(`Request ${decision}.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review request.");
    }
  }

  async function createPlaybookVersion(event: React.FormEvent) {
    event.preventDefault();
    setSavingPlaybook(true);
    try {
      await api<{ id: number }>("/api/team-admin/playbook-versions", { method: "POST", body: JSON.stringify(playbookDraft) });
      toast.success("Draft playbook revision created.");
      setPlaybookDraft({ playbookKey: "", title: "", instructions: "" });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create playbook draft.");
    } finally {
      setSavingPlaybook(false);
    }
  }

  async function publishPlaybookVersion(id: number) {
    try {
      await api<{ ok: boolean }>(`/api/team-admin/playbook-versions/${id}/publish`, { method: "PUT" });
      toast.success("Playbook version published; the prior published revision was archived.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish playbook revision.");
    }
  }

  async function saveSyncJob(event: React.FormEvent) {
    event.preventDefault();
    setSavingSyncJob(true);
    try {
      const result = await api<{ status: string }>("/api/team-admin/connector-sync-jobs", { method: "POST", body: JSON.stringify({ ...syncJob, connectedSystemId: Number(syncJob.connectedSystemId) }) });
      toast.success(result.status === "ready" ? "Verified connector sync job is ready." : "Sync job saved as draft until the connector capability is verified.");
      setSyncJob({ connectedSystemId: syncJob.connectedSystemId, resourceType: "", scheduleExpression: "", capabilityKey: "" });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save connector sync job.");
    } finally {
      setSavingSyncJob(false);
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

  async function savePipelineMapping(event: React.FormEvent) {
    event.preventDefault();
    setSavingPipelineMapping(true);
    try {
      await api<{ ok: boolean }>("/api/team-admin/crm-pipeline-stage-mappings", { method: "PUT", body: JSON.stringify({ ...pipelineMapping, connectedSystemId: Number(pipelineMapping.connectedSystemId) }) });
      toast.success("CRM pipeline stage mapping saved.");
      setPipelineMapping({ connectedSystemId: pipelineMapping.connectedSystemId, externalPipelineId: "", externalStageId: "", pipelineLabel: "", stageLabel: "", category: "other" });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save CRM pipeline stage mapping.");
    } finally {
      setSavingPipelineMapping(false);
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

    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><UserRoundCog size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">PIPELINE STAGE MAPPING</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Interpret your CRM pipeline without guessing.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">Record the real pipeline and stage identifiers supplied by a backend-verified CRM, then choose their reporting meaning. Mappings are organisation-scoped and audited; unmapped stages stay unclassified rather than being silently treated as won or lost.</p></div></div>
      <form onSubmit={savePipelineMapping} className="mt-6 grid gap-3 lg:grid-cols-3">
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Verified connected system<select required value={pipelineMapping.connectedSystemId} onChange={event => setPipelineMapping({ ...pipelineMapping, connectedSystemId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm normal-case tracking-normal text-white"><option value="">Select a ready system</option>{(systems.data as ConnectedSystem[] | undefined)?.filter(system => system.status === "ready").map(system => <option key={system.id} value={system.id}>{system.displayName}</option>)}</select></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Pipeline ID<Input required value={pipelineMapping.externalPipelineId} onChange={event => setPipelineMapping({ ...pipelineMapping, externalPipelineId: event.target.value })} placeholder="Provider pipeline ID" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Stage ID<Input required value={pipelineMapping.externalStageId} onChange={event => setPipelineMapping({ ...pipelineMapping, externalStageId: event.target.value })} placeholder="Provider stage ID" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Pipeline name<Input required value={pipelineMapping.pipelineLabel} onChange={event => setPipelineMapping({ ...pipelineMapping, pipelineLabel: event.target.value })} placeholder="e.g. New business" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Stage name<Input required value={pipelineMapping.stageLabel} onChange={event => setPipelineMapping({ ...pipelineMapping, stageLabel: event.target.value })} placeholder="e.g. Proposal sent" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label>
        <label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Reporting category<select value={pipelineMapping.category} onChange={event => setPipelineMapping({ ...pipelineMapping, category: event.target.value as PipelineStageMapping["category"] })} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm normal-case tracking-normal text-white"><option value="open">Open</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="won">Won</option><option value="lost">Lost</option><option value="other">Other / do not classify</option></select></label>
        <div className="flex items-end"><Button disabled={savingPipelineMapping || !(systems.data as ConnectedSystem[] | undefined)?.some(system => system.status === "ready")} className="h-11 w-full bg-[#1B64F2] hover:bg-[#2B76FF]">{savingPipelineMapping ? "Saving…" : "Save pipeline stage"}</Button></div>
      </form>
      {!((systems.data as ConnectedSystem[] | undefined)?.some(system => system.status === "ready")) && <p className="mt-3 text-xs text-amber-100">Verify a CRM connection before recording pipeline stages.</p>}
      <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]"><tr><th className="pb-3 pr-4">Pipeline</th><th className="pb-3 pr-4">Stage</th><th className="pb-3 pr-4">Provider IDs</th><th className="pb-3">Reporting category</th></tr></thead><tbody>{pipelineMappings.map(item => <tr key={item.id} className="border-b border-white/[.07]"><td className="py-3 pr-4 font-semibold text-white">{item.pipelineLabel}</td><td className="py-3 pr-4 text-sm text-[#B6C9E8]">{item.stageLabel}</td><td className="py-3 pr-4 font-mono text-xs text-[#8FA9CE]">{item.externalPipelineId} / {item.externalStageId}</td><td className="py-3 text-sm capitalize text-[#B6C9E8]">{item.category}</td></tr>)}{!pipelineMappings.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-[#A9BFDF]">No pipeline stage mappings yet.</td></tr>}</tbody></table></div>
    </section>

    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><ShieldCheck size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">VERSIONED PLAYBOOKS</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Publish the exact instructions that workflows may use.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">Drafts are never selected at runtime. Publishing a revision archives the former published revision for the same key, preserving a clear rollback and audit trail.</p></div></div><form onSubmit={createPlaybookVersion} className="mt-6 grid gap-3 lg:grid-cols-3"><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Playbook key<Input required value={playbookDraft.playbookKey} onChange={event => setPlaybookDraft({ ...playbookDraft, playbookKey: event.target.value })} placeholder="e.g. follow-up-review" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Title<Input required value={playbookDraft.title} onChange={event => setPlaybookDraft({ ...playbookDraft, title: event.target.value })} placeholder="Clear internal title" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label><div className="flex items-end"><Button disabled={savingPlaybook} className="h-11 w-full bg-[#1B64F2] hover:bg-[#2B76FF]">{savingPlaybook ? "Creating…" : "Create draft revision"}</Button></div><label className="lg:col-span-3 text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Review-first instructions<Textarea required value={playbookDraft.instructions} onChange={event => setPlaybookDraft({ ...playbookDraft, instructions: event.target.value })} placeholder="State the allowed preparation steps, evidence requirements, and approval boundary." className="mt-2 min-h-24 border-white/15 bg-[#08172F] text-white"/></label></form><div className="mt-6 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]"><tr><th className="pb-3 pr-4">Playbook</th><th className="pb-3 pr-4">Revision</th><th className="pb-3 pr-4">Status</th><th className="pb-3">Control</th></tr></thead><tbody>{playbookVersions.map(version => <tr key={version.id} className="border-b border-white/[.07]"><td className="py-3 pr-4"><p className="font-semibold text-white">{version.title}</p><p className="font-mono text-xs text-[#8FA9CE]">{version.playbookKey}</p></td><td className="py-3 pr-4 text-sm text-[#B6C9E8]">v{version.version}</td><td className="py-3 pr-4 text-sm capitalize text-[#B6C9E8]">{version.status}</td><td className="py-3">{version.status === "draft" ? <Button size="sm" onClick={() => void publishPlaybookVersion(version.id)} className="bg-[#1B64F2] hover:bg-[#2B76FF]">Publish revision</Button> : <span className="text-xs text-[#8FA9CE]">Immutable</span>}</td></tr>)}{!playbookVersions.length && <tr><td colSpan={4} className="py-8 text-center text-sm text-[#A9BFDF]">No versioned playbooks yet. Create a draft to begin a controlled workflow.</td></tr>}</tbody></table></div></section>

    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><RefreshCw size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">CONNECTOR OPERATIONS</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Schedule only verified connector capabilities.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">A sync job is ready only when its connected system is server-verified for the stated capability. Webhook receipts stay ignored when their connector, HMAC signature, or capability is not verified.</p></div></div><form onSubmit={saveSyncJob} className="mt-6 grid gap-3 lg:grid-cols-4"><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Connected system<select required value={syncJob.connectedSystemId} onChange={event => setSyncJob({ ...syncJob, connectedSystemId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm normal-case tracking-normal text-white"><option value="">Select a system</option>{systems.data?.map(system => <option key={system.id} value={system.id}>{system.displayName} · {system.status}</option>)}</select></label><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Resource<Input required value={syncJob.resourceType} onChange={event => setSyncJob({ ...syncJob, resourceType: event.target.value })} placeholder="contacts" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Schedule<Input required value={syncJob.scheduleExpression} onChange={event => setSyncJob({ ...syncJob, scheduleExpression: event.target.value })} placeholder="0 */15 * * *" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label><label className="text-xs font-black uppercase tracking-[.12em] text-[#9EB6DB]">Capability<Input required value={syncJob.capabilityKey} onChange={event => setSyncJob({ ...syncJob, capabilityKey: event.target.value })} placeholder="read_contacts" className="mt-2 border-white/15 bg-[#08172F] text-white"/></label><div className="lg:col-span-4 flex justify-end"><Button disabled={savingSyncJob} className="bg-[#1B64F2] hover:bg-[#2B76FF]">{savingSyncJob ? "Saving…" : "Save sync job"}</Button></div></form><div className="mt-6 grid gap-4 xl:grid-cols-2"><div className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7FAAF8]">SYNC JOBS</p>{connectorOperations.jobs.length ? <div className="mt-3 space-y-2">{connectorOperations.jobs.map(job => <div key={job.id} className="rounded-lg border border-white/10 p-3 text-sm text-[#C9D7ED]"><b>{job.resourceType}</b> · {job.status} · system #{job.connectedSystemId}<p className="mt-1 font-mono text-xs text-[#8FA9CE]">{job.scheduleExpression} · {job.capabilityKey}</p>{job.lastError && <p className="mt-1 text-xs text-amber-100">{job.lastError}</p>}</div>)}</div> : <p className="mt-3 text-sm text-[#A9BFDF]">No connector sync jobs are configured.</p>}</div><div className="rounded-xl border border-white/10 bg-[#0B1B37] p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7FAAF8]">WEBHOOK RECEIPTS</p>{connectorOperations.receipts.length ? <div className="mt-3 space-y-2">{connectorOperations.receipts.slice(0, 8).map(receipt => <div key={receipt.id} className="rounded-lg border border-white/10 p-3 text-sm text-[#C9D7ED]"><b>{receipt.eventType}</b> · {receipt.processingStatus}<p className="mt-1 text-xs text-[#8FA9CE]">HMAC: {receipt.signatureStatus} · attempts: {receipt.attempts}</p></div>)}</div> : <p className="mt-3 text-sm text-[#A9BFDF]">No signed connector webhook receipts have been recorded.</p>}</div></div></section>

    {compliance && <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><FileLock2 size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">PRIVACY & RETENTION</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Set evidence-preserving lifecycle controls.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#9EB6DB]">Retention defaults to a dry run and destructive work requires an approved request. These settings never bypass CRM action review.</p></div></div><Button disabled={savingCompliance} onClick={() => void saveCompliance()} className="bg-[#1B64F2] hover:bg-[#2B76FF]">{savingCompliance ? "Saving…" : "Save privacy policy"}</Button></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">{([['transcriptRetentionDays', 'Conversation & transcript days'], ['auditRetentionDays', 'Audit evidence days'], ['operationalRetentionDays', 'Operational event days']] as const).map(([field, label]) => <label key={field} className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-xs font-black uppercase tracking-[.1em] text-[#9EB6DB]">{label}<Input type="number" min={1} max={3650} value={compliance[field]} onChange={event => setCompliance({ ...compliance, [field]: Number(event.target.value) || 1 })} className="mt-3 border-white/15 bg-[#08172F] text-white"/></label>)}</div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#C9D7ED]"><label className="flex items-center gap-2"><input type="checkbox" checked={compliance.outboundConsentRequired} onChange={event => setCompliance({ ...compliance, outboundConsentRequired: event.target.checked })}/>Require outbound consent</label><label className="flex items-center gap-2"><input type="checkbox" checked={compliance.deletionApprovalRequired} onChange={event => setCompliance({ ...compliance, deletionApprovalRequired: event.target.checked })}/>Require deletion approval</label></div>
      <div className="mt-6 rounded-xl border border-white/10 bg-[#0B1B37] p-4"><p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7FAAF8]">DATA-SUBJECT REQUEST QUEUE</p>{dataSubjectRequests.length ? <div className="mt-3 space-y-2">{dataSubjectRequests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm"><span className="text-[#D7E5FF]"><b className="capitalize">{request.requestType}</b> · {request.subjectType}: {request.subjectReference} <span className="text-[#8FA9CE]">({request.status.replace('_', ' ')})</span></span>{request.status === "review_required" && <span className="flex gap-2"><Button size="sm" onClick={() => void reviewDataSubjectRequest(request.id, "approved")} className="bg-[#1B64F2]">Approve</Button><Button size="sm" variant="outline" onClick={() => void reviewDataSubjectRequest(request.id, "rejected")} className="border-white/15 text-white">Reject</Button></span>}</div>)}</div> : <p className="mt-3 text-sm text-[#A9BFDF]">No privacy export or deletion requests are awaiting review.</p>}</div>
    </section>}

    <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><Landmark size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">ENTERPRISE CONFIGURATION</p><h2 className="font-display text-2xl font-bold tracking-[-.05em] text-white">Identity and entitlement status.</h2><p className="mt-2 text-sm leading-6 text-[#9EB6DB]">SAML/SCIM configurations remain drafts until an authorised identity provider is verified. The self-hosted entitlement record stays active without any payment provider being assumed or activated.</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-3">{enterprise?.identityConnections.map(connection => <div key={connection.id} className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-sm text-[#C9D7ED]"><p className="font-bold text-white">{connection.displayName}</p><p className="mt-1 uppercase text-xs text-[#8FA9CE]">{connection.protocol} · {connection.status}</p></div>)}<div className="rounded-xl border border-white/10 bg-[#0B1B37] p-4 text-sm text-[#C9D7ED]"><p className="font-bold text-white">{enterprise?.entitlement?.planKey ?? "self_hosted"}</p><p className="mt-1 text-xs text-[#8FA9CE]">Entitlement: {enterprise?.entitlement?.status ?? "active by local deployment default"}</p></div></div></section>

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
