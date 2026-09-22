import { showCrmAttention } from "@/lib/workspaceHealth";
import {
  rememberNewLeadNotifications,
  unseenNewLeadNotifications,
} from "@/lib/newLeadNotifications";
import { useAuth } from "@/_core/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import ManagementElevation from "@/components/ManagementElevation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { trpc } from "@/lib/trpc";
import { timedWorkAttention } from "@/lib/timedWorkAttention";
import {
  Building2,
  AlertTriangle,
  CalendarClock,
  Cable,
  ClipboardCheck,
  ContactRound,
  Headphones,
  Home,
  LockKeyhole,
  LogOut,
  MailCheck,
  MessageSquareText,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: number;
};

const dailyMenu: NavItem[] = [
  { icon: Home, label: "Today", path: "/today" },
  { icon: ContactRound, label: "Customers", path: "/customers" },
  { icon: MailCheck, label: "Inbox", path: "/inbox" },
  { icon: Headphones, label: "Calls", path: "/calls" },
  { icon: MessageSquareText, label: "AmarktAI", path: "/assistant" },
  { icon: ClipboardCheck, label: "Review", path: "/reviews" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [location, navigate] = useLocation();
  const [clock, setClock] = useState(() => Date.now());
  const { loading, user, logout, error: authError, refresh } = useAuth();
  const security = trpc.security.status.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const organisation = trpc.organisation.current.useQuery(undefined, {
    enabled: Boolean(user && security.data?.verified),
  });
  const organisations = trpc.organisation.available.useQuery(undefined, {
    enabled: Boolean(user && security.data?.verified),
  });
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager" ||
    user?.role === "admin";
  const companySetup = trpc.companySetup.get.useQuery(undefined, {
    enabled: Boolean(user && security.data?.verified && canManage),
    retry: false,
  });
  const organisationId = organisation.data?.organisationId;
  const newLeadAlerts = trpc.sales.newLeadAlerts.useQuery(
    { organisationId: organisationId ?? 0, limit: 20 },
    {
      enabled: Boolean(user && security.data?.verified && organisationId),
      retry: false,
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
    }
  );
  const inbox = trpc.sales.inbox.useQuery(
    { organisationId: organisationId ?? 0, limit: 20 },
    {
      enabled: Boolean(user && security.data?.verified && organisationId),
      retry: false,
      refetchInterval: 15_000,
      refetchIntervalInBackground: true,
    }
  );
  const dayPulse = trpc.sales.today.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(user && security.data?.verified && organisationId),
      retry: false,
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
    }
  );
  const connectedSystems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(user && security.data?.verified && organisationId),
      retry: false,
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
    }
  );
  const integrationReadiness = trpc.integrations.list.useQuery(undefined, {
    enabled: Boolean(
      user && security.data?.verified && canManage && organisationId
    ),
    retry: false,
  });
  const utils = trpc.useUtils();
  const switchOrganisation = trpc.organisation.switch.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.organisation.current.invalidate(),
        utils.organisation.available.invalidate(),
      ]);
      window.location.reload();
    },
    onError: () => toast.error("That workspace could not be opened."),
  });

  const settings = organisation.data?.settings;
  const workspaceMode =
    settings?.workspaceMode === "team"
      ? "team"
      : settings?.workspaceMode === "individual"
        ? "individual"
        : null;
  const onboarding =
    settings?.onboarding && typeof settings.onboarding === "object"
      ? (settings.onboarding as { complete?: unknown })
      : null;
  const storedCompanyComplete = onboarding?.complete === true;
  const profileConfirmed =
    companySetup.data?.profile?.discoveryStatus === "confirmed";
  const crmAttention = showCrmAttention(
    connectedSystems.data,
    connectedSystems.isSuccess
  );
  const crmProblem = connectedSystems.data?.find(system =>
    [
      "authentication_expired",
      "needs_attention",
      "limited_permissions",
      "error",
    ].includes(system.status)
  );
  const timedAttention = useMemo(
    () => timedWorkAttention(dayPulse.data?.queues.callQueue ?? [], clock),
    [clock, dayPulse.data?.queues.callQueue]
  );
  const dueAttention = timedAttention?.item;
  const dueAttentionPhase = timedAttention?.phase ?? "soon";
  // Completed onboarding is durable; runtime CRM health is shown separately.
  const setupComplete = storedCompanyComplete;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      !canManage ||
      !companySetup.isSuccess ||
      companySetup.data?.profile ||
      location === "/company-setup"
    )
      return;
    navigate("/company-setup", { replace: true });
  }, [
    canManage,
    companySetup.data?.profile,
    companySetup.isSuccess,
    location,
    navigate,
  ]);

  useEffect(() => {
    if (!organisationId || !newLeadAlerts.data?.length) return;
    try {
      const key = `amarktai:new-lead-notified:${organisationId}`;
      const stored = JSON.parse(localStorage.getItem(key) || "[]") as string[];
      const unseen = unseenNewLeadNotifications(
        newLeadAlerts.data,
        stored
      ) as typeof newLeadAlerts.data;
      if (!unseen.length) return;
      const first = unseen[0];
      toast.success(
        unseen.length === 1
          ? `New lead: ${first.name}`
          : `${unseen.length} new leads have arrived`,
        {
          description:
            unseen.length === 1 && first.interest.primary
              ? `Interested in: ${first.interest.primary}`
              : "Open Today to work the newest leads first.",
        }
      );
      localStorage.setItem(
        key,
        JSON.stringify(rememberNewLeadNotifications(stored, unseen))
      );
    } catch {
      // Durable NEW_LEAD work remains authoritative if browser storage is unavailable.
    }
  }, [newLeadAlerts.data, organisationId]);

  useEffect(() => {
    if (!organisationId || !inbox.data?.messages.length) return;
    try {
      const key = `amarktai:inbox-notified:${organisationId}`;
      const stored = JSON.parse(localStorage.getItem(key) || "[]") as number[];
      const actionable = inbox.data.messages.filter(
        message => message.needsAction
      );
      const unseen = actionable.filter(message => !stored.includes(message.id));
      if (!unseen.length) return;
      const first = unseen[0];
      const classification =
        first.classification &&
        typeof first.classification === "object" &&
        !Array.isArray(first.classification)
          ? String(
              (first.classification as Record<string, unknown>).category || ""
            )
          : "";
      toast.success(
        classification === "sale_intent"
          ? `Possible sale: ${first.contact?.name || first.senderReference}`
          : `New customer ${first.channel}: ${first.contact?.name || first.senderReference}`,
        {
          description: first.subject || "A customer reply needs attention.",
          action: { label: "Open inbox", onClick: () => navigate("/inbox") },
        }
      );
      localStorage.setItem(
        key,
        JSON.stringify(
          [...unseen.map(message => message.id), ...stored].slice(0, 100)
        )
      );
    } catch {
      // Inbox source truth remains in the database if browser storage is unavailable.
    }
  }, [inbox.data?.messages, organisationId, navigate]);

  useEffect(() => {
    if (!organisationId || !dueAttention?.dueAt) return;
    try {
      const dueAt = new Date(dueAttention.dueAt);
      const key = `amarktai:timed-work-notified:${organisationId}:${dueAttention.key}:${dueAt.toISOString()}:${dueAttentionPhase}`;
      if (localStorage.getItem(key)) return;
      const minutes = Math.max(
        0,
        Math.ceil((dueAt.valueOf() - Date.now()) / 60_000)
      );
      const dueNow = dueAttentionPhase === "due";
      const title = dueNow
        ? `${dueAttention.name} is due now`
        : `${dueAttention.name} is due in ${minutes} minute${minutes === 1 ? "" : "s"}`;
      toast.info(title, {
        description: dueAttention.headline,
        action: { label: "Open Today", onClick: () => navigate("/today") },
        duration: dueNow ? 20_000 : 12_000,
      });
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(
          dueNow
            ? "AmarktAI · Sales task due now"
            : "AmarktAI · Upcoming sales task",
          {
            body: dueNow
              ? `${dueAttention.name}: ${dueAttention.headline}`
              : `${dueAttention.name}: ${dueAttention.headline} · due in ${minutes} minute${minutes === 1 ? "" : "s"}`,
          }
        );
      }
      localStorage.setItem(key, "1");
    } catch {
      // The persistent Today queue remains the source of truth.
    }
  }, [dueAttention, dueAttentionPhase, navigate, organisationId]);

  const secondaryMenu = useMemo<NavItem[]>(() => {
    if (!canManage) return [];
    return [
      ...(workspaceMode === "team"
        ? [{ icon: Users, label: "Team", path: "/team" } satisfies NavItem]
        : []),
      { icon: Cable, label: "CRM setup", path: "/connections" },
      { icon: Settings2, label: "Settings", path: "/settings" },
    ];
  }, [canManage, workspaceMode]);

  if (loading || security.isLoading) return <DashboardLayoutSkeleton />;
  if (authError || security.isError)
    return (
      <div role="alert" className="p-6">
        Secure access could not be checked.{" "}
        <Button
          onClick={() => {
            void refresh();
            void security.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  if (!user) return <HomeRedirect />;
  if (!security.data?.verified)
    return (
      <SecondFactorGate
        hasEmail={Boolean(security.data?.hasEmail)}
        smtpReady={Boolean(security.data?.smtpReady)}
      />
    );
  if (organisation.isLoading) return <DashboardLayoutSkeleton />;
  if (
    organisation.isError &&
    organisations.data &&
    organisations.data.length > 1
  )
    return (
      <OrganisationSelectionGate
        organisations={organisations.data}
        pending={switchOrganisation.isPending}
        onSelect={organisationIdValue =>
          switchOrganisation.mutate({ organisationId: organisationIdValue })
        }
      />
    );

  if (organisation.isError)
    return (
      <div role="alert" className="p-6">
        Your workspace could not be loaded.{" "}
        <Button onClick={() => void organisation.refetch()}>Retry</Button>
      </div>
    );

  if (!canManage && !storedCompanyComplete) return <WorkspaceSetupPending />;
  const showManagementAccess =
    canManage &&
    (location === "/connections" ||
      (location === "/company-setup" && profileConfirmed));

  return (
    <SidebarProvider className="sales-workspace">
      <Sidebar
        collapsible="icon"
        className="amarktai-dashboard-sidebar bg-[#FAFBFC] text-[#2F3D52]"
      >
        <SidebarHeader className="h-[72px] justify-center px-5">
          <BrandMark />
        </SidebarHeader>
        <SidebarContent className="px-3 py-4">
          <OrganisationSwitcher
            currentName={organisation.data?.organisationName}
            organisations={organisations.data ?? []}
            pending={switchOrganisation.isPending}
            onSelect={organisationIdValue =>
              switchOrganisation.mutate({ organisationId: organisationIdValue })
            }
          />

          <p className="mt-5 px-2 text-xs font-semibold text-[#89909A] group-data-[collapsible=icon]:hidden">
            Daily flow
          </p>
          <SidebarMenu className="mt-2 gap-1">
            {dailyMenu.map(item => (
              <AppNavItem
                key={item.path}
                {...item}
                badge={
                  item.path === "/inbox"
                    ? inbox.data?.needsActionCount
                    : item.badge
                }
              />
            ))}
          </SidebarMenu>

          {secondaryMenu.length ? (
            <SidebarMenu className="mt-5 gap-1 pt-2">
              {secondaryMenu.map(item => (
                <AppNavItem key={item.path} {...item} />
              ))}
            </SidebarMenu>
          ) : null}
        </SidebarContent>

        <SidebarFooter className="p-3">
          <div className="flex items-center gap-2 px-1 py-1">
            <Avatar className="size-9 shrink-0 bg-[#ECEFF3] group-data-[collapsible=icon]:hidden">
              <AvatarFallback className="bg-[#ECEFF3] text-xs font-bold text-[#526174]">
                {user.name?.slice(0, 1).toUpperCase() ?? "A"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold text-[#343A42]">
                {user.name || "AmarktAI user"}
              </p>
              <p className="truncate text-xs text-[#7C838C]">
                {user.email || "Sales workspace"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void logout().finally(() => window.location.assign("/"));
              }}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-transparent px-2.5 text-xs font-semibold text-[#748092] transition hover:bg-[#ECEFF3] hover:text-[#2F3D52]"
            >
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                Sign out
              </span>
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-[#F3F6F7]">
        <AppTopbar />
        <main className="min-h-[calc(100vh-46px)] px-4 pb-6 pt-1 sm:px-6 lg:px-8">
          {dueAttention?.dueAt ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#EDF2F3] px-4 py-3 text-sm text-[#52636C]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <CalendarClock className="h-4 w-4 shrink-0 text-[#6B746E]" />
                <span className="min-w-0">
                  <strong className="font-semibold">{dueAttention.name}</strong>
                  {" · "}
                  {dueAttention.headline}
                  {" · "}
                  {dueAttentionPhase === "due"
                    ? "due now"
                    : `due in ${Math.max(
                        0,
                        Math.ceil(
                          (new Date(dueAttention.dueAt).valueOf() - clock) /
                            60_000
                        )
                      )} min`}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/today")}
              >
                Open Today
              </Button>
            </div>
          ) : null}

          {storedCompanyComplete && crmAttention && crmProblem ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F1EDE4] px-4 py-3 text-sm text-[#5D5341]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#8A7653]" />
                <span>
                  {crmProblem.status === "authentication_expired"
                    ? "The CRM sign-in has expired. Fresh CRM changes are paused until the connection is restored."
                    : "The CRM connection needs attention. AmarktAI is keeping the last safe synchronized data available."}
                </span>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("/connections")}
                >
                  {crmProblem.status === "authentication_expired"
                    ? "Sign in again"
                    : "Check CRM"}
                </Button>
              ) : (
                <span className="text-xs font-medium">
                  Ask your manager to reconnect the company CRM.
                </span>
              )}
            </div>
          ) : null}

          {canManage &&
          !setupComplete &&
          location !== "/company-setup" &&
          !location.startsWith("/crm") ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F1EDE4] px-4 py-3 text-sm font-medium text-[#5D5341]">
              <span>
                Finish company setup to bring your knowledge and CRM into the
                workspace.
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate("/company-setup")}
              >
                Continue setup
              </Button>
            </div>
          ) : null}
          {showManagementAccess ? (
            <div className="mb-4">
              <ManagementElevation
                showBrowserCommissioning={location === "/connections"}
              />
            </div>
          ) : null}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function pageTitle(location: string) {
  if (location.startsWith("/customers")) return "Customers";
  if (location.startsWith("/inbox")) return "Inbox";
  if (location.startsWith("/calls")) return "Calls";
  if (location.startsWith("/assistant")) return "AmarktAI";
  if (location.startsWith("/reviews")) return "Review";
  if (location.startsWith("/team")) return "Team";
  if (location.startsWith("/settings")) return "Settings";
  if (location.startsWith("/company-setup")) return "Company setup";
  if (location.startsWith("/connections")) return "CRM setup";
  if (location.startsWith("/knowledge")) return "Company knowledge";
  if (location.startsWith("/crm")) return "Source CRM";
  return "Today";
}

function WorkspaceSetupPending() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-2xl border border-[#DCE2E9] bg-white p-7 shadow-sm">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-bold tracking-[-.04em]">
          Your AmarktAI workspace is being prepared.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#6C798B]">
          Your manager is connecting company knowledge and the CRM. When setup
          is proven, your customers, tasks, opportunities and call context will
          be available here automatically.
        </p>
      </div>
    </div>
  );
}

function HomeRedirect() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return <DashboardLayoutSkeleton />;
}

function SecondFactorGate({
  hasEmail,
  smtpReady,
}: {
  hasEmail: boolean;
  smtpReady: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const [code, setCode] = useState("");
  const [feedback, setFeedback] = useState("");
  const status = trpc.security.status.useQuery();
  const requestCode = trpc.security.requestEmailCode.useMutation({
    onSuccess: () => {
      setRequested(true);
      setFeedback("");
      toast.success("Verification code sent.");
    },
    onError: () => setFeedback("The code could not be sent. Please try again."),
  });
  const verifyCode = trpc.security.verifyEmailCode.useMutation({
    onSuccess: () => {
      setFeedback("");
      status.refetch();
      window.location.assign("/dashboard");
    },
    onError: () =>
      setFeedback(
        "That code wasn’t accepted. Check the six digits or request a new one."
      ),
  });

  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-lg rounded-2xl border border-[#DCE2E9] bg-white p-7 shadow-sm sm:p-8">
        <BrandMark />
        <div className="mt-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#EDF3FF] text-[#315BB6]">
            <LockKeyhole size={19} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-[#6C798B]">
              Security check
            </p>
            <h1 className="text-2xl font-bold">Confirm access</h1>
          </div>
        </div>
        {feedback ? (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
          >
            {feedback}
          </p>
        ) : null}
        {!hasEmail ? (
          <Notice text="This account needs an email address before access can be verified." />
        ) : !smtpReady ? (
          <Notice text="Email verification is not available yet. Ask the administrator to finish email setup." />
        ) : !requested ? (
          <>
            <p className="mt-4 text-sm leading-6 text-[#6C798B]">
              We’ll send a six-digit code to your account email.
            </p>
            <Button
              onClick={() => requestCode.mutate()}
              disabled={requestCode.isPending}
              className="mt-5 h-12 w-full"
            >
              <MailCheck className="mr-2 h-4 w-4" />
              {requestCode.isPending ? "Sending…" : "Send code"}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm leading-6 text-[#6C798B]">
              Enter the six-digit code.
            </p>
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="mt-5 h-14 w-full rounded-xl border-2 border-[#D5DDE7] text-center text-2xl font-bold tracking-[.3em] outline-none focus:border-[#6F91E2]"
            />
            <Button
              onClick={() => verifyCode.mutate({ code })}
              disabled={code.length !== 6 || verifyCode.isPending}
              className="mt-4 h-12 w-full"
            >
              {verifyCode.isPending ? "Checking…" : "Continue"}
            </Button>
            <button
              onClick={() => requestCode.mutate()}
              className="mt-4 w-full text-sm font-bold text-[#3F70D8]"
            >
              Send a new code
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="mt-5 rounded-xl border border-[#D4DEEA] bg-[#F4F7FA] p-4 text-sm leading-6 text-[#56677C]">
      {text}
    </p>
  );
}

function OrganisationSwitcher({
  currentName,
  organisations,
  pending,
  onSelect,
}: {
  currentName?: string;
  organisations: Array<{ organisationId: number; organisationName: string }>;
  pending: boolean;
  onSelect: (organisationId: number) => void;
}) {
  if (organisations.length < 2)
    return (
      <div className="rounded-lg border border-[#DCE4EE] bg-[#F8FAFC] px-3 py-2.5">
        <p className="truncate text-xs font-bold text-[#33445B]">
          {currentName || "Sales workspace"}
        </p>
      </div>
    );
  return (
    <label className="block rounded-lg border border-[#DCE4EE] bg-[#F8FAFC] px-3 py-2.5">
      <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-[#7A889A]">
        <Building2 size={13} /> Workspace
      </span>
      <select
        aria-label="Workspace"
        disabled={pending}
        value={
          organisations.find(item => item.organisationName === currentName)
            ?.organisationId ?? ""
        }
        onChange={event => onSelect(Number(event.target.value))}
        className="mt-1 w-full bg-transparent text-sm font-bold text-[#33445B] outline-none"
      >
        <option value="" disabled>
          Select workspace
        </option>
        {organisations.map(item => (
          <option
            key={item.organisationId}
            value={item.organisationId}
            className="bg-white text-[#26354A]"
          >
            {item.organisationName}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrganisationSelectionGate({
  organisations,
  pending,
  onSelect,
}: {
  organisations: Array<{ organisationId: number; organisationName: string }>;
  pending: boolean;
  onSelect: (organisationId: number) => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-2xl border border-[#DCE2E9] bg-white p-7 shadow-sm">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-bold tracking-[-.04em]">
          Which workspace are you using?
        </h1>
        <div className="mt-5 grid gap-3">
          {organisations.map(item => (
            <button
              key={item.organisationId}
              disabled={pending}
              onClick={() => onSelect(item.organisationId)}
              className="flex items-center justify-between rounded-xl border border-[#DCE2E9] bg-[#F8FAFC] px-4 py-4 text-left font-bold transition hover:border-[#8EACEB] hover:bg-[#EDF3FF]"
            >
              <span>{item.organisationName}</span>
              <Building2 size={17} className="text-[#3F70D8]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppNavItem({ icon: Icon, label, path, badge }: NavItem) {
  const [location, setLocation] = useLocation();
  const active = location === path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => setLocation(path)}
        tooltip={label}
        aria-label={label}
        className={`h-11 rounded-lg px-3 transition-colors ${
          active
            ? "bg-[#ECEFF3] text-[#2F3D52] hover:bg-[#ECEFF3] hover:text-[#2F3D52]"
            : "text-[#687587] hover:bg-[#F0F2F5] hover:text-[#2F3D52]"
        }`}
      >
        <Icon className="size-[18px]" />
        <span className="font-semibold group-data-[collapsible=icon]:hidden">
          {label}
        </span>
        {badge && badge > 0 ? (
          <span className="ml-auto rounded-full bg-[#5E6D80] px-2 py-0.5 text-[10px] font-bold text-white group-data-[collapsible=icon]:hidden">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppTopbar() {
  return (
    <header className="flex h-[46px] items-center px-3 sm:px-5">
      <SidebarTrigger className="rounded-lg text-[#66758A] hover:bg-[#ECEFF3] hover:text-[#2F3D52]" />
    </header>
  );
}
