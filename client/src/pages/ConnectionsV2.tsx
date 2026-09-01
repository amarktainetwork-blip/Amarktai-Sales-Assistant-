import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { friendlyError } from "@/lib/friendlyError";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
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
      detail: "Your CRM is connected and available to Amarktai.",
    };
  if (status === "testing" || status === "connecting")
    return {
      tone: "working" as const,
      title: "Finishing setup",
      detail: "Amarktai is safely checking the CRM data it can use.",
    };
  if (status === "authentication_expired")
    return {
      tone: "attention" as const,
      title: "Sign in again",
      detail:
        "The saved CRM session expired. Reopen the CRM and sign in directly.",
    };
  if (status === "limited_permissions")
    return {
      tone: "attention" as const,
      title: "Connected with limits",
      detail:
        "The CRM is connected, but some actions need additional CRM permission.",
    };
  if (status === "needs_attention" || status === "error")
    return {
      tone: "attention" as const,
      title: "Needs attention",
      detail:
        "Open the CRM to finish the connection or resolve the sign-in issue.",
    };
  return {
    tone: "working" as const,
    title: "Ready to sign in",
    detail: "Open the CRM and sign in with your own account to continue.",
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
    { enabled: Boolean(organisationId) }
  );
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
        toast.success(
          "CRM ready. Sign in directly inside your secure workspace."
        );
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
        "CRM disconnected. Sign-in data was removed and retained CRM history was preserved."
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
      <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-8">
        <header className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm lg:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[.18em] text-[#3F70D8]">
                CRM connections
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[#26354A]">
                Your company CRM, connected safely.
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#66758A]">
                Connect the company CRM once. Each salesperson signs in directly
                inside their own private CRM workspace. Amarktai never asks for
                or records the password or verification code; encrypted browser
                session state is retained so the user can reconnect securely.
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

        {adding ? (
          <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#26354A]">
              Choose your CRM
            </h2>
            <p className="mt-1 text-sm text-[#718096]">
              If this CRM already exists, Amarktai reuses the existing
              connection instead of creating a duplicate.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {providers.map(item => (
                <button
                  key={item.provider}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                    setError("");
                  }}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected.provider === item.provider
                      ? "border-[#3F70D8] bg-[#F3F7FF] shadow-sm"
                      : "border-[#DCE4EE] bg-white hover:border-[#AFC3E8] hover:bg-[#FAFCFF]"
                  }`}
                >
                  <span className="font-semibold text-[#26354A]">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-xs text-[#718096]">
                    {item.transport === "oauth"
                      ? "Secure account connection"
                      : "Private live browser workspace"}
                  </span>
                </button>
              ))}
            </div>

            {selected.provider === "custom_browser" ? (
              <label className="mt-4 block max-w-xl text-sm font-medium text-[#33445B]">
                CRM sign-in address
                <input
                  value={customUrl}
                  onChange={event => {
                    setCustomUrl(event.target.value);
                    setError("");
                  }}
                  placeholder="https://crm.example.com/"
                  className="mt-2 h-11 w-full rounded-lg border border-[#C9D4E2] bg-white px-3 text-[#26354A] outline-none focus:border-[#3F70D8] focus:ring-2 focus:ring-[#DCE7F6]"
                />
              </label>
            ) : (
              <p className="mt-4 text-sm text-[#66758A]">
                Authorised address:{" "}
                <span className="font-mono text-xs text-[#526277]">
                  {selected.url}
                </span>
              </p>
            )}

            {error ? (
              <p
                role="alert"
                className="mt-3 flex max-w-2xl items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}

            <Button
              className="mt-4"
              onClick={() => void connect()}
              disabled={!startUrl || create.isPending}
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
            <div className="rounded-2xl border border-[#DCE4EE] bg-white p-8 text-[#66758A] shadow-sm">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading CRM connections…
            </div>
          ) : null}

          {connected.map(system => {
            const presentation = statusPresentation(system.status);
            const confirming = confirmDisconnectId === system.id;

            return (
              <article
                key={system.id}
                className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {presentation.tone === "ready" ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                      ) : presentation.tone === "attention" ? (
                        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                      ) : (
                        <Loader2 className="h-5 w-5 shrink-0 text-[#3F70D8]" />
                      )}
                      <h2 className="truncate text-lg font-bold text-[#26354A]">
                        {system.displayName}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
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
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66758A]">
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
                        : "Open CRM"}
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
                            Disconnect {system.displayName}?
                          </p>
                          <p className="mt-1 text-xs leading-5 text-red-700">
                            This closes live browser sessions and removes saved
                            authentication. Retained CRM history and audit
                            evidence are preserved.
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
                            Disconnect CRM
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
            <div className="rounded-2xl border border-dashed border-[#C9D4E2] bg-white p-10 text-center shadow-sm">
              <h2 className="text-lg font-bold text-[#26354A]">
                No CRM connected
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#718096]">
                A manager connects the company CRM once. Team members then sign
                in with their own CRM account when they open the workspace.
              </p>
              {canManage ? (
                <Button className="mt-5" onClick={() => setAdding(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Connect CRM
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </DashboardLayout>
  );
}
