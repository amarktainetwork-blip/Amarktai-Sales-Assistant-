import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  autonomyPermissions,
  reviewEverythingAutonomy,
  type AutonomyPermission,
  type AutonomySettings,
} from "@shared/autonomyPolicy";
import {
  BookOpenCheck,
  Building2,
  Cable,
  ChevronRight,
  Download,
  Mail,
  Loader2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const permissionLabels: Record<AutonomyPermission, string> = {
  email_replies: "Email replies",
  new_emails: "New emails",
  sms: "SMS",
  whatsapp: "WhatsApp",
  crm_notes: "CRM notes",
  tasks_callbacks: "Tasks & callbacks",
  contact_updates: "Customer & contact updates",
  opportunity_updates: "Opportunity & stage updates",
  calendar_invites: "Calendar invites",
  sequences_followups: "Sequences & follow-ups",
};

async function autonomyApi(
  init?: RequestInit
): Promise<{ user: AutonomySettings; effective: AutonomySettings }> {
  const response = await fetch("/api/autonomy", {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = (await response.json().catch(() => ({}))) as {
    user?: AutonomySettings;
    effective?: AutonomySettings;
    error?: string;
  };
  if (!response.ok || !body.user || !body.effective)
    throw new Error(body.error || "Autonomy settings are unavailable.");
  return { user: body.user, effective: body.effective };
}

type MailboxStatus = {
  configured: boolean;
  connected: boolean;
  mailbox: null | {
    email: string;
    displayName: string | null;
    status: string;
    updatedAt: string;
  };
};

async function mailboxApi(init?: RequestInit): Promise<MailboxStatus> {
  const response = await fetch("/api/mailbox", {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = (await response.json().catch(() => ({}))) as MailboxStatus & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error || "Mailbox status is unavailable.");
  return body;
}

function downloadExport(file: {
  base64: string;
  contentType: string;
  filename: string;
}) {
  const bytes = Uint8Array.from(atob(file.base64), character =>
    character.charCodeAt(0)
  );
  const url = URL.createObjectURL(
    new Blob([bytes], { type: file.contentType })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function Settings() {
  const [, navigate] = useLocation();
  const [autonomy, setAutonomy] = useState<AutonomySettings>(
    reviewEverythingAutonomy
  );
  const [effectiveAutonomy, setEffectiveAutonomy] = useState<AutonomySettings>(
    reviewEverythingAutonomy
  );
  const [autonomyLoading, setAutonomyLoading] = useState(true);
  const [autonomySaving, setAutonomySaving] = useState(false);
  const [autonomyError, setAutonomyError] = useState("");
  const [mailbox, setMailbox] = useState<MailboxStatus | null>(null);
  const [mailboxLoading, setMailboxLoading] = useState(true);
  const [mailboxError, setMailboxError] = useState("");
  const organisation = trpc.organisation.current.useQuery(undefined, {
    retry: false,
  });
  const company = trpc.companySetup.get.useQuery(undefined, { retry: false });
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId), retry: false }
  );
  const exportData = trpc.assistant.exportWorkspaceData.useMutation({
    onSuccess: file => {
      downloadExport(file);
      toast.success(`${file.filename} is ready.`);
    },
    onError: error =>
      toast.error(
        friendlyError(error, "That export could not be created. Try again.")
      ),
  });

  const profile = company.data?.profile;
  const crmCount = systems.data?.length ?? 0;
  const workspaceMode = organisation.data?.settings?.workspaceMode;

  useEffect(() => {
    let active = true;
    autonomyApi()
      .then(result => {
        if (!active) return;
        setAutonomy(result.user);
        setEffectiveAutonomy(result.effective);
        setAutonomyError("");
      })
      .catch(error => {
        if (active)
          setAutonomyError(
            friendlyError(error, "Autonomy settings could not be loaded.")
          );
      })
      .finally(() => {
        if (active) setAutonomyLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    mailboxApi()
      .then(result => {
        if (active) setMailbox(result);
      })
      .catch(error => {
        if (active)
          setMailboxError(
            friendlyError(error, "Mailbox status could not be loaded.")
          );
      })
      .finally(() => {
        if (active) setMailboxLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function disconnectMailbox() {
    try {
      setMailboxLoading(true);
      setMailboxError("");
      await mailboxApi({ method: "DELETE" });
      setMailbox(await mailboxApi());
      toast.success("Your Microsoft mailbox was disconnected.");
    } catch (error) {
      setMailboxError(
        friendlyError(error, "Your mailbox could not be disconnected.")
      );
    } finally {
      setMailboxLoading(false);
    }
  }

  async function saveAutonomy() {
    try {
      setAutonomySaving(true);
      setAutonomyError("");
      const result = await autonomyApi({
        method: "PUT",
        body: JSON.stringify(autonomy),
      });
      setAutonomy(result.user);
      setEffectiveAutonomy(result.effective);
      toast.success("Autonomy and approval settings saved.");
    } catch (error) {
      setAutonomyError(
        friendlyError(
          error,
          "Autonomy settings could not be saved. Nothing changed."
        )
      );
    } finally {
      setAutonomySaving(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5 text-[#26354A]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.12em] text-[#6B7A90]">
            Workspace
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-.04em]">
            Settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#66758A]">
            Company setup, CRM connection, trusted knowledge and team access are
            managed here. Daily sales work stays out of the settings area.
          </p>
        </div>

        <ManagementElevation />

        <section className="grid gap-4 md:grid-cols-2">
          <SettingCard
            icon={Building2}
            title="Company setup"
            detail={
              profile
                ? `${profile.companyName} · ${profile.discoveryStatus === "confirmed" ? "business knowledge confirmed" : "setup still in progress"}`
                : "Start or continue the guided company onboarding."
            }
            action="Open company setup"
            onClick={() => navigate("/company-setup")}
          />
          <SettingCard
            icon={Cable}
            title="CRM connection"
            detail={
              crmCount
                ? `${crmCount} CRM connection${crmCount === 1 ? "" : "s"} configured. Open this area to sign in, reconnect or review status.`
                : "Connect the company CRM and complete the secure sign-in."
            }
            action={crmCount ? "Manage CRM" : "Connect CRM"}
            onClick={() => navigate("/connections")}
          />
          <SettingCard
            icon={BookOpenCheck}
            title="Company knowledge"
            detail="Review the trusted business facts Amarktai uses when helping the sales team."
            action="Review knowledge"
            onClick={() => navigate("/knowledge")}
          />
          {workspaceMode === "team" ? (
            <SettingCard
              icon={Users}
              title="Team members"
              detail="Invite, link and manage the people who use this sales workspace."
              action="Manage team members"
              onClick={() => navigate("/team/manage")}
            />
          ) : (
            <SettingCard
              icon={ShieldCheck}
              title="Security"
              detail="Sensitive company and CRM changes require a short management-access confirmation."
              action="Security is active"
            />
          )}
        </section>

        <section
          id="mailbox"
          data-personal-mailbox
          className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EEF3F8] text-[#405B7A]">
                <Mail className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#3F70D8]">
                  Your mailbox
                </p>
                <h2 className="mt-1 text-lg font-bold">Personal mailbox</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#66758A]">
                  Connect your own Microsoft account through the Microsoft 365
                  adapter. Amarktai never asks for your mailbox password. Drafts
                  wait for your review unless your approved autonomy settings
                  allow otherwise.
                </p>
                {mailbox?.connected ? (
                  <p className="mt-3 text-sm font-semibold text-emerald-700">
                    Connected as {mailbox.mailbox?.email}
                  </p>
                ) : null}
              </div>
            </div>
            {mailboxLoading ? (
              <Button variant="outline" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
              </Button>
            ) : mailbox?.connected ? (
              <Button
                variant="outline"
                onClick={() => void disconnectMailbox()}
              >
                Disconnect mailbox
              </Button>
            ) : (
              <Button
                disabled={mailbox?.configured === false}
                onClick={() =>
                  window.location.assign("/api/mailbox/microsoft/start")
                }
              >
                Connect Microsoft mailbox
              </Button>
            )}
          </div>
          {mailbox?.configured === false ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Your administrator still needs to enable delegated Microsoft
              mailbox connection.
            </p>
          ) : null}
          {mailboxError ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            >
              {mailboxError}
            </p>
          ) : null}
        </section>

        <section
          data-autonomy-settings
          className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EEF3F8] text-[#405B7A]">
              <SlidersHorizontal className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#3F70D8]">
                Autonomy &amp; approvals
              </p>
              <h2 className="mt-1 text-lg font-bold">
                Choose how Amarktai may work for you
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#66758A]">
                Start with review. You can give Amarktai more freedom later as
                you become comfortable with how it works.
              </p>
            </div>
          </div>

          {autonomyLoading ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-[#66758A]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading approval
              settings…
            </p>
          ) : (
            <>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {(
                  [
                    [
                      "review_everything",
                      "Review everything",
                      "Every customer-facing action waits for your confirmation.",
                    ],
                    [
                      "custom",
                      "Custom autonomy",
                      "Choose separate permissions for routine work.",
                    ],
                    [
                      "full",
                      "Full autonomy",
                      "Routine authorised work may proceed within company and safety limits.",
                    ],
                  ] as const
                ).map(([mode, title, detail]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={autonomy.mode === mode}
                    onClick={() =>
                      setAutonomy(current => ({ ...current, mode }))
                    }
                    className={`rounded-2xl border p-4 text-left transition ${autonomy.mode === mode ? "border-[#3F70D8] bg-[#F3F7FF]" : "border-[#DCE4EE] bg-white hover:border-[#AFC3E8]"}`}
                  >
                    <span className="font-bold">{title}</span>
                    <span className="mt-2 block text-xs leading-5 text-[#66758A]">
                      {detail}
                    </span>
                  </button>
                ))}
              </div>

              {autonomy.mode === "custom" ? (
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {autonomyPermissions.map(permission => (
                    <label
                      key={permission}
                      className="flex items-center justify-between gap-4 rounded-xl border border-[#E2E8F0] bg-[#FAFCFF] px-4 py-3 text-sm font-semibold"
                    >
                      {permissionLabels[permission]}
                      <input
                        type="checkbox"
                        checked={autonomy.permissions[permission]}
                        onChange={event =>
                          setAutonomy(current => ({
                            ...current,
                            permissions: {
                              ...current.permissions,
                              [permission]: event.target.checked,
                            },
                          }))
                        }
                        className="h-4 w-4 accent-[#3F70D8]"
                      />
                    </label>
                  ))}
                </div>
              ) : null}

              <div className="mt-5 rounded-xl border border-[#D9E3F0] bg-[#F8FAFD] p-4 text-xs leading-5 text-[#596A80]">
                Company policy remains the maximum. Opt-outs, recipient checks,
                duplicate protection, CRM capability checks, tenant isolation
                and compliance rules always remain active—even in Full autonomy.
                {JSON.stringify(effectiveAutonomy) !==
                JSON.stringify(autonomy) ? (
                  <strong className="mt-2 block text-amber-800">
                    Your organisation currently limits part of this selection.
                  </strong>
                ) : null}
              </div>

              {autonomyError ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                >
                  {autonomyError}
                </p>
              ) : null}
              <Button
                className="mt-4"
                disabled={autonomySaving}
                onClick={() => void saveAutonomy()}
              >
                {autonomySaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save autonomy settings
              </Button>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#EEF3F8] text-[#405B7A]">
              <Download className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold">Reports & exports</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#66758A]">
                Download a portable record of sales activity or the call and
                conversation history for this workspace.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "operational_report", format: "csv" })
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Download sales activity CSV
            </Button>
            <Button
              variant="outline"
              disabled={exportData.isPending}
              onClick={() =>
                exportData.mutate({ kind: "conversation_log", format: "pdf" })
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Download call log PDF
            </Button>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

function SettingCard({
  icon: Icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: typeof Building2;
  title: string;
  detail: string;
  action: string;
  onClick?: () => void;
}) {
  return (
    <article className="flex min-h-48 flex-col rounded-2xl border border-[#DCE4EE] bg-white p-5 shadow-sm">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#EEF3F8] text-[#405B7A]">
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-[#66758A]">{detail}</p>
      {onClick ? (
        <Button
          variant="outline"
          className="mt-4 justify-between"
          onClick={onClick}
        >
          {action}
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <p className="mt-4 text-xs font-bold text-emerald-700">{action}</p>
      )}
    </article>
  );
}
