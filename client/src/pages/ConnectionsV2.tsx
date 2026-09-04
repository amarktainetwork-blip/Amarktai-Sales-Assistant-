import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  DatabaseZap,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
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

function statusPresentation(status: string) {
  if (status === "ready")
    return {
      tone: "ready" as const,
      title: "Connected",
      detail: "The connection is available and can feed the AmarktAI workspace.",
    };
  if (status === "testing" || status === "connecting")
    return {
      tone: "working" as const,
      title: "Commissioning",
      detail: "AmarktAI is safely checking which CRM data and operations are available.",
    };
  if (status === "authentication_expired")
    return {
      tone: "attention" as const,
      title: "Sign in again",
      detail: "The saved CRM session expired. Reopen the source CRM and sign in directly.",
    };
  if (status === "limited_permissions")
    return {
      tone: "attention" as const,
      title: "Connected with limits",
      detail: "The CRM is connected, but some operations still need permission or commissioning.",
    };
  if (status === "needs_attention" || status === "error")
    return {
      tone: "attention" as const,
      title: "Needs attention",
      detail: "Open the source CRM to finish the connection or resolve the sign-in issue.",
    };
  return {
    tone: "working" as const,
    title: "Ready to sign in",
    detail: "Open the source CRM and sign in with your own account to continue.",
  };
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export default function ConnectionsV2() {
  const [, navigate] = useLocation();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId || 0 },
    { enabled: Boolean(organisationId), refetchInterval: 5_000 }
  );
  const readiness = trpc.integrations.list.useQuery(undefined, {
    enabled: Boolean(organisationId),
    retry: false,
  });
  const create = trpc.connectedSystems.create.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<(typeof providers)[number]>(
    providers[0]
  );
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<number | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<number | null>(
    null
  );
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";
  const startUrl =
    selected.provider === "custom_browser" ? customUrl.trim() : selected.url;
  const connected = useMemo(() => systems.data || [], [systems.data]);
  const workspaceReady = Boolean(readiness.data?.genie.ready);

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
      await systems.refetch();
      setAdding(false);
      if (selected.transport === "oauth") {
        const result = await beginOAuth.mutateAsync({
          organisationId,
          connectedSystemId: id,
        });
        window.location.assign(result.authorizationUrl);
      } else {
        toast.success("CRM added. Sign in inside the secure source workspace to continue commissioning.");
        navigate(`/crm/${id}`);
      }
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "The CRM connection could not be changed safely. Try again."
        )
      );
    }
  }

  async function disconnect(connectedSystemId: number) {
    if (!canManage) return;
    if (confirmDisconnectId !== connectedSystemId) {
      setConfirmDisconnectId(connectedSystemId);
      return;
    }
    setDisconnectingId(connectedSystemId);
    setError("");
    try {
      const response = await fetch(
        `/api/connected-system-admin/${connectedSystemId}/disconnect`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }
      );
      if (!response.ok) throw new Error(await responseError(response));
      setConfirmDisconnectId(null);
      toast.success(
        "CRM disconnected. Sign-in data was removed while retained CRM history and audit evidence were preserved."
      );
      await systems.refetch();
    } catch (cause) {
      const message = friendlyError(
        cause,
        "The CRM connection could not be changed safely. Try again."
      );
      setError(message);
      toast.error(message);
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1320px] space-y-5 text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="handover-kicker">CRM setup</p>
              <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
                Connect the CRM once. Work from AmarktAI every day.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#66758A] sm:text-base">
                The CRM stays the system of record. AmarktAI brings customer, opportunity, task, activity and sales context into a cleaner workspace so salespeople can focus on calls, follow-up and decisions instead of CRM navigation.
              </p>
            </div>
            {canManage ? (
              <Button onClick={() => setAdding(value => !value)}>
                {adding ? (
                  <X className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {adding ? "Close" : "Connect CRM"}
              </Button>
            ) : null}
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          <JourneyStep
            number="1"
            title="Connect"
            detail="Manager connects the company CRM and each salesperson signs in with their own account where required."
          />
          <JourneyStep
            number="2"
            title="Prove"
            detail="AmarktAI commissions the required read and write operations before the workspace can become Ready."
          />
          <JourneyStep
            number="3"
            title="Work here"
            detail="Customers, calls, tasks, opportunities, notes and approved actions move into the AmarktAI workflow."
          />
        </section>

        <section className={`rounded-2xl border p-4 ${workspaceReady ? "border-emerald-200 bg-emerald-50" : "border-[#D8E2F0] bg-[#F6F9FD]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${workspaceReady ? "bg-emerald-100 text-emerald-700" : "bg-[#EAF1FF] text-[#2F6FED]"}`}>
                {workspaceReady ? <CheckCircle2 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
              </span>
              <div>
                <p className="font-bold text-[#26354A]">
                  {workspaceReady ? "Core CRM workspace ready" : "CRM commissioning still in progress"}
                </p>
                <p className="mt-1 text-sm leading-5 text-[#66758A]">
                  {workspaceReady
                    ? "The required CRM operations are proven for the AmarktAI workspace."
                    : "A connection alone is not enough. Required operations must be proven before setup is considered complete."}
                </p>
              </div>
            </div>
            {!workspaceReady && connected.length ? (
              <span className="text-xs font-bold text-[#55708F]">
                Use Teach AmarktAI below if a required function needs help.
              </span>
            ) : null}
          </div>
        </section>

        {adding ? (
          <section className="handover-surface p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#EDF3FF] text-[#2F6FED]">
                <DatabaseZap className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-2xl font-bold tracking-[-.035em]">
                  Choose the company CRM
                </h2>
                <p className="mt-1 text-sm text-[#718096]">
                  Provider names appear only here because this is the technical connection step.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map(item => (
                <button
                  key={item.provider}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setError("");
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected.provider === item.provider
                      ? "border-[#2F6FED] bg-[#F1F6FF] shadow-sm"
                      : "border-[#DCE4EE] bg-white hover:border-[#AFC3E8] hover:bg-[#FAFCFF]"
                  }`}
                >
                  <span className="font-bold text-[#26354A]">{item.label}</span>
                  <span className="mt-1 block text-xs text-[#718096]">
                    {item.transport === "oauth"
                      ? "Secure account connection"
                      : "Private browser connection"}
                  </span>
                </button>
              ))}
            </div>

            {selected.provider === "custom_browser" ? (
              <label className="mt-5 block max-w-xl text-sm font-bold text-[#33445B]">
                CRM sign-in address
                <input
                  value={customUrl}
                  onChange={event => {
                    setCustomUrl(event.target.value);
                    setError("");
                  }}
                  placeholder="https://crm.example.com/"
                  className="mt-2 h-11 w-full rounded-xl border border-[#C9D4E2] bg-white px-3 text-[#26354A] outline-none focus:border-[#2F6FED] focus:ring-2 focus:ring-[#DCE7F6]"
                />
              </label>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="mt-4 flex max-w-2xl items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}

            <Button
              className="mt-5"
              onClick={() => void connect()}
              disabled={!startUrl || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              {selected.transport === "browser"
                ? "Open secure sign-in"
                : "Connect account"}
            </Button>
          </section>
        ) : null}

        {!adding && error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <section className="grid gap-4">
          {systems.isLoading ? (
            <div className="handover-surface p-8 text-[#66758A]">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading CRM connections…
            </div>
          ) : null}

          {connected.map(system => {
            const presentation = statusPresentation(system.status);
            const confirming = confirmDisconnectId === system.id;

            return (
              <article key={system.id} className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {presentation.tone === "ready" ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : presentation.tone === "attention" ? (
                        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                      ) : (
                        <Loader2 className="h-5 w-5 shrink-0 text-[#2F6FED]" />
                      )}
                      <h2 className="truncate text-lg font-bold text-[#26354A]">
                        {system.displayName}
                      </h2>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.06em] ${
                          presentation.tone === "ready"
                            ? "bg-emerald-50 text-emerald-700"
                            : presentation.tone === "attention"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {presentation.title}
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66758A]">
                      {presentation.detail}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => navigate(`/crm/${system.id}`)}
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {system.status === "authentication_expired"
                        ? "Sign in again"
                        : "Open source CRM"}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Refresh connection status"
                      onClick={() => void systems.refetch()}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {canManage ? (
                  <div className="mt-4 border-t border-[#E5EAF0] pt-4">
                    {confirming ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
                        <div>
                          <p className="text-sm font-bold text-red-800">
                            Disconnect this CRM?
                          </p>
                          <p className="mt-1 text-xs leading-5 text-red-700">
                            Saved authentication is removed. Retained CRM history and audit evidence remain available.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDisconnectId(null)}
                            disabled={disconnectingId === system.id}
                          >
                            Keep connected
                          </Button>
                          <Button
                            size="sm"
                            className="bg-red-600 text-white hover:bg-red-700"
                            onClick={() => void disconnect(system.id)}
                            disabled={disconnectingId === system.id}
                          >
                            {disconnectingId === system.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Disconnect
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#8793A4] transition hover:text-red-700"
                        onClick={() => setConfirmDisconnectId(system.id)}
                      >
                        Disconnect CRM
                      </button>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}

          {!systems.isLoading && connected.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#C9D4E2] bg-white p-12 text-center shadow-sm">
              <DatabaseZap className="mx-auto h-9 w-9 text-[#2F6FED]" />
              <h2 className="mt-4 font-display text-2xl font-bold tracking-[-.035em]">
                No CRM connected yet
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[#718096]">
                Connect the company CRM once. After commissioning, customer and sales activity will flow into AmarktAI automatically.
              </p>
              {canManage ? (
                <Button className="mt-5" onClick={() => setAdding(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Connect CRM
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </DashboardLayout>
  );
}

function JourneyStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="handover-surface flex items-start gap-4 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EDF3FF] text-sm font-black text-[#2F6FED]">
        {number}
      </span>
      <div>
        <p className="font-bold text-[#26354A]">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[#718096]">{detail}</p>
      </div>
      <ArrowRight className="ml-auto mt-2 hidden h-4 w-4 text-[#B1BDCC] md:block" />
    </div>
  );
}
