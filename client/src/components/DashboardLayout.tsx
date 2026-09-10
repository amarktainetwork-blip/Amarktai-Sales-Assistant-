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
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Building2,
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

type NavItem = { icon: LucideIcon; label: string; path: string };

const dailyMenu: NavItem[] = [
  { icon: Home, label: "Home", path: "/today" },
  { icon: ContactRound, label: "Customers", path: "/customers" },
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
  trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    {
      enabled: Boolean(
        user && security.data?.verified && canManage && organisationId
      ),
      retry: false,
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
  const crmReady = Boolean(integrationReadiness.data?.genie.ready);
  const setupComplete = canManage
    ? Boolean(storedCompanyComplete && profileConfirmed && crmReady)
    : storedCompanyComplete;

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
  if (!user) return <SignedOut />;
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
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="amarktai-dashboard-sidebar border-r border-[#DCE4EE] bg-white text-[#26354A]"
      >
        <SidebarHeader className="h-[82px] justify-center border-b border-[#E5EAF0] px-5">
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

          <SidebarMenu className="mt-5 gap-1">
            {dailyMenu.map(item => (
              <AppNavItem key={item.path} {...item} />
            ))}
          </SidebarMenu>

          {secondaryMenu.length ? (
            <SidebarMenu className="mt-4 gap-1 border-t border-[#E7ECF2] pt-4">
              {secondaryMenu.map(item => (
                <AppNavItem key={item.path} {...item} />
              ))}
            </SidebarMenu>
          ) : null}
        </SidebarContent>

        <SidebarFooter className="border-t border-[#E5EAF0] p-3">
          <div className="flex items-center gap-2 px-1 py-1">
            <Avatar className="size-9 shrink-0 border border-[#D5DEEA] bg-[#EAF1FF] group-data-[collapsible=icon]:hidden">
              <AvatarFallback className="bg-[#EAF1FF] text-xs font-bold text-[#2F6FED]">
                {user.name?.slice(0, 1).toUpperCase() ?? "A"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-bold text-[#26354A]">
                {user.name || "AmarktAI user"}
              </p>
              <p className="truncate text-[11px] text-[#7B8798]">
                {user.email || "Sales workspace"}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#D7E0EA] bg-white px-2.5 text-xs font-semibold text-[#607086] transition hover:border-[#AFC1D8] hover:bg-[#F5F8FC] hover:text-[#26354A]"
            >
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">
                Sign out
              </span>
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-[#F4F7FA]">
        <AppTopbar title={pageTitle(location)} />
        <main className="min-h-[calc(100vh-58px)] p-4 sm:p-5 lg:p-6">
          {canManage &&
          !setupComplete &&
          location !== "/company-setup" &&
          !location.startsWith("/crm") ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950 shadow-sm">
              <span>
                Finish company setup to bring your knowledge and CRM into the
                workspace.
              </span>
              <Button size="sm" onClick={() => navigate("/company-setup")}>
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
  if (location.startsWith("/calls")) return "Calls";
  if (location.startsWith("/assistant")) return "AmarktAI";
  if (location.startsWith("/reviews")) return "Review";
  if (location.startsWith("/team")) return "Team";
  if (location.startsWith("/settings")) return "Settings";
  if (location.startsWith("/company-setup")) return "Company setup";
  if (location.startsWith("/connections")) return "CRM setup";
  if (location.startsWith("/knowledge")) return "Company knowledge";
  if (location.startsWith("/crm")) return "Source CRM";
  return "Home";
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

function SignedOut() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-md rounded-2xl border border-[#DCE2E9] bg-white p-7 shadow-sm">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-bold tracking-[-.04em]">
          Sign in to your sales workspace.
        </h1>
        <p className="mt-3 leading-6 text-[#6C798B]">
          Your customers, calls, priorities, follow-ups and connected CRM
          context live here with AmarktAI.
        </p>
        <Button
          onClick={() => startLogin()}
          className="mt-6 h-12 w-full rounded-xl bg-[#3F70D8] font-bold text-white hover:bg-[#315BB6]"
        >
          Sign in
        </Button>
      </div>
    </div>
  );
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

function AppNavItem({ icon: Icon, label, path }: NavItem) {
  const [location, setLocation] = useLocation();
  const active = location === path;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => setLocation(path)}
        tooltip={label}
        aria-label={label}
        className={`h-11 rounded-lg px-3 transition-all ${
          active
            ? "bg-[#EAF1FF] text-[#2459C2] hover:bg-[#E3ECFF] hover:text-[#2459C2]"
            : "text-[#607086] hover:bg-[#F2F5F8] hover:text-[#26354A]"
        }`}
      >
        <Icon className="size-[18px]" />
        <span className="font-semibold group-data-[collapsible=icon]:hidden">
          {label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppTopbar({ title }: { title: string }) {
  return (
    <header className="flex h-[58px] items-center gap-3 border-b border-[#DCE2E9] bg-white px-3 sm:px-5">
      <SidebarTrigger className="rounded-lg text-[#26354A] hover:bg-[#EEF2F5]" />
      <p className="text-sm font-bold text-[#33445B]">{title}</p>
    </header>
  );
}
