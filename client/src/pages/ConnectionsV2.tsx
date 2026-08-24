import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import WorkflowFeedback, { type WorkflowFeedbackState } from "@/components/WorkflowFeedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { humanizeCrmFailure } from "@/lib/onboardingReadiness";
import {
  Cable,
  CheckCircle2,
  CircleAlert,
  GraduationCap,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Provider =
  | "genie"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "zoho"
  | "custom_browser";
type Method = "oauth" | "browser";
type BrowserDraft = {
  username: string;
  password: string;
  profile: string;
  advanced: boolean;
};
type LoginCalibrationDraft = {
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  readySelector: string;
};
type BrowserSystem = {
  id: number;
  provider: string;
  configuration: Record<string, unknown>;
};

const readCapabilities = [
  "contacts.read",
  "companies.read",
  "opportunities.read",
  "tasks.read",
  "activities.read",
  "notes.read",
  "owners.read",
  "pipelines.read",
];
const apiWrites = [
  "contacts.write",
  "companies.write",
  "opportunities.write",
  "tasks.write",
  "activities.write",
  "notes.write",
];
const browserWrites = [
  ...apiWrites,
  "email.send",
  "sms.send",
  "whatsapp.send",
  "sequences.apply",
];
const providerNames: Record<Provider, string> = {
  genie: "Genie",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  pipedrive: "Pipedrive",
  zoho: "Zoho CRM",
  custom_browser: "Other CRM",
};

function defaultMethod(provider: Provider): Method {
  return provider === "genie" || provider === "custom_browser"
    ? "browser"
    : "oauth";
}
function isBrowser(provider: string) {
  return provider === "genie" || provider === "custom_browser";
}
function statusClass(status: string) {
  return status === "ready" || status === "LIVE_PROVEN"
    ? "bg-emerald-400/15 text-emerald-200"
    : status === "limited_permissions" ||
        status === "TEST_READY" ||
        status === "LEARNED"
      ? "bg-amber-400/15 text-amber-100"
      : /attention|expired|error|DEGRADED|BLOCKED/.test(status)
        ? "bg-rose-400/15 text-rose-100"
        : "bg-white/8 text-[#A9BFDF]";
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

export default function ConnectionsV2() {
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId) }
  );
  const outlook = trpc.outlook.readiness.useQuery(undefined, { retry: false });
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider>("genie");
  const [displayName, setDisplayName] = useState("Genie");
  const [baseUrl, setBaseUrl] = useState("");
  const [drafts, setDrafts] = useState<Record<number, BrowserDraft>>({});
  const [savingBrowser, setSavingBrowser] = useState<number | null>(null);
  const [calibrationRequiredFor, setCalibrationRequiredFor] = useState<number | null>(null);
  const [sidecarToken, setSidecarToken] = useState("");
  const [feedback, setFeedback] = useState<WorkflowFeedbackState | null>(null);
  const canManage = organisation.data?.role === "owner" || organisation.data?.role === "manager";
  const method = useMemo(() => defaultMethod(provider), [provider]);

  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation({
    onError: error => toast.error(error.message),
  });
  const create = trpc.connectedSystems.create.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Saving CRM connection", detail: "Amarktai is creating the organisation-scoped connection and authorised destination." }),
    onSuccess: async id => {
      if (organisationId && isBrowser(provider) && baseUrl.trim())
        await addDomain.mutateAsync({
          organisationId,
          connectedSystemId: id,
          hostname: new URL(baseUrl).hostname,
          allowedPaths: ["/"],
        });
      await systems.refetch();
      setAdding(false);
      if (method === "oauth" && organisationId) {
        toast.success(
          "System saved. Continue with secure provider authentication."
        );
        const result = await beginOAuth.mutateAsync({
          organisationId,
          connectedSystemId: id,
        });
        window.location.assign(result.authorizationUrl);
      } else
        toast.success(
          "CRM details saved. Add the secure sign-in, then check CRM setup."
        );
      setFeedback({ kind: "success", title: "CRM connection saved", detail: method === "oauth" ? "Continue through the provider's secure sign-in screen." : "Add the encrypted sign-in, then run discovery and the authorised readiness test." });
    },
    onError: error => setFeedback({ kind: "error", title: "CRM connection was not saved", detail: `No CRM capability was enabled. ${error.message}`, actionLabel: "Retry connection", onAction: addSystem }),
  });
  const verify = trpc.connectedSystems.verify.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Testing CRM readiness", detail: "Amarktai is testing authentication and only the functions this CRM has proven." }),
    onSuccess: async (result, variables) => {
      setCalibrationRequiredFor(
        result.summary.includes("GENIE_LOGIN_CALIBRATION_REQUIRED")
          ? variables.connectedSystemId
          : null
      );
      await systems.refetch();
      const connected = result.status === "ready" || result.status === "limited_permissions";
      const detail = connected
        ? "CRM sign-in is verified. Ready functions can be used; optional functions that need setup remain unavailable."
        : humanizeCrmFailure(result.summary);
      connected ? toast.success(detail) : toast.warning(detail);
      setFeedback(connected ? { kind: "success", title: "CRM setup checked", detail } : { kind: "error", title: "Fix connection", detail });
    },
    onError: error => {
      console.error("[crm-connections] readiness check failed", error);
      setFeedback({ kind: "error", title: "CRM setup check failed", detail: humanizeCrmFailure(error.message) });
    },
  });
  const sync = trpc.connectedSystems.sync.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Synchronising CRM records", detail: "Customer, company, task, opportunity, and activity data are being refreshed." }),
    onSuccess: async result => {
      await systems.refetch();
      toast.success(
        `Sync complete: ${Object.values(result).reduce((total, value) => total + value, 0)} records processed.`
      );
      setFeedback({ kind: "success", title: "CRM synchronisation finished", detail: `${Object.values(result).reduce((total, value) => total + value, 0)} records were processed.` });
    },
    onError: error => setFeedback({ kind: "error", title: "CRM synchronisation failed", detail: `Existing synchronized records remain available; no failure was shown as an empty CRM. ${error.message}` }),
  });
  const issueSidecar = trpc.sidecar.issueSession.useMutation({
    onSuccess: result => {
      setSidecarToken(result.token);
      toast.success("Sidecar session issued for this browser.");
    },
    onError: error => toast.error(error.message),
  });
  const revokeSidecar = trpc.sidecar.revokeSessions.useMutation({
    onSuccess: () => {
      setSidecarToken("");
      toast.success("Sidecar sessions revoked.");
    },
    onError: error => toast.error(error.message),
  });

  function addSystem() {
    if (organisationId)
      create.mutate({
        organisationId,
        provider,
        displayName: displayName.trim() || providerNames[provider],
        baseUrl: baseUrl.trim() || null,
        connectionMethod: method,
        allowedReadCapabilities: readCapabilities,
        allowedWriteCapabilities: isBrowser(provider)
          ? browserWrites
          : apiWrites,
      });
  }
  function draftFor(id: number): BrowserDraft {
    return (
      drafts[id] || { username: "", password: "", profile: "", advanced: false }
    );
  }
  function changeDraft(id: number, patch: Partial<BrowserDraft>) {
    setDrafts(current => ({ ...current, [id]: { ...draftFor(id), ...patch } }));
  }
  async function saveBrowser(systemId: number) {
    try {
      const draft = draftFor(systemId);
      const browserProfile = draft.profile.trim()
        ? JSON.parse(draft.profile)
        : undefined;
      setSavingBrowser(systemId);
      await jsonRequest(`/api/connected-system-admin/${systemId}/browser`, {
        method: "PUT",
        body: JSON.stringify({
          username: draft.username,
          password: draft.password,
          browserProfile,
        }),
      });
      changeDraft(systemId, { password: "" });
      await systems.refetch();
      toast.success(
        "Encrypted CRM sign-in saved. Credentials are never returned to the browser or GenX."
      );
      setFeedback({ kind: "success", title: "Encrypted sign-in saved", detail: "The password was not returned to the browser or sent to Amarktai intelligence." });
    } catch (error) {
      setFeedback({ kind: "error", title: "CRM sign-in was not saved", detail: `The connection remains unavailable. ${error instanceof Error ? error.message : "Browser connector could not be saved."}`, actionLabel: "Retry save", onAction: () => void saveBrowser(systemId) });
    } finally {
      setSavingBrowser(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-7 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
              CONNECTED SYSTEMS
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-[-.065em] text-white sm:text-5xl">
              Connect the CRM your team already works in.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#A9BFDF]">
              Connect once, let Amarktai discover the CRM's contacts, tasks,
              pipeline and communication tools, then use only the tasks that pass
              an authorised readiness test. Sales email, SMS and WhatsApp stay
              inside the connected CRM.
            </p>
          </div>
          {canManage && <Button
            onClick={() => setAdding(value => !value)}
            className="bg-[#1B64F2] hover:bg-[#2B76FF]"
          >
            <Plus className="mr-2 size-4" />
            {adding ? "Close" : "Add CRM"}
          </Button>}
        </header>
        <ManagementElevation />
        <WorkflowFeedback state={systems.isError ? { kind: "error", title: "CRM connections could not load", detail: `${systems.error.message} No API failure has been treated as an empty connection list.`, actionLabel: "Retry connections", onAction: () => systems.refetch() } : feedback} />
        {adding && (
          <section className="rounded-[1.5rem] border border-[#3D69AD]/45 bg-[#0E2142] p-6">
            <div className="mb-5 flex flex-wrap gap-2">
              {[
                "1 Connect",
                "2 Discover",
                "3 Test",
                "4 Ready",
              ].map(step => (
                <span
                  key={step}
                  className="rounded-full bg-[#153B7A] px-3 py-1 text-[10px] font-black uppercase text-[#BBD2FA]"
                >
                  {step}
                </span>
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-4">
              <Field label="CRM">
                <select
                  value={provider}
                  onChange={event => {
                    const next = event.target.value as Provider;
                    setProvider(next);
                    setDisplayName(providerNames[next]);
                    setBaseUrl("");
                  }}
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#08172F] px-3 text-sm text-white"
                >
                  <option value="hubspot">HubSpot</option>
                  <option value="salesforce">Salesforce</option>
                  <option value="pipedrive">Pipedrive</option>
                  <option value="zoho">Zoho CRM</option>
                  <option value="genie">Genie</option>
                  <option value="custom_browser">Other CRM (browser)</option>
                </select>
              </Field>
              <Field label="Connection name">
                <Input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  className="border-white/15 bg-[#08172F] text-white"
                />
              </Field>
              <Field
                label={
                  isBrowser(provider) ? "CRM login URL" : "Optional CRM URL"
                }
              >
                <Input
                  value={baseUrl}
                  onChange={event => setBaseUrl(event.target.value)}
                  placeholder="https://crm.company.example"
                  className="border-white/15 bg-[#08172F] text-white"
                />
              </Field>
              <div className="flex items-end">
                <Button
                  onClick={addSystem}
                  disabled={
                    create.isPending ||
                    beginOAuth.isPending ||
                    !displayName.trim() ||
                    (isBrowser(provider) && !baseUrl.trim())
                  }
                  className="h-11 w-full bg-[#1B64F2] hover:bg-[#2B76FF]"
                >
                  {create.isPending || beginOAuth.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Save CRM details"
                  )}
                </Button>
              </div>
            </div>
            <p className="mt-4 text-xs text-[#9DB3D5]">
              Browser destinations are locked to this organisation’s approved
              hostname/path; private-network and cross-domain navigation is
              rejected.
            </p>
          </section>
        )}
        <section className="grid gap-4 2xl:grid-cols-2">
          {systems.data?.map(system => (
            <article
              key={system.id}
              className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
                    <Cable size={19} />
                  </span>
                  <div>
                    <h2 className="font-display text-2xl font-bold text-white">
                      {system.displayName}
                    </h2>
                    <p className="mt-1 text-xs text-[#91A9CF]">
                      Connected CRM{system.baseUrl ? ` · ${system.baseUrl}` : ""}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(system.status)}`}
                >
                  {connectionStatusLabel(system.status)}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-y border-white/10 py-4">
                <Metric
                  label="Ready functions"
                  value={system.verifiedCapabilities.length || "None"}
                />
                <Metric
                  label="Connection"
                  value={connectionStatusLabel(system.status)}
                />
                <Metric
                  label="Additional setup"
                  value={system.status === "limited_permissions" ? "Optional" : "None"}
                />
              </div>
              {system.lastHealthSummary && (
                <p className="mt-4 rounded-xl bg-black/15 p-3 text-xs leading-5 text-[#B5C8E7]">
                  {system.status === "ready" || system.status === "limited_permissions"
                    ? "CRM sign-in and the listed ready functions were verified. Optional functions remain unavailable until separately tested."
                    : humanizeCrmFailure(system.lastHealthSummary)}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {system.connectionMethod === "oauth" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      organisationId &&
                      beginOAuth
                        .mutateAsync({
                          organisationId,
                          connectedSystemId: system.id,
                        })
                        .then(result =>
                          window.location.assign(result.authorizationUrl)
                        )
                    }
                    className="bg-[#1B64F2] hover:bg-[#2B76FF]"
                  >
                    <Link2 className="mr-2 size-4" />
                    Connect / reconnect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    organisationId &&
                    verify.mutate({
                      organisationId,
                      connectedSystemId: system.id,
                    })
                  }
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                >
                  <ShieldCheck className="mr-2 size-4" />
                  Check CRM setup
                </Button>
                {(system.status === "ready" ||
                  system.status === "limited_permissions") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      organisationId &&
                      sync.mutate({
                        organisationId,
                        connectedSystemId: system.id,
                      })
                    }
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                  >
                    <RefreshCw className="mr-2 size-4" />
                    Sync now
                  </Button>
                )}
              </div>
              {isBrowser(system.provider) && (canManage ? (
                <details className="mt-5 rounded-xl border border-white/10 bg-[#08172F] p-4">
                  <summary className="cursor-pointer text-sm font-bold text-[#A9C7FF]">Advanced CRM Setup</summary>
                  <LoginCalibration
                    organisationId={organisationId}
                    systemId={system.id}
                    required={calibrationRequiredFor === system.id}
                    onSaved={() => {
                      setCalibrationRequiredFor(null);
                      verify.mutate({
                        organisationId: organisationId ?? 0,
                        connectedSystemId: system.id,
                      });
                    }}
                  />
                  <div className="mt-5 rounded-xl border border-[#3D69AD]/30 bg-[#071326] p-4">
                    <div className="flex items-center gap-2 text-[#A9C7FF]">
                      <KeyRound size={16} />
                      <p className="text-xs font-black uppercase tracking-[.12em]">
                        Step 2 · Secure sign-in
                      </p>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#91A9CF]">
                      Saved per connection using encrypted server-side secrets.
                      Passwords are never logged, returned, or included in
                      training capture.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <Input
                        value={draftFor(system.id).username}
                        onChange={e =>
                          changeDraft(system.id, { username: e.target.value })
                        }
                        placeholder="CRM username / email"
                        autoComplete="off"
                        className="border-white/15 bg-[#071326] text-white"
                      />
                      <Input
                        type="password"
                        value={draftFor(system.id).password}
                        onChange={e =>
                          changeDraft(system.id, { password: e.target.value })
                        }
                        placeholder="CRM password"
                        autoComplete="new-password"
                        className="border-white/15 bg-[#071326] text-white"
                      />
                    </div>
                    <button
                      onClick={() =>
                        changeDraft(system.id, {
                          advanced: !draftFor(system.id).advanced,
                        })
                      }
                      className="mt-3 text-xs font-bold text-[#8CB7FF]"
                    >
                      {draftFor(system.id).advanced ? "Hide" : "Show"} advanced
                      reviewed JSON
                    </button>
                    {draftFor(system.id).advanced && (
                      <textarea
                        value={draftFor(system.id).profile}
                        onChange={e =>
                          changeDraft(system.id, { profile: e.target.value })
                        }
                        rows={5}
                        placeholder="Expert/debug only: reviewed login, scripts, operationMap and resultKeys."
                        className="mt-3 w-full rounded-xl border border-white/15 bg-[#071326] p-3 font-mono text-xs text-white outline-none"
                      />
                    )}
                    <Button
                      onClick={() => saveBrowser(system.id)}
                      disabled={savingBrowser === system.id}
                      className="mt-3 bg-[#1B64F2] hover:bg-[#2B76FF]"
                    >
                      <Save className="mr-2 size-4" />
                      {savingBrowser === system.id
                        ? "Saving…"
                        : "Save encrypted sign-in"}
                    </Button>
                  </div>
                  <BrowserOperationMatrix
                    organisationId={organisationId}
                    system={{
                      id: system.id,
                      provider: system.provider,
                      configuration: system.configuration as Record<
                        string,
                        unknown
                      >,
                    }}
                  />
                </details>
              ) : (
                <p className="mt-5 rounded-xl border border-white/10 bg-[#08172F] p-4 text-sm leading-6 text-[#A9BFDF]">
                  A workspace manager handles advanced setup. You can use each CRM function after its authorised readiness test passes.
                </p>
              ))}
            </article>
          ))}
          {!systems.data?.length && (
            <div className="col-span-full rounded-[1.5rem] border border-dashed border-white/15 p-10 text-center text-[#9DB3D5]">
              No CRM connected yet.
            </div>
          )}
        </section>
        <section className="grid gap-4 xl:grid-cols-3">
          <Info
            icon={<CheckCircle2 />}
            title="One CRM connection, the whole team"
            copy="Amarktai synchronizes into the existing normalized CRM model and uses each connected system's independently verified functions."
          />
          <Info
            icon={<CircleAlert />}
            title="Functions fail closed independently"
            copy="If the CRM screen changes, only the affected task pauses. Reconnect or show that task again; other ready tasks keep working."
          />
          <Info
            title="System email and optional Microsoft 365"
            copy="SMTP protects Amarktai login/recovery/reporting. Client-facing CRM communication stays inside the connected CRM. Microsoft 365 is optional for explicitly commissioned Graph workflows."
            badge={outlook.data?.ready ? "Configured" : "Optional"}
          />
        </section>
        {canManage && <details className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
          <summary className="cursor-pointer font-bold text-[#A9C7FF]">Advanced browser sidecar commissioning</summary>
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#7FAAF8]">
            BROWSER SIDECAR
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-white">
            Attach Amarktai beside an authorised CRM tab.
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#A9BFDF]">
            Manager training uses this short-lived, revocable,
            organisation-scoped session. Paste the Connected System and Training
            Session IDs into the Sidecar when demonstrating an operation.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!organisationId || issueSidecar.isPending}
              onClick={() =>
                organisationId && issueSidecar.mutate({ organisationId })
              }
              className="bg-[#1B64F2] hover:bg-[#2B76FF]"
            >
              Issue sidecar session
            </Button>
            <Button
              variant="outline"
              disabled={!organisationId || revokeSidecar.isPending}
              onClick={() =>
                organisationId && revokeSidecar.mutate({ organisationId })
              }
              className="border-white/15 bg-white/5 text-white hover:bg-white/10"
            >
              Revoke sessions
            </Button>
          </div>
          {sidecarToken && (
            <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-400/[.07] p-4">
              <p className="text-xs font-bold text-amber-100">
                Copy this once. It expires and is not stored as plaintext.
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  readOnly
                  value={sidecarToken}
                  className="border-white/15 bg-[#08172F] font-mono text-xs text-white"
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(sidecarToken)
                      .then(() => toast.success("Sidecar session copied."))
                  }
                  className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                >
                  Copy
                </Button>
              </div>
            </div>
          )}
        </details>}
      </div>
    </DashboardLayout>
  );
}
function connectionStatusLabel(status: string) {
  if (status === "ready") return "Ready";
  if (status === "limited_permissions") return "Ready · optional setup remains";
  if (status === "connecting" || status === "testing") return "Checking";
  if (/attention|expired/.test(status)) return "Needs setup";
  if (/error|disconnected/.test(status)) return "Failed";
  return "Unavailable";
}

export function LoginCalibration({
  organisationId,
  systemId,
  required = false,
  onSaved,
}: {
  organisationId?: number;
  systemId: number;
  required?: boolean;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authHostname, setAuthHostname] = useState("");
  const [draft, setDraft] = useState<LoginCalibrationDraft>({
    usernameSelector: 'input[name="username"]',
    passwordSelector: 'input[type="password"]',
    submitSelector: 'button[type="submit"]',
    readySelector: '[data-testid="dashboard"]',
  });
  const addDomain = trpc.connectedSystems.addDomain.useMutation({
    onSuccess: () => {
      setAuthHostname("");
      toast.success("The exact authentication hostname is approved for this Genie connection.");
    },
    onError: error => toast.error(error.message),
  });
  async function save() {
    try {
      setSaving(true);
      await jsonRequest(`/api/connected-system-admin/${systemId}/browser`, {
        method: "PUT",
        body: JSON.stringify({ loginCalibration: draft }),
      });
      toast.success("Guided sign-in selectors saved without credentials.");
      setOpen(false);
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-in calibration was not saved.");
    } finally {
      setSaving(false);
    }
  }
  const fields: Array<[keyof LoginCalibrationDraft, string]> = [
    ["usernameSelector", "Username / email field"],
    ["passwordSelector", "Password field"],
    ["submitSelector", "Sign-in submit button"],
    ["readySelector", "Authenticated / ready marker"],
  ];
  return (
    <section className="mt-5 rounded-xl border border-[#3D69AD]/30 bg-[#071326] p-4">
      <p className="text-sm font-bold text-white">
        {required
          ? "Genie was reached, but Amarktai needs help identifying the sign-in form."
          : "Automatic Genie sign-in discovery is the normal path."}
      </p>
      <p className="mt-2 text-xs leading-5 text-[#91A9CF]">
        Automatic discovery is used first. Only an elevated manager should calibrate
        selectors when requested; credentials remain in encrypted connection secrets.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(value => !value)}
        className="mt-3 border-white/15 bg-white/5 text-white"
      >
        {open ? "Close calibration" : "Calibrate sign-in"}
      </Button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key} className="grid gap-1 text-xs font-bold text-[#AFC3E2]">
                {label}
                <Input
                  value={draft[key]}
                  onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}
                  className="border-white/15 bg-[#08172F] font-mono text-xs text-white"
                />
              </label>
            ))}
          </div>
          <Button disabled={saving} onClick={() => void save()} className="bg-[#1B64F2]">
            {saving ? "Saving…" : "Save selector calibration"}
          </Button>
          <div className="border-t border-white/10 pt-4">
            <p className="text-xs font-bold text-[#AFC3E2]">Approve an exact authentication redirect hostname</p>
            <p className="mt-1 text-xs leading-5 text-[#91A9CF]">
              Enter only the hostname reported by the blocked sign-in test. Private-network destinations remain prohibited.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Input
                value={authHostname}
                onChange={event => setAuthHostname(event.target.value)}
                placeholder="auth.example.com"
                className="border-white/15 bg-[#08172F] text-white"
              />
              <Button
                variant="outline"
                disabled={!organisationId || !authHostname.trim() || addDomain.isPending}
                onClick={() => organisationId && addDomain.mutate({
                  organisationId,
                  connectedSystemId: systemId,
                  hostname: authHostname.trim(),
                  allowedPaths: ["/"],
                })}
                className="border-white/15 bg-white/5 text-white"
              >
                Approve exact hostname
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function customOperationKey(name: string, mode: "read" | "write") {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 90);
  if (slug.length < 2)
    throw new Error("Give the CRM function a clear name before starting training.");
  return `custom.${mode}.${slug}`;
}

export function BrowserOperationMatrix({
  organisationId,
  system,
  experience = "management",
}: {
  organisationId?: number;
  system: BrowserSystem;
  experience?: "guided" | "management";
}) {
  const matrix = trpc.connectedSystems.browserOperationMatrix.useQuery(
    { organisationId: organisationId ?? 0, connectedSystemId: system.id },
    { enabled: Boolean(organisationId) }
  );
  const [shadowOverride, setShadowOverride] = useState<boolean | undefined>();
  const [customFunctionName, setCustomFunctionName] = useState("");
  const [customFunctionMode, setCustomFunctionMode] = useState<"read" | "write">(
    "write"
  );
  const startTraining = trpc.connectedSystems.startBrowserTraining.useMutation({
    onSuccess: result => {
      navigator.clipboard.writeText(String(result.id)).catch(() => undefined);
      toast.success(
        `Training Session ${result.id} created and copied. Open the Sidecar on the authorised CRM tab.`
      );
    },
    onError: error => toast.error(error.message),
  });
  const setShadow = trpc.connectedSystems.setBrowserShadowMode.useMutation({
    onSuccess: async result => {
      setShadowOverride(result.enabled);
      await matrix.refetch();
      toast.success(
        result.enabled
          ? "Shadow mode enabled: writes will be prepared but not executed."
          : "Shadow mode disabled."
      );
    },
    onError: error => toast.error(error.message),
  });
  const shadowMode = shadowOverride ?? system.configuration.shadowMode === true;

  function startCustomFunctionTraining() {
    if (!organisationId) return;
    try {
      const operationKey = customOperationKey(
        customFunctionName,
        customFunctionMode
      );
      startTraining.mutate({
        organisationId,
        connectedSystemId: system.id,
        operationKey,
      });
      setCustomFunctionName("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "CRM function name is invalid."
      );
    }
  }

  async function testOperation(operationKey: string, mode: string) {
    if (
      !window.confirm(
        `${mode === "write" ? "Use an authorised dummy/test CRM record. " : ""}Run deterministic controlled replay for ${operationKey}?`
      )
    )
      return;
    try {
      let suggestedInputs = "{}";
      if (experience === "management") {
        const savedTarget = sessionStorage.getItem(
          `amarktai-safe-test-${system.id}`
        );
        if (savedTarget) {
          try {
            suggestedInputs = JSON.stringify(
              { safeTestCustomer: JSON.parse(savedTarget) },
              null,
              2
            );
          } catch {
            sessionStorage.removeItem(`amarktai-safe-test-${system.id}`);
          }
        }
      }
      const raw = experience === "guided" ? "{}" :
        window.prompt("Optional test inputs as JSON. Do not paste secrets.", suggestedInputs) || "{}";
      const inputs = JSON.parse(raw);
      await jsonRequest(
        `/api/connected-system-admin/${system.id}/operations/${encodeURIComponent(operationKey)}/test`,
        {
          method: "POST",
          body: JSON.stringify({
            inputs,
            confirmControlledReplay: true,
            publish: true,
          }),
        }
      );
      await matrix.refetch();
      toast.success(
        `${operationKey} is LIVE_PROVEN with stored replay evidence.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Controlled replay failed."
      );
    }
  }
  return (
    <div className="mt-5 rounded-xl border border-[#3D69AD]/30 bg-[#08172F] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#A9C7FF]">
            <GraduationCap size={16} />
            <p className="text-xs font-black uppercase tracking-[.12em]">
              {experience === "guided" ? "CRM task readiness" : "Teach Amarktai · Acceptance matrix"}
            </p>
          </div>
          <p className="mt-2 text-xs text-[#91A9CF]">
            {experience === "guided"
              ? "Show Amarktai each CRM task once, then run a safe authorised test. A task is only ready after the CRM confirms the expected result."
              : `System ID ${system.id}. Learned is not live; only controlled replay plus readback can publish LIVE_PROVEN.`}
          </p>
        </div>
        {experience === "management" && <label className="flex items-center gap-2 text-xs font-bold text-[#C8D8F2]">
          <input
            type="checkbox"
            checked={shadowMode}
            onChange={event =>
              organisationId &&
              setShadow.mutate({
                organisationId,
                connectedSystemId: system.id,
                enabled: event.target.checked,
              })
            }
          />
          Shadow mode
        </label>}
      </div>

      {experience === "management" && <div className="mt-4 rounded-xl border border-[#3D69AD]/30 bg-[#0B1B36] p-4">
        <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#8CB7FF]">
          Teach another CRM function
        </p>
        <p className="mt-2 text-xs leading-5 text-[#91A9CF]">
          Use this for any function the CRM already has that is not listed below:
          send a quote, book an appointment, start a dialler action, assign an
          owner, run a workflow, or another client-specific function. Reads can
          inspect data. Writes must prove the exact target and success state
          before they can become LIVE_PROVEN.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_150px_auto]">
          <Input
            value={customFunctionName}
            onChange={event => setCustomFunctionName(event.target.value)}
            placeholder="Function name, e.g. Send quote"
            className="border-white/15 bg-[#071326] text-white"
          />
          <select
            value={customFunctionMode}
            onChange={event =>
              setCustomFunctionMode(event.target.value as "read" | "write")
            }
            className="h-10 rounded-lg border border-white/15 bg-[#071326] px-3 text-xs font-bold text-white"
          >
            <option value="write">Changes CRM (write)</option>
            <option value="read">Reads only</option>
          </select>
          <Button
            onClick={startCustomFunctionTraining}
            disabled={startTraining.isPending || !customFunctionName.trim()}
            className="bg-[#1B64F2] hover:bg-[#2B76FF]"
          >
            Teach this function
          </Button>
        </div>
      </div>}

      <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
        {matrix.data?.operations.map(operation => (
          <BrowserOperationRow
            key={operation.key}
            organisationId={organisationId}
            connectedSystemId={system.id}
            operation={operation}
            guided={experience === "guided"}
            onTeach={() =>
              organisationId &&
              startTraining.mutate({
                organisationId,
                connectedSystemId: system.id,
                operationKey: operation.key,
              })
            }
            onTest={() => testOperation(operation.key, operation.mode)}
            onChanged={() => matrix.refetch()}
          />
        )) ?? (
          <p className="text-xs text-[#91A9CF]">Loading operation truth…</p>
        )}
      </div>
      {matrix.data && experience === "management" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {matrix.data.capabilities.map(capability => (
            <span
              key={capability.capability}
              className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${capability.state === "FULL" ? "bg-emerald-400/15 text-emerald-200" : capability.state === "LIMITED" ? "bg-amber-400/15 text-amber-100" : "bg-white/8 text-[#A9BFDF]"}`}
            >
              {capability.capability}: {capability.state}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type MatrixOperation = {
  key: string;
  label: string;
  area: string;
  mode: "read" | "write";
  status: string;
  lastError: string | null;
};
type ReviewStep = {
  action:
    | "goto"
    | "fill"
    | "click"
    | "press"
    | "select_option"
    | "check"
    | "uncheck"
    | "expect_visible"
    | "wait_for_url";
  selector?: string;
  value?: string;
};

function BrowserOperationRow({
  organisationId,
  connectedSystemId,
  operation,
  guided,
  onTeach,
  onTest,
  onChanged,
}: {
  organisationId?: number;
  connectedSystemId: number;
  operation: MatrixOperation;
  guided: boolean;
  onTeach: () => void;
  onTest: () => void;
  onChanged: () => Promise<unknown> | void;
}) {
  const review = trpc.connectedSystems.browserOperationReview.useQuery(
    {
      organisationId: organisationId ?? 0,
      connectedSystemId,
      operationKey: operation.key,
    },
    {
      enabled: Boolean(organisationId) && operation.status === "LEARNED",
      retry: false,
    }
  );
  const [steps, setSteps] = useState<ReviewStep[]>([]);
  const [output, setOutput] = useState({
    action: "read_text" as "read_text" | "read_value" | "read_rows",
    selector: "",
    key: "result",
  });
  const [outputFields, setOutputFields] = useState([
    { key: "externalId", selector: "", attribute: "" },
  ]);
  const [target, setTarget] = useState({
    rowSelector: "",
    fields: [
      { key: "externalId", selector: "" },
      { key: "email", selector: "" },
    ],
  });
  const [postcondition, setPostcondition] = useState({
    action: "read_text" as "read_text" | "read_value",
    selector: "",
    key: "verifiedResult",
    expectedInput: "",
    expectedValue: "",
    comparator: "contains" as "equals" | "contains" | "exists" | "not_equals",
  });
  useEffect(() => {
    if (review.data?.proposedSteps)
      setSteps(review.data.proposedSteps as ReviewStep[]);
  }, [review.data?.id]);
  const saveReview = trpc.connectedSystems.reviewBrowserOperation.useMutation({
    onSuccess: async () => {
      await onChanged();
      toast.success(
        `${operation.label} saved as TEST_READY for controlled replay.`
      );
    },
    onError: error => toast.error(error.message),
  });
  function patchStep(index: number, patch: Partial<ReviewStep>) {
    setSteps(current =>
      current.map((step, position) =>
        position === index ? { ...step, ...patch } : step
      )
    );
  }
  function saveGuidedReview() {
    if (!organisationId || !review.data) return;
    const isWrite = operation.mode === "write";
    const fields = target.fields
      .filter(field => field.selector.trim())
      .map(field => ({
        key: field.key as
          | "externalId"
          | "taskId"
          | "opportunityId"
          | "name"
          | "email"
          | "phone"
          | "company",
        selector: field.selector.trim(),
      }));
    saveReview.mutate({
      organisationId,
      connectedSystemId,
      learnedOperationId: review.data.id,
      operationKey: operation.key,
      review: {
        steps,
        output: !isWrite
          ? {
              ...output,
              fields:
                output.action === "read_rows"
                  ? outputFields.filter(field => field.key.trim())
                  : undefined,
            }
          : undefined,
        target: isWrite
          ? { rowSelector: target.rowSelector, fields }
          : undefined,
        postcondition: isWrite ? postcondition : undefined,
      },
    });
  }
  return (
    <div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">{operation.label}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-[#7896C1]">
            {guided ? operation.area : `${operation.area} · ${operation.key} · ${operation.mode}`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${statusClass(operation.status)}`}
        >
          {guided
            ? operation.status === "LIVE_PROVEN"
              ? "Ready"
              : operation.status === "TEST_READY"
                ? "Ready to test"
                : operation.status === "LEARNED"
                  ? "Shown"
                  : operation.status === "DEGRADED" || operation.status === "BLOCKED"
                    ? "Needs attention"
                    : "Not shown yet"
            : operation.status.replaceAll("_", " ")}
        </span>
      </div>
      {operation.lastError && (
        <p className="mt-2 text-xs text-rose-200">{operation.lastError}</p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onTeach}
          className="h-8 border-white/15 bg-white/5 text-xs text-white hover:bg-white/10"
        >
          {operation.status === "NOT_LEARNED" ? (guided ? "Show Amarktai" : "Teach") : (guided ? "Show again / fix" : "Relearn / fix")}
        </Button>
        {operation.status === "TEST_READY" && (
          <Button
            size="sm"
            onClick={onTest}
            className="h-8 bg-[#1B64F2] text-xs hover:bg-[#2B76FF]"
          >
            {guided ? "Run safe test" : "Controlled test"}
          </Button>
        )}
      </div>
      {guided && operation.status === "LEARNED" && (
        <p className="mt-3 rounded-lg bg-amber-400/[.06] p-3 text-xs leading-5 text-amber-100">
          The demonstration is captured. A workspace manager must review the safe target and confirmation rules before testing.
        </p>
      )}
      {!guided && operation.status === "LEARNED" && review.data && (
        <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/[.04] p-4">
          <p className="text-xs font-black uppercase tracking-[.12em] text-amber-100">
            Manager review · sanitized capture
          </p>
          <div className="mt-3 space-y-2">
            {review.data.capture.map((event, index) => (
              <div
                key={index}
                className="rounded-lg bg-[#071326] p-3 text-xs text-[#C8D8F2]"
              >
                <b>
                  {index + 1}. {String(event.action).replaceAll("_", " ")}
                </b>
                <span className="ml-2 text-[#8FA9CE]">
                  {event.name ||
                    event.label ||
                    event.url ||
                    "Sensitive field masked"}
                </span>
                {event.selector && (
                  <code className="mt-1 block break-all text-[#8CB7FF]">
                    {event.selector}
                  </code>
                )}
                {event.value && (
                  <code className="mt-1 block text-emerald-200">
                    {event.value}
                  </code>
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-[.12em] text-[#8FA9CE]">
            Deterministic replay steps
          </p>
          <div className="mt-2 space-y-2">
            {steps.map((step, index) => (
              <div
                key={index}
                className="grid gap-2 md:grid-cols-[130px_1fr_1fr]"
              >
                <select
                  value={step.action}
                  onChange={event =>
                    patchStep(index, {
                      action: event.target.value as ReviewStep["action"],
                    })
                  }
                  className="h-9 rounded-lg border border-white/15 bg-[#071326] px-2 text-xs text-white"
                >
                  <option value="goto">Navigate</option>
                  <option value="click">Click</option>
                  <option value="fill">Fill placeholder</option>
                  <option value="select_option">Select placeholder</option>
                  <option value="check">Check</option>
                  <option value="uncheck">Uncheck</option>
                  <option value="press">Press key</option>
                  <option value="expect_visible">Expect visible</option>
                </select>
                <Input
                  value={step.selector || ""}
                  disabled={
                    step.action === "goto" || step.action === "wait_for_url"
                  }
                  onChange={event =>
                    patchStep(index, { selector: event.target.value })
                  }
                  placeholder="Stable selector"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
                <Input
                  value={step.value || ""}
                  onChange={event =>
                    patchStep(index, { value: event.target.value })
                  }
                  placeholder="Navigation or {{placeholder}}"
                  className="h-9 border-white/15 bg-[#071326] font-mono text-xs text-white"
                />
              </div>
            ))}
          </div>
          {operation.mode === "read" ? (
            <div className="mt-4">
              <div className="grid gap-2 md:grid-cols-3">
                <select
                  value={output.action}
                  onChange={event =>
                    setOutput({
                      ...output,
                      action: event.target.value as typeof output.action,
                    })
                  }
                  className="h-9 rounded-lg border border-white/15 bg-[#071326] px-2 text-xs text-white"
                >
                  <option value="read_text">Read text</option>
                  <option value="read_value">Read value</option>
                  <option value="read_rows">Read structured rows</option>
                </select>
                <Input
                  value={output.selector}
                  onChange={event =>
                    setOutput({ ...output, selector: event.target.value })
                  }
                  placeholder="Result selector"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
                <Input
                  value={output.key}
                  onChange={event =>
                    setOutput({ ...output, key: event.target.value })
                  }
                  placeholder="Result key"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
              </div>
              {output.action === "read_rows" && (
                <div className="mt-2 space-y-2">
                  <p className="text-[10px] font-black uppercase text-[#8FA9CE]">
                    Structured row fields
                  </p>
                  {outputFields.map((field, index) => (
                    <div key={index} className="grid gap-2 md:grid-cols-3">
                      <Input
                        value={field.key}
                        onChange={event =>
                          setOutputFields(current =>
                            current.map((item, position) =>
                              position === index
                                ? { ...item, key: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Field key, e.g. externalId"
                        className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                      />
                      <Input
                        value={field.selector}
                        onChange={event =>
                          setOutputFields(current =>
                            current.map((item, position) =>
                              position === index
                                ? { ...item, selector: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Field selector relative to row"
                        className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                      />
                      <Input
                        value={field.attribute}
                        onChange={event =>
                          setOutputFields(current =>
                            current.map((item, position) =>
                              position === index
                                ? { ...item, attribute: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Optional attribute"
                        className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setOutputFields(current => [
                        ...current,
                        { key: "", selector: "", attribute: "" },
                      ])
                    }
                    className="border-white/15 bg-white/5 text-white"
                  >
                    Add extraction field
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#8FA9CE]">
                Target verification
              </p>
              <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
                <Input
                  value={target.rowSelector}
                  onChange={event =>
                    setTarget({ ...target, rowSelector: event.target.value })
                  }
                  placeholder="Matching result row"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
                <div className="space-y-2">
                  {target.fields.map((field, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[150px_1fr] gap-2"
                    >
                      <select
                        value={field.key}
                        onChange={event =>
                          setTarget({
                            ...target,
                            fields: target.fields.map((item, position) =>
                              position === index
                                ? { ...item, key: event.target.value }
                                : item
                            ),
                          })
                        }
                        className="h-9 rounded-lg border border-white/15 bg-[#071326] px-2 text-xs text-white"
                      >
                        <option value="externalId">CRM record ID</option>
                        <option value="taskId">Task ID</option>
                        <option value="opportunityId">Opportunity ID</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                        <option value="name">Name</option>
                        <option value="company">Company</option>
                      </select>
                      <Input
                        value={field.selector}
                        onChange={event =>
                          setTarget({
                            ...target,
                            fields: target.fields.map((item, position) =>
                              position === index
                                ? { ...item, selector: event.target.value }
                                : item
                            ),
                          })
                        }
                        placeholder="Stable field selector"
                        className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setTarget({
                        ...target,
                        fields: [
                          ...target.fields,
                          { key: "email", selector: "" },
                        ],
                      })
                    }
                    className="border-white/15 bg-white/5 text-white"
                  >
                    Add identity field
                  </Button>
                </div>
              </div>
              <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#8FA9CE]">
                Success verification
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                <Input
                  value={postcondition.selector}
                  onChange={event =>
                    setPostcondition({
                      ...postcondition,
                      selector: event.target.value,
                    })
                  }
                  placeholder="Result selector"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
                <Input
                  value={postcondition.expectedInput}
                  onChange={event =>
                    setPostcondition({
                      ...postcondition,
                      expectedInput: event.target.value,
                    })
                  }
                  placeholder="Expected placeholder, e.g. noteBody"
                  className="h-9 border-white/15 bg-[#071326] text-xs text-white"
                />
                <select
                  value={postcondition.comparator}
                  onChange={event =>
                    setPostcondition({
                      ...postcondition,
                      comparator: event.target
                        .value as typeof postcondition.comparator,
                    })
                  }
                  className="h-9 rounded-lg border border-white/15 bg-[#071326] px-2 text-xs text-white"
                >
                  <option value="contains">Contains expected</option>
                  <option value="equals">Equals expected</option>
                  <option value="exists">Exists</option>
                  <option value="not_equals">Changed from expected</option>
                </select>
              </div>
            </div>
          )}
          <Button
            onClick={saveGuidedReview}
            disabled={saveReview.isPending}
            className="mt-4 bg-[#1B64F2] hover:bg-[#2B76FF]"
          >
            Save for testing
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[10px] font-black uppercase tracking-[.13em] text-[#8CA9D4]">
        {label}
      </span>
      {children}
    </label>
  );
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#7896C1]">
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-[#E4ECFA]">{value}</p>
    </div>
  );
}
function Info({
  icon,
  title,
  copy,
  badge,
}: {
  icon?: React.ReactNode;
  title: string;
  copy: string;
  badge?: string;
}) {
  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
      {icon && <span className="text-[#8CB7FF]">{icon}</span>}
      <h2 className="mt-3 font-display text-2xl font-bold text-white">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#A9BFDF]">{copy}</p>
      {badge && (
        <span className="mt-4 inline-flex rounded-full bg-white/8 px-3 py-1 text-[10px] font-black uppercase text-[#A9BFDF]">
          {badge}
        </span>
      )}
    </article>
  );
}
