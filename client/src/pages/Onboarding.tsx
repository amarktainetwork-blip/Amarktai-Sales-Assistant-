import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BadgeCheck, Building2, CheckCircle2, Globe2, Network, Plus, Rocket, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Provider = "genie" | "hubspot" | "salesforce" | "pipedrive" | "zoho" | "custom_browser";
type Method = "oauth" | "browser";
type CrmCapability =
  | "contacts.read" | "contacts.write"
  | "companies.read" | "companies.write"
  | "opportunities.read" | "opportunities.write"
  | "tasks.read" | "tasks.write"
  | "activities.read" | "activities.write"
  | "notes.read" | "notes.write"
  | "owners.read" | "pipelines.read"
  | "email.send" | "sms.send" | "whatsapp.send" | "sequences.apply";

type CrmForm = { provider: Provider; displayName: string; baseUrl: string; connectionMethod: Method; capabilities: CrmCapability[] };

const capabilityOptions: Array<{ value: CrmCapability; label: string }> = [
  { value: "contacts.read", label: "Read contacts" }, { value: "contacts.write", label: "Update contacts" },
  { value: "companies.read", label: "Read companies" }, { value: "companies.write", label: "Update companies" },
  { value: "opportunities.read", label: "Read opportunities" }, { value: "opportunities.write", label: "Update opportunities" },
  { value: "tasks.read", label: "Read tasks" }, { value: "tasks.write", label: "Manage tasks" },
  { value: "activities.read", label: "Read activities" }, { value: "activities.write", label: "Log activities" },
  { value: "notes.read", label: "Read notes" }, { value: "notes.write", label: "Write notes" },
  { value: "owners.read", label: "Read owners" }, { value: "pipelines.read", label: "Read pipelines" },
  { value: "email.send", label: "Send email" }, { value: "sms.send", label: "Send SMS" },
  { value: "whatsapp.send", label: "Send WhatsApp" }, { value: "sequences.apply", label: "Apply sequences" },
];
const defaultCapabilities: CrmCapability[] = ["contacts.read", "contacts.write", "companies.read", "opportunities.read", "opportunities.write", "tasks.read", "tasks.write", "activities.read", "activities.write", "notes.read", "notes.write", "owners.read", "pipelines.read"];
const providerLabels: Record<Provider, string> = { genie: "Genie", hubspot: "HubSpot", salesforce: "Salesforce", pipedrive: "Pipedrive", zoho: "Zoho CRM", custom_browser: "Other CRM" };
const steps = ["Company profile", "Website discovery", "Knowledge review", "CRM connection", "Playbooks", "Go-live review"];

function isBrowser(provider: Provider) { return provider === "genie" || provider === "custom_browser"; }
function Card({ children }: { children: React.ReactNode }) { return <section className="rounded-[1.75rem] border border-white/10 bg-[#0C1E3E] p-6 sm:p-8">{children}</section>; }
function StepHeading({ icon: Icon, number, title, text }: { icon: typeof Building2; number: string; title: string; text: string }) { return <div className="flex gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><Icon size={18}/></span><div><p className="text-[10px] font-black uppercase tracking-[.15em] text-[#83AEFF]">Step {number}</p><h2 className="mt-1 font-display text-2xl font-bold text-white">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#A9BFDF]">{text}</p></div></div>; }

export default function Onboarding() {
  const utils = trpc.useUtils();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const setup = trpc.companySetup.get.useQuery();
  const systems = trpc.connectedSystems.list.useQuery({ organisationId: organisationId ?? 0 }, { enabled: Boolean(organisationId) });
  const outlook = trpc.outlook.readiness.useQuery(undefined, { retry: false });
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState({ companyName: "", websiteUrl: "", industry: "", companySize: "", primaryMarket: "", salesMotion: "", brandVoice: "" });
  const [preview, setPreview] = useState<{ sourceUrl: string; proposedKnowledge: Array<{ title: string; content: string }> } | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<number[]>([]);
  const [crm, setCrm] = useState<CrmForm>({ provider: "hubspot", displayName: "HubSpot", baseUrl: "", connectionMethod: "oauth", capabilities: defaultCapabilities });
  const [playbook, setPlaybook] = useState({ title: "", trigger: "", description: "", agentKey: "supervisor" });

  useEffect(() => { const saved = setup.data?.profile; if (saved) setProfile({ companyName: saved.companyName, websiteUrl: saved.websiteUrl ?? "", industry: saved.industry ?? "", companySize: saved.companySize ?? "", primaryMarket: saved.primaryMarket ?? "", salesMotion: saved.salesMotion ?? "", brandVoice: saved.brandVoice ?? "" }); }, [setup.data?.profile]);

  const saveProfile = trpc.companySetup.saveProfile.useMutation({ onSuccess: () => { utils.companySetup.get.invalidate(); setStep(2); toast.success("Company profile saved."); }, onError: error => toast.error(error.message) });
  const discover = trpc.companySetup.discoverWebsite.useMutation({ onSuccess: result => { setPreview(result); setSelectedKnowledge(result.proposedKnowledge.map((_, index) => index)); setStep(3); toast.success("Website context is ready for review. Nothing has been stored."); }, onError: error => toast.error(error.message) });
  const confirm = trpc.companySetup.confirmDiscovery.useMutation({ onSuccess: () => { utils.companySetup.get.invalidate(); setPreview(null); setStep(4); toast.success("Selected knowledge was confirmed."); }, onError: error => toast.error(error.message) });
  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation();
  const addConnection = trpc.connectedSystems.create.useMutation({
    onSuccess: async id => {
      if (!organisationId) return;
      if (isBrowser(crm.provider)) {
        const url = new URL(crm.baseUrl);
        await addDomain.mutateAsync({ organisationId, connectedSystemId: id, hostname: url.hostname, allowedPaths: ["/"] });
        await systems.refetch();
        setStep(5);
        toast.success("CRM registered. Open Connections to add the encrypted login/profile and run verification.");
        return;
      }
      await systems.refetch();
      toast.success("CRM registered. Continue with the provider's secure OAuth screen.");
      const result = await beginOAuth.mutateAsync({ organisationId, connectedSystemId: id });
      window.location.assign(result.authorizationUrl);
    },
    onError: error => toast.error(error.message),
  });
  const savePlaybook = trpc.companySetup.savePlaybook.useMutation({ onSuccess: () => { utils.companySetup.get.invalidate(); setStep(6); toast.success("Review-first playbook saved."); }, onError: error => toast.error(error.message) });
  const profileSaved = Boolean(setup.data?.profile);
  const knowledgeConfirmed = setup.data?.profile?.discoveryStatus === "confirmed";
  const readySystems = systems.data?.filter(system => system.status === "ready") ?? [];

  function selectProvider(provider: Provider) {
    setCrm(current => ({ ...current, provider, displayName: providerLabels[provider], baseUrl: "", connectionMethod: isBrowser(provider) ? "browser" : "oauth" }));
  }
  function toggleCapability(capability: CrmCapability) {
    setCrm(current => ({ ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter(item => item !== capability) : [...current.capabilities, capability] }));
  }
  function registerConnection() {
    if (!organisationId) return;
    const allowedReadCapabilities = crm.capabilities.filter(capability => capability.endsWith(".read"));
    const allowedWriteCapabilities = crm.capabilities.filter(capability => !capability.endsWith(".read"));
    addConnection.mutate({ organisationId, provider: crm.provider, displayName: crm.displayName.trim() || providerLabels[crm.provider], baseUrl: crm.baseUrl.trim() || null, connectionMethod: crm.connectionMethod, allowedReadCapabilities, allowedWriteCapabilities });
  }

  return <DashboardLayout><div className="mx-auto max-w-5xl space-y-6 text-[#EEF5FF]"><Card><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">Organisation intelligence</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] text-white sm:text-5xl">Set up your <span className="text-[#83AEFF]">Sales Assistant.</span></h1><p className="mt-4 max-w-3xl text-sm leading-6 text-[#B7CAE7]">Build a trusted organisation context, connect the CRM your team already uses, and verify every external capability before it becomes available.</p></Card><nav className="grid gap-2 rounded-[1.5rem] border border-white/10 bg-[#0C1E3E] p-3 sm:grid-cols-6">{steps.map((label, index) => <button key={label} onClick={() => setStep(index + 1)} className={`rounded-xl px-3 py-3 text-left text-xs font-bold ${step === index + 1 ? "bg-[#153B7A] text-white" : "text-[#A9BFDF] hover:bg-white/[.05]"}`}><span className="mr-2 text-[#83AEFF]">{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>

    {step === 1 && <Card><StepHeading icon={Building2} number="01" title="Tell us about your organisation" text="This private profile supplies the approved operating context for the selected workspace."/><div className="mt-6 grid gap-4 sm:grid-cols-2"><Input value={profile.companyName} onChange={event => setProfile({ ...profile, companyName: event.target.value })} placeholder="Your organisation" className="border-white/15 bg-[#08172F] text-white"/><Input value={profile.websiteUrl} onChange={event => setProfile({ ...profile, websiteUrl: event.target.value })} placeholder="https://example.com" className="border-white/15 bg-[#08172F] text-white"/><Input value={profile.industry} onChange={event => setProfile({ ...profile, industry: event.target.value })} placeholder="Industry" className="border-white/15 bg-[#08172F] text-white"/><Input value={profile.primaryMarket} onChange={event => setProfile({ ...profile, primaryMarket: event.target.value })} placeholder="Primary market" className="border-white/15 bg-[#08172F] text-white"/></div><Textarea value={profile.brandVoice} onChange={event => setProfile({ ...profile, brandVoice: event.target.value })} placeholder="Approved voice, policies, and sales guidance…" className="mt-4 min-h-28 border-white/15 bg-[#08172F] text-white"/><Button disabled={!profile.companyName || saveProfile.isPending} onClick={() => saveProfile.mutate(profile)} className="mt-5 bg-[#1B64F2]">Save and continue</Button></Card>}
    {step === 2 && <Card><StepHeading icon={Globe2} number="02" title="Preview website context" text="A safe preview blocks private and non-HTML destinations. Unconfirmed content is not retained."/><Button disabled={!profileSaved || discover.isPending} onClick={() => discover.mutate()} className="mt-6 bg-[#1B64F2]">Start secure preview</Button></Card>}
    {step === 3 && <Card><StepHeading icon={BadgeCheck} number="03" title="Confirm usable knowledge" text="Only selected public website facts become approved workspace knowledge."/>{preview ? <><div className="mt-6 space-y-3">{preview.proposedKnowledge.map((item, index) => <label key={`${item.title}-${index}`} className="flex gap-3 rounded-xl border border-white/10 bg-[#08172F] p-4"><input type="checkbox" checked={selectedKnowledge.includes(index)} onChange={() => setSelectedKnowledge(selectedKnowledge.includes(index) ? selectedKnowledge.filter(value => value !== index) : [...selectedKnowledge, index])}/><span><b>{item.title}</b><span className="mt-1 block text-sm text-[#A9BFDF]">{item.content}</span></span></label>)}</div><Button disabled={confirm.isPending} onClick={() => confirm.mutate({ knowledgeIndexes: selectedKnowledge })} className="mt-5 bg-[#1B64F2]">Confirm selected knowledge</Button></> : <p className="mt-5 text-sm text-[#A9BFDF]">Start a fresh website preview first.</p>}</Card>}
    {step === 4 && <Card><StepHeading icon={Network} number="04" title="Connect and verify your sales systems" text="Choose a native OAuth CRM or use Other CRM for an authorised browser-based CRM. The selected capabilities use the exact server verification contract."/><div className="mt-6 grid gap-4 sm:grid-cols-2"><select value={crm.provider} onChange={event => selectProvider(event.target.value as Provider)} className="h-11 rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"><option value="hubspot">HubSpot</option><option value="salesforce">Salesforce</option><option value="pipedrive">Pipedrive</option><option value="zoho">Zoho CRM</option><option value="genie">Genie</option><option value="custom_browser">Other CRM (browser)</option></select><Input value={crm.displayName} onChange={event => setCrm({ ...crm, displayName: event.target.value })} placeholder="Connection display name" className="border-white/15 bg-[#08172F] text-white"/>{isBrowser(crm.provider) && <Input value={crm.baseUrl} onChange={event => setCrm({ ...crm, baseUrl: event.target.value })} placeholder="https://crm.company.example" className="border-white/15 bg-[#08172F] text-white sm:col-span-2"/>}</div><div className="mt-4 flex flex-wrap gap-2">{capabilityOptions.map(option => <button type="button" key={option.value} onClick={() => toggleCapability(option.value)} className={`rounded-full border px-3 py-1.5 text-xs ${crm.capabilities.includes(option.value) ? "border-[#4E8BFF] bg-[#153B7A] text-white" : "border-white/10 text-[#A9BFDF]"}`}>{option.label}</button>)}</div><Button disabled={!organisationId || !crm.displayName.trim() || !crm.capabilities.length || (isBrowser(crm.provider) && !crm.baseUrl.trim()) || addConnection.isPending || beginOAuth.isPending} onClick={registerConnection} className="mt-5 bg-[#1B64F2]"><Plus className="mr-2 size-4"/>Register and authenticate CRM</Button><div className="mt-6 rounded-xl border border-white/10 bg-[#08172F] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-bold text-white">Microsoft 365 / Outlook</p><p className="mt-1 text-xs leading-5 text-[#A9BFDF]">Optional reviewed sales email and calendar actions use the approved Microsoft Graph tenant configured for this deployment.</p></div><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${outlook.data?.ready ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-[#A9BFDF]"}`}>{outlook.data?.ready ? "Configured" : "Not configured"}</span></div></div></Card>}
    {step === 5 && <Card><StepHeading icon={ShieldCheck} number="05" title="Create a review-first playbook" text="Playbooks prepare controlled work. They never authorise external actions."/><Input value={playbook.title} onChange={event => setPlaybook({ ...playbook, title: event.target.value })} placeholder="Playbook title" className="mt-6 border-white/15 bg-[#08172F] text-white"/><Input value={playbook.trigger} onChange={event => setPlaybook({ ...playbook, trigger: event.target.value })} placeholder="Trigger" className="mt-4 border-white/15 bg-[#08172F] text-white"/><Textarea value={playbook.description} onChange={event => setPlaybook({ ...playbook, description: event.target.value })} placeholder="What should the assistant prepare?" className="mt-4 min-h-28 border-white/15 bg-[#08172F] text-white"/><Button disabled={!playbook.title || !playbook.trigger || !playbook.description || savePlaybook.isPending} onClick={() => savePlaybook.mutate({ ...playbook, requiredCapabilities: ["tasks"], status: "draft" })} className="mt-5 bg-[#1B64F2]">Save playbook</Button></Card>}
    {step === 6 && <Card><StepHeading icon={Rocket} number="06" title="Review go-live readiness" text="This review reports stored server evidence. A CRM is ready only after its authenticated backend capability test passes."/><div className="mt-6 grid gap-3 sm:grid-cols-3">{[["Profile", profileSaved], ["Knowledge", knowledgeConfirmed], ["Verified CRM", readySystems.length > 0]].map(([label, ready]) => <div key={String(label)} className="rounded-xl border border-white/10 bg-[#08172F] p-4"><p className="font-bold text-white">{label}</p><p className={`mt-2 text-sm ${ready ? "text-emerald-200" : "text-amber-200"}`}>{ready ? "Recorded" : "Still required"}</p></div>)}</div><p className="mt-5 text-sm leading-6 text-[#A9BFDF]">Before handover, finish authentication under Connections, run the production verifier, and complete one authorised read plus one safe reviewed write against the client's CRM.</p></Card>}
  </div></DashboardLayout>;
}
