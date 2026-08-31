import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type Provider =
  | "genie"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "zoho"
  | "custom_browser";

const providers: Array<{
  provider: Provider;
  label: string;
  url: string;
  transport: "browser" | "oauth";
}> = [
  {
    provider: "genie",
    label: "Genie",
    url: "https://genie.entrepreneurscircle.org/",
    transport: "browser",
  },
  {
    provider: "hubspot",
    label: "HubSpot",
    url: "https://app.hubspot.com/",
    transport: "oauth",
  },
  {
    provider: "salesforce",
    label: "Salesforce",
    url: "https://login.salesforce.com/",
    transport: "oauth",
  },
  {
    provider: "pipedrive",
    label: "Pipedrive",
    url: "https://app.pipedrive.com/",
    transport: "oauth",
  },
  {
    provider: "zoho",
    label: "Zoho CRM",
    url: "https://crm.zoho.com/",
    transport: "oauth",
  },
  {
    provider: "custom_browser",
    label: "Other CRM",
    url: "",
    transport: "browser",
  },
];

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
const writeCapabilities = [
  "contacts.write",
  "companies.write",
  "opportunities.write",
  "tasks.write",
  "activities.write",
  "notes.write",
  "email.send",
  "sms.send",
  "whatsapp.send",
  "sequences.apply",
];

function publicError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/url|format|https/i.test(detail))
    return "Enter the full CRM address, including https://";
  if (/authentication|sign.?in|session/i.test(detail))
    return "Your CRM needs you to sign in again.";
  return "The CRM connection could not be opened. Check the address and try again.";
}

export default function ConnectionsV2() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId || 0 },
    { enabled: Boolean(organisationId) }
  );
  const create = trpc.connectedSystems.create.useMutation();
  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<(typeof providers)[number]>(
    providers[0]
  );
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState("");
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";
  const startUrl =
    selected.provider === "custom_browser" ? customUrl.trim() : selected.url;
  const connected = useMemo(() => systems.data || [], [systems.data]);

  async function connect() {
    if (!organisationId) return;
    setError("");
    try {
      const parsed = new URL(startUrl);
      if (parsed.protocol !== "https:") throw new Error("https required");
      const id = await create.mutateAsync({
        organisationId,
        provider: selected.provider,
        displayName: selected.label,
        baseUrl: startUrl,
        connectionMethod: selected.transport,
        allowedReadCapabilities: readCapabilities,
        allowedWriteCapabilities: writeCapabilities,
      });
      await addDomain.mutateAsync({
        organisationId,
        connectedSystemId: id,
        hostname: parsed.hostname,
        allowedPaths: ["/"],
      });
      await systems.refetch();
      setAdding(false);
      if (selected.transport === "oauth") {
        const result = await beginOAuth.mutateAsync({
          organisationId,
          connectedSystemId: id,
        });
        window.location.assign(result.authorizationUrl);
      } else {
        toast.success(
          "CRM connection created. Sign in directly on the CRM website."
        );
        navigate(`/crm/${id}`);
      }
    } catch (cause) {
      setError(publicError(cause));
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-blue-300">
              CRM
            </p>
            <h1 className="mt-2 text-3xl font-bold text-white">
              Connect the CRM your team already uses.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Open the real CRM inside Amarktai. You enter credentials, MFA,
              SSO, or CAPTCHA directly on its website—Amarktai never asks for or
              stores them.
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setAdding(value => !value)}>
              <Plus className="mr-2 h-4 w-4" />
              {adding ? "Close" : "Connect CRM"}
            </Button>
          ) : null}
        </header>

        {adding ? (
          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5">
            <h2 className="text-lg font-bold text-white">Choose your CRM</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map(item => (
                <button
                  key={item.provider}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setError("");
                  }}
                  className={`rounded-xl border p-4 text-left transition ${selected.provider === item.provider ? "border-blue-400 bg-blue-500/15" : "border-slate-700 bg-slate-950/40 hover:border-slate-500"}`}
                >
                  <span className="font-semibold text-white">{item.label}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {item.transport === "oauth"
                      ? "Reliable API connection + CRM workspace"
                      : "Secure browser connection"}
                  </span>
                </button>
              ))}
            </div>
            {selected.provider === "custom_browser" ? (
              <label className="mt-4 block max-w-xl text-sm font-medium text-slate-200">
                CRM sign-in address
                <input
                  value={customUrl}
                  onChange={event => setCustomUrl(event.target.value)}
                  placeholder="https://crm.example.com/"
                  className="mt-2 h-11 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 text-white"
                />
              </label>
            ) : (
              <p className="mt-4 text-sm text-slate-300">
                Authorised address:{" "}
                <span className="font-mono text-xs text-slate-400">
                  {selected.url}
                </span>
              </p>
            )}
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-red-400/40 bg-red-950/40 px-3 py-2 text-sm text-red-100"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="mt-4"
              onClick={() => void connect()}
              disabled={!startUrl || create.isPending || addDomain.isPending}
            >
              {create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              {selected.transport === "browser"
                ? `Open ${selected.label === "Other CRM" ? "CRM" : selected.label}`
                : `Connect ${selected.label}`}
            </Button>
          </section>
        ) : null}

        <section className="grid gap-4">
          {systems.isLoading ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-8 text-slate-300">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading CRM connections…
            </div>
          ) : null}
          {connected.map(system => (
            <article
              key={system.id}
              className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 text-white"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`h-5 w-5 ${system.status === "ready" ? "text-emerald-400" : "text-amber-300"}`}
                    />
                    <h2 className="text-lg font-bold">{system.displayName}</h2>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">
                    {system.status === "ready"
                      ? "Connected · Secure session ready"
                      : system.status === "authentication_expired"
                        ? "Sign in again"
                        : "Connection saved · Open CRM to continue"}
                  </p>
                  {system.lastHealthSummary ? (
                    <p className="mt-2 max-w-2xl text-sm text-slate-300">
                      {system.lastHealthSummary}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/crm/${system.id}`)}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Open CRM
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void systems.refetch()}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ...system.allowedReadCapabilities,
                  ...system.allowedWriteCapabilities,
                ].map(capability => {
                  const ready =
                    system.verifiedCapabilities.includes(capability);
                  return (
                    <span
                      key={capability}
                      className={`rounded-full px-2.5 py-1 text-xs ${ready ? "bg-emerald-500/15 text-emerald-200" : "bg-slate-800 text-slate-400"}`}
                    >
                      {capability} ·{" "}
                      {ready
                        ? "Ready"
                        : system.status === "testing"
                          ? "Testing"
                          : "Unavailable"}
                    </span>
                  );
                })}
              </div>
            </article>
          ))}
          {!systems.isLoading && connected.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-600 p-10 text-center text-slate-300">
              No CRM is connected yet.
            </div>
          ) : null}
        </section>
      </div>
    </DashboardLayout>
  );
}
