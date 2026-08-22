import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Cable, CheckCircle2, CircleAlert, KeyRound, Link2, Loader2, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Provider = "genie" | "hubspot" | "salesforce" | "pipedrive" | "zoho" | "custom_browser";
type Method = "oauth" | "browser";
type BrowserDraft = { username: string; password: string; profile: string };

const readCapabilities = ["contacts.read", "companies.read", "opportunities.read", "tasks.read", "activities.read", "notes.read", "owners.read", "pipelines.read"];
const apiWrites = ["contacts.write", "companies.write", "opportunities.write", "tasks.write", "activities.write", "notes.write"];
const browserWrites = [...apiWrites, "email.send", "sms.send", "whatsapp.send", "sequences.apply"];
const providerNames: Record<Provider, string> = { genie: "Genie", hubspot: "HubSpot", salesforce: "Salesforce", pipedrive: "Pipedrive", zoho: "Zoho CRM", custom_browser: "Other CRM" };

function defaultMethod(provider: Provider): Method { return provider === "genie" || provider === "custom_browser" ? "browser" : "oauth"; }
function isBrowser(provider: string) { return provider === "genie" || provider === "custom_browser"; }
function statusClass(status: string) { return status === "ready" ? "bg-emerald-400/15 text-emerald-200" : status === "limited_permissions" ? "bg-amber-400/15 text-amber-100" : /attention|expired|error/.test(status) ? "bg-rose-400/15 text-rose-100" : "bg-white/8 text-[#A9BFDF]"; }

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

export default function ConnectionsV2() {
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery({ organisationId: organisationId ?? 0 }, { enabled: Boolean(organisationId) });
  const outlook = trpc.outlook.readiness.useQuery(undefined, { retry: false });
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider>("hubspot");
  const [displayName, setDisplayName] = useState("HubSpot");
  const [baseUrl, setBaseUrl] = useState("");
  const [drafts, setDrafts] = useState<Record<number, BrowserDraft>>({});
  const [savingBrowser, setSavingBrowser] = useState<number | null>(null);
  const [sidecarToken, setSidecarToken] = useState("");
  const method = useMemo(() => defaultMethod(provider), [provider]);

  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation({ onError: error => toast.error(error.message) });
  const create = trpc.connectedSystems.create.useMutation({
    onSuccess: async id => {
      if (organisationId && isBrowser(provider) && baseUrl.trim()) await addDomain.mutateAsync({ organisationId, connectedSystemId: id, hostname: new URL(baseUrl).hostname, allowedPaths: ["/"] });
      await systems.refetch();
      setAdding(false);
      if (method === "oauth" && organisationId) {
        toast.success("System saved. Continue with secure provider authentication.");
        const result = await beginOAuth.mutateAsync({ organisationId, connectedSystemId: id });
        window.location.assign(result.authorizationUrl);
      } else toast.success("System saved. Add the encrypted browser setup and run verification.");
    },
    onError: error => toast.error(error.message),
  });
  const verify = trpc.connectedSystems.verify.useMutation({ onSuccess: async result => { await systems.refetch(); result.status === "ready" ? toast.success("Connection verified and ready.") : toast.warning(result.summary); }, onError: error => toast.error(error.message) });
  const sync = trpc.connectedSystems.sync.useMutation({ onSuccess: async result => { await systems.refetch(); toast.success(`Sync complete: ${Object.values(result).reduce((total, value) => total + value, 0)} records processed.`); }, onError: error => toast.error(error.message) });
  const issueSidecar = trpc.sidecar.issueSession.useMutation({ onSuccess: result => { setSidecarToken(result.token); toast.success("Sidecar session issued for this browser."); }, onError: error => toast.error(error.message) });
  const revokeSidecar = trpc.sidecar.revokeSessions.useMutation({ onSuccess: () => { setSidecarToken(""); toast.success("Sidecar sessions revoked."); }, onError: error => toast.error(error.message) });

  function addSystem() {
    if (!organisationId) return;
    create.mutate({ organisationId, provider, displayName: displayName.trim() || providerNames[provider], baseUrl: baseUrl.trim() || null, connectionMethod: method, allowedReadCapabilities: readCapabilities, allowedWriteCapabilities: isBrowser(provider) ? browserWrites : apiWrites });
  }
  function draftFor(id: number): BrowserDraft { return drafts[id] || { username: "", password: "", profile: "" }; }
  function changeDraft(id: number, patch: Partial<BrowserDraft>) { setDrafts(current => ({ ...current, [id]: { ...draftFor(id), ...patch } })); }
  async function saveBrowser(systemId: number) {
    try {
      const draft = draftFor(systemId);
      const browserProfile = draft.profile.trim() ? JSON.parse(draft.profile) : undefined;
      setSavingBrowser(systemId);
      await jsonRequest(`/api/connected-system-admin/${systemId}/browser`, { method: "PUT", body: JSON.stringify({ username: draft.username, password: draft.password, browserProfile }) });
      changeDraft(systemId, { password: "" });
      await systems.refetch();
      toast.success("Browser connector saved securely. Test it before syncing or executing work.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Browser connector could not be saved."); }
    finally { setSavingBrowser(null); }
  }

  return <DashboardLayout><div className="mx-auto max-w-[1500px] space-y-6">
    <header className="flex flex-col gap-5 border-b border-white/10 pb-7 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">CONNECTED SYSTEMS</p><h1 className="mt-2 font-display text-4xl font-bold tracking-[-.065em] text-white sm:text-5xl">Connect the CRM your team already works in.</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">HubSpot, Salesforce, Pipedrive and Zoho use native OAuth. Genie and any other authorised web CRM use the deterministic browser connector. Nothing is marked ready until the backend verifies the exact requested capabilities.</p></div><Button onClick={() => setAdding(value => !value)} className="bg-[#1B64F2] hover:bg-[#2B76FF]"><Plus className="mr-2 size-4"/>{adding ? "Close" : "Add CRM"}</Button></header>

    {adding && <section className="rounded-[1.5rem] border border-[#3D69AD]/45 bg-[#0E2142] p-6"><div className="grid gap-4 xl:grid-cols-4"><Field label="CRM"><select value={provider} onChange={event => { const next = event.target.value as Provider; setProvider(next); setDisplayName(providerNames[next]); setBaseUrl(""); }} className="h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"><option value="hubspot">HubSpot</option><option value="salesforce">Salesforce</option><option value="pipedrive">Pipedrive</option><option value="zoho">Zoho CRM</option><option value="genie">Genie</option><option value="custom_browser">Other CRM (browser)</option></select></Field><Field label="Display name"><Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="border-white/15 bg-[#08172F] text-white"/></Field><Field label={isBrowser(provider) ? "CRM login URL" : "Optional CRM URL"}><Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://crm.company.example" className="border-white/15 bg-[#08172F] text-white"/></Field><div className="flex items-end"><Button onClick={addSystem} disabled={create.isPending || beginOAuth.isPending || !displayName.trim() || (isBrowser(provider) && !baseUrl.trim())} className="h-11 w-full bg-[#1B64F2] hover:bg-[#2B76FF]">{create.isPending || beginOAuth.isPending ? <Loader2 className="size-4 animate-spin"/> : "Connect CRM"}</Button></div></div><p className="mt-4 text-xs text-[#9DB3D5]">Connection method: <strong>{method}</strong>. Browser connectors are locked to the authorised company hostname/path and private network destinations are rejected.</p></section>}

    <section className="grid gap-4 2xl:grid-cols-2">{systems.data?.map(system => <article key={system.id} className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]"><Cable size={19}/></span><div><h2 className="font-display text-2xl font-bold text-white">{system.displayName}</h2><p className="mt-1 text-xs text-[#91A9CF]">{system.provider.replaceAll("_", " ")} · {system.connectionMethod.replaceAll("_", " ")}{system.baseUrl ? ` · ${system.baseUrl}` : ""}</p></div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(system.status)}`}>{system.status.replaceAll("_", " ")}</span></div><div className="mt-5 grid grid-cols-3 gap-3 border-y border-white/10 py-4"><Metric label="Verified" value={system.verifiedCapabilities.length || "Not tested"}/><Metric label="Read" value={system.allowedReadCapabilities.length}/><Metric label="Write" value={system.allowedWriteCapabilities.length}/></div>{system.lastHealthSummary && <p className="mt-4 rounded-xl bg-black/15 p-3 text-xs leading-5 text-[#B5C8E7]">{system.lastHealthSummary}</p>}<div className="mt-5 flex flex-wrap gap-2">{system.connectionMethod === "oauth" && <Button size="sm" onClick={() => organisationId && beginOAuth.mutateAsync({ organisationId, connectedSystemId: system.id }).then(result => window.location.assign(result.authorizationUrl))} className="bg-[#1B64F2] hover:bg-[#2B76FF]"><Link2 className="mr-2 size-4"/>Connect / reconnect</Button>}<Button size="sm" variant="outline" onClick={() => organisationId && verify.mutate({ organisationId, connectedSystemId: system.id })} className="border-white/15 bg-white/5 text-white hover:bg-white/10"><ShieldCheck className="mr-2 size-4"/>Test connection</Button>{(system.status === "ready" || system.status === "limited_permissions") && <Button size="sm" variant="outline" onClick={() => organisationId && sync.mutate({ organisationId, connectedSystemId: system.id })} className="border-white/15 bg-white/5 text-white hover:bg-white/10"><RefreshCw className="mr-2 size-4"/>Sync now</Button>}</div>{isBrowser(system.provider) && <div className="mt-5 rounded-xl border border-[#3D69AD]/30 bg-[#08172F] p-4"><div className="flex items-center gap-2 text-[#A9C7FF]"><KeyRound size={16}/><p className="text-xs font-black uppercase tracking-[.12em]">Secure browser connector</p></div><p className="mt-2 text-xs leading-5 text-[#91A9CF]">Credentials are encrypted server-side and never sent to GenX. Genie can use the calibrated server script; another CRM uses a reviewed organisation-specific profile.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><Input value={draftFor(system.id).username} onChange={e => changeDraft(system.id, { username: e.target.value })} placeholder="CRM username / email" autoComplete="off" className="border-white/15 bg-[#071326] text-white"/><Input type="password" value={draftFor(system.id).password} onChange={e => changeDraft(system.id, { password: e.target.value })} placeholder="CRM password" autoComplete="new-password" className="border-white/15 bg-[#071326] text-white"/></div><textarea value={draftFor(system.id).profile} onChange={e => changeDraft(system.id, { profile: e.target.value })} rows={5} placeholder={system.provider === "genie" ? "Optional organisation-specific profile JSON. Leave blank to use the calibrated Genie server profile." : "Paste reviewed browser profile JSON: login, scripts, operationMap and resultKeys."} className="mt-3 w-full rounded-xl border border-white/15 bg-[#071326] p-3 font-mono text-xs text-white outline-none"/><Button onClick={() => saveBrowser(system.id)} disabled={savingBrowser === system.id} className="mt-3 bg-[#1B64F2] hover:bg-[#2B76FF]"><Save className="mr-2 size-4"/>{savingBrowser === system.id ? "Saving…" : "Save secure browser setup"}</Button></div>}</article>)}{!systems.data?.length && <div className="col-span-full rounded-[1.5rem] border border-dashed border-white/15 p-10 text-center text-[#9DB3D5]">No CRM connected yet. Choose a native OAuth CRM or Other CRM for any authorised web CRM.</div>}</section>

    <section className="grid gap-4 xl:grid-cols-3"><article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><CheckCircle2 className="text-[#8CB7FF]"/><h2 className="mt-3 font-display text-2xl font-bold text-white">One CRM connection, the whole team.</h2><p className="mt-2 text-sm leading-6 text-[#A9BFDF]">Amarktai syncs once, maps CRM owners to salespeople, and calculates personal/team work from shared normalized records.</p></article><article className="rounded-[1.5rem] border border-amber-300/15 bg-amber-400/[.05] p-6"><CircleAlert className="text-amber-100"/><h2 className="mt-3 font-display text-2xl font-bold text-white">Capabilities fail closed.</h2><p className="mt-2 text-sm leading-6 text-[#D8C9A6]">Expired auth or a missing permission/script makes the capability unavailable instead of pretending an action succeeded.</p></article><article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">MICROSOFT 365</p><h2 className="mt-2 font-display text-2xl font-bold text-white">Outlook mail + calendar</h2><p className="mt-2 text-sm leading-6 text-[#A9BFDF]">When the approved Graph tenant is configured, reviewed sales email and calendar actions use Microsoft 365 and remain tied to the action audit trail.</p><span className={`mt-4 inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase ${outlook.data?.ready ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-[#A9BFDF]"}`}>{outlook.data?.ready ? "Configured" : "Not configured"}</span></article></section>

    <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"><p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">BROWSER SIDECAR</p><h2 className="mt-1 font-display text-2xl font-bold text-white">Attach Amarktai beside an authorised CRM tab.</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#A9BFDF]">The optional extension receives a short-lived session and activates only on organisation-authorised domains.</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!organisationId || issueSidecar.isPending} onClick={() => organisationId && issueSidecar.mutate({ organisationId })} className="bg-[#1B64F2] hover:bg-[#2B76FF]">Issue sidecar session</Button><Button variant="outline" disabled={!organisationId || revokeSidecar.isPending} onClick={() => organisationId && revokeSidecar.mutate({ organisationId })} className="border-white/15 bg-white/5 text-white hover:bg-white/10">Revoke sessions</Button></div>{sidecarToken && <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-400/[.07] p-4"><p className="text-xs font-bold text-amber-100">Copy this once into the Sidecar extension. It expires and is not stored as plaintext.</p><div className="mt-3 flex gap-2"><Input readOnly value={sidecarToken} className="border-white/15 bg-[#08172F] font-mono text-xs text-white"/><Button variant="outline" onClick={() => navigator.clipboard.writeText(sidecarToken).then(() => toast.success("Sidecar session copied."))} className="border-white/15 bg-white/5 text-white hover:bg-white/10">Copy</Button></div></div>}</section>
  </div></DashboardLayout>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2"><span className="text-[10px] font-black uppercase tracking-[.13em] text-[#8CA9D4]">{label}</span>{children}</label>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div><p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">{label}</p><p className="mt-1 truncate font-semibold text-[#E4ECFA]">{value}</p></div>; }
