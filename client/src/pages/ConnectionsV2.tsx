import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
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
  const [provider, setProvider] = useState<Provider>("hubspot");
  const [displayName, setDisplayName] = useState("HubSpot");
  const [baseUrl, setBaseUrl] = useState("");
  const [drafts, setDrafts] = useState<Record<number, BrowserDraft>>({});
  const [savingBrowser, setSavingBrowser] = useState<number | null>(null);
  const [sidecarToken, setSidecarToken] = useState("");
  const method = useMemo(() => defaultMethod(provider), [provider]);

  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation({
    onError: error => toast.error(error.message),
  });
  const create = trpc.connectedSystems.create.useMutation({
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
          "CRM details saved. Add secure sign-in, then Teach Amarktai and prove each operation."
        );
    },
    onError: error => toast.error(error.message),
  });
  const verify = trpc.connectedSystems.verify.useMutation({
    onSuccess: async result => {
      await systems.refetch();
      result.status === "ready"
        ? toast.success(
            "All requested capability operation sets are LIVE_PROVEN."
          )
        : toast.warning(result.summary);
    },
    onError: error => toast.error(error.message),
  });
  const sync = trpc.connectedSystems.sync.useMutation({
    onSuccess: async result => {
      await systems.refetch();
      toast.success(
        `Sync complete: ${Object.values(result).reduce((total, value) => total + value, 0)} records processed.`
      );
    },
    onError: error => toast.error(error.message),
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
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Browser connector could not be saved."
      );
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
              Native CRMs use OAuth. Genie and other authorised web CRMs use
              reviewed deterministic operations. Connected means authenticated;
              only independently tested operations become LIVE_PROVEN.
            </p>
          </div>
          <Button
            onClick={() => setAdding(value => !value)}
            className="bg-[#1B64F2] hover:bg-[#2B76FF]"
          >
            <Plus className="mr-2 size-4" />
            {adding ? "Close" : "Add CRM"}
          </Button>
        </header>
        {adding && (
          <section className="rounded-[1.5rem] border border-[#3D69AD]/45 bg-[#0E2142] p-6">
            <div className="mb-5 flex flex-wrap gap-2">
              {[
                "1 CRM details",
                "2 Secure sign-in",
                "3 Connect",
                "4 Discover",
                "5 Map",
                "6 Teach Amarktai",
                "7 Test",
                "8 Readiness",
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
                      {system.provider.replaceAll("_", " ")} ·{" "}
                      {system.connectionMethod.replaceAll("_", " ")}
                      {system.baseUrl ? ` · ${system.baseUrl}` : ""}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass(system.status)}`}
                >
                  {system.status.replaceAll("_", " ")}
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-y border-white/10 py-4">
                <Metric
                  label="Full capabilities"
                  value={system.verifiedCapabilities.length || "None"}
                />
                <Metric
                  label="Read requested"
                  value={system.allowedReadCapabilities.length}
                />
                <Metric
                  label="Write requested"
                  value={system.allowedWriteCapabilities.length}
                />
              </div>
              {system.lastHealthSummary && (
                <p className="mt-4 rounded-xl bg-black/15 p-3 text-xs leading-5 text-[#B5C8E7]">
                  {system.lastHealthSummary}
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
                  Refresh capability truth
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
              {isBrowser(system.provider) && (
                <>
                  <div className="mt-5 rounded-xl border border-[#3D69AD]/30 bg-[#08172F] p-4">
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
                </>
              )}
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
            copy="Amarktai synchronizes into the existing normalized CRM model and calculates personal/team work from verified owner mappings."
          />
          <Info
            icon={<CircleAlert />}
            title="Capabilities fail closed"
            copy="A drifted operation is disabled independently. A broad capability becomes full only when every required operation is LIVE_PROVEN."
          />
          <Info
            title="Microsoft 365"
            copy="Reviewed outbound mail/calendar and commissioned inbound Graph notifications use the existing Microsoft 365 boundary."
            badge={outlook.data?.ready ? "Configured" : "Not configured"}
          />
        </section>
        <section className="rounded-[1.5rem] border border-white/10 bg-[#0E2142] p-6">
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
        </section>
      </div>
    </DashboardLayout>
  );
}

export function BrowserOperationMatrix({
  organisationId,
  system,
}: {
  organisationId?: number;
  system: BrowserSystem;
}) {
  const matrix = trpc.connectedSystems.browserOperationMatrix.useQuery(
    { organisationId: organisationId ?? 0, connectedSystemId: system.id },
    { enabled: Boolean(organisationId) }
  );
  const [shadowOverride, setShadowOverride] = useState<boolean | undefined>();
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
  async function testOperation(operationKey: string, mode: string) {
    if (
      !window.confirm(
        `${mode === "write" ? "Use an authorised dummy/test CRM record. " : ""}Run deterministic controlled replay for ${operationKey}?`
      )
    )
      return;
    try {
      const raw =
        window.prompt(
          "Optional test inputs as JSON. Do not paste secrets.",
          "{}"
        ) || "{}";
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
              Teach Amarktai · Acceptance matrix
            </p>
          </div>
          <p className="mt-2 text-xs text-[#91A9CF]">
            System ID {system.id}. Learned is not live; only controlled replay
            plus readback can publish LIVE_PROVEN.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-[#C8D8F2]">
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
        </label>
      </div>
      <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
        {matrix.data?.operations.map(operation => (
          <BrowserOperationRow
            key={operation.key}
            organisationId={organisationId}
            connectedSystemId={system.id}
            operation={operation}
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
      {matrix.data && (
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
  onTeach,
  onTest,
  onChanged,
}: {
  organisationId?: number;
  connectedSystemId: number;
  operation: MatrixOperation;
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
            {operation.area} · {operation.key} · {operation.mode}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${statusClass(operation.status)}`}
        >
          {operation.status.replaceAll("_", " ")}
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
          {operation.status === "NOT_LEARNED" ? "Teach" : "Relearn / fix"}
        </Button>
        {operation.status === "TEST_READY" && (
          <Button
            size="sm"
            onClick={onTest}
            className="h-8 bg-[#1B64F2] text-xs hover:bg-[#2B76FF]"
          >
            Controlled test
          </Button>
        )}
      </div>
      {operation.status === "LEARNED" && review.data && (
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
                  <p className="text-[10px] font-black uppercase text-[#8FA9CE]">Structured row fields</p>
                  {outputFields.map((field, index) => (
                    <div key={index} className="grid gap-2 md:grid-cols-3">
                      <Input value={field.key} onChange={event => setOutputFields(current => current.map((item, position) => position === index ? { ...item, key: event.target.value } : item))} placeholder="Field key, e.g. externalId" className="h-9 border-white/15 bg-[#071326] text-xs text-white" />
                      <Input value={field.selector} onChange={event => setOutputFields(current => current.map((item, position) => position === index ? { ...item, selector: event.target.value } : item))} placeholder="Field selector relative to row" className="h-9 border-white/15 bg-[#071326] text-xs text-white" />
                      <Input value={field.attribute} onChange={event => setOutputFields(current => current.map((item, position) => position === index ? { ...item, attribute: event.target.value } : item))} placeholder="Optional attribute" className="h-9 border-white/15 bg-[#071326] text-xs text-white" />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setOutputFields(current => [...current, { key: "", selector: "", attribute: "" }])} className="border-white/15 bg-white/5 text-white">Add extraction field</Button>
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
                    <div key={index} className="grid grid-cols-[150px_1fr] gap-2">
                      <select value={field.key} onChange={event => setTarget({ ...target, fields: target.fields.map((item, position) => position === index ? { ...item, key: event.target.value } : item) })} className="h-9 rounded-lg border border-white/15 bg-[#071326] px-2 text-xs text-white"><option value="externalId">CRM record ID</option><option value="taskId">Task ID</option><option value="opportunityId">Opportunity ID</option><option value="email">Email</option><option value="phone">Phone</option><option value="name">Name</option><option value="company">Company</option></select>
                      <Input value={field.selector} onChange={event => setTarget({ ...target, fields: target.fields.map((item, position) => position === index ? { ...item, selector: event.target.value } : item) })} placeholder="Stable field selector" className="h-9 border-white/15 bg-[#071326] text-xs text-white" />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => setTarget({ ...target, fields: [...target.fields, { key: "email", selector: "" }] })} className="border-white/15 bg-white/5 text-white">Add identity field</Button>
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
