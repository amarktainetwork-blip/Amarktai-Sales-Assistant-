import { useAuth } from "@/_core/hooks/useAuth";
import { BrandMark } from "@/components/BrandMark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  Building2,
  Cable,
  CalendarDays,
  CheckCircle2,
  ContactRound,
  Headphones,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MailCheck,
  MonitorUp,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

type NavItem = { icon: typeof LayoutDashboard; label: string; path: string };
type CrmIdentity = {
  mapped: boolean;
  candidates: Array<{
    id: number;
    displayName: string;
    email: string | null;
    connectedSystemId: number;
  }>;
};

const dailyMenu: NavItem[] = [
  { icon: Bot, label: "Assistant", path: "/assistant" },
  { icon: CalendarDays, label: "Today", path: "/today" },
  { icon: ContactRound, label: "Customers", path: "/customers" },
  { icon: Headphones, label: "Calls", path: "/calls" },
  { icon: MonitorUp, label: "CRM", path: "/crm" },
];

const managerMenu: NavItem[] = [
  { icon: Cable, label: "Connections", path: "/connections" },
  { icon: Settings2, label: "Company", path: "/company-setup" },
];

const teamManagerMenu: NavItem[] = [
  { icon: LayoutDashboard, label: "Team", path: "/team" },
  { icon: Users, label: "Team members", path: "/team/manage" },
  ...managerMenu,
];

function safeToastError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/identity/i.test(raw) && /crm/i.test(raw))
    return "Your CRM identity could not be confirmed. Try again or ask your manager for help.";
  if (/organisation|workspace/i.test(raw)) return "That workspace could not be opened.";
  return fallback;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [location, navigate] = useLocation();
  const [crmIdentity, setCrmIdentity] = useState<CrmIdentity | null>(null);
  const [identityPending, setIdentityPending] = useState(false);
  const { loading, user, logout } = useAuth();
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
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisation.data?.organisationId || 0 },
    {
      enabled: Boolean(
        user &&
          security.data?.verified &&
          organisation.data?.organisationId &&
          canManage
      ),
      retry: false,
    }
  );
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
  const effectiveCompanyComplete =
    storedCompanyComplete ||
    Boolean(
      canManage &&
        companySetup.data?.profile?.discoveryStatus === "confirmed" &&
        systems.data?.length
    );
  const requiresSalespersonIdentity =
    organisation.data?.role === "salesperson" && !canManage && storedCompanyComplete;

  useEffect(() => {
    if (!requiresSalespersonIdentity) return;
    fetch("/api/team/crm-identity", { credentials: "include" })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("CRM identity could not be loaded.");
        setCrmIdentity(body as CrmIdentity);
      })
      .catch(() => {
        setCrmIdentity({ mapped: false, candidates: [] });
        toast.error("Your CRM identity could not be checked.");
      });
  }, [requiresSalespersonIdentity]);

  async function confirmCrmIdentity(mappingId: number) {
    try {
      setIdentityPending(true);
      const response = await fetch("/api/team/crm-identity", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappingId }),
      });
      if (!response.ok) throw new Error("CRM identity could not be confirmed.");
      setCrmIdentity({ mapped: true, candidates: [] });
      toast.success("Your CRM identity is connected.");
    } catch (error) {
      toast.error(safeToastError(error, "Your CRM identity could not be confirmed."));
    } finally {
      setIdentityPending(false);
    }
  }

  const secondaryMenu = useMemo(() => {
    if (!canManage) return [];
    return workspaceMode === "team" ? teamManagerMenu : managerMenu;
  }, [canManage, workspaceMode]);

  if (loading || security.isLoading) return <DashboardLayoutSkeleton />;
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
        onSelect={organisationId => switchOrganisation.mutate({ organisationId })}
      />
    );

  // Team members inherit the company setup. Only block them while the shared
  // company really has not completed setup; stale manager progress flags do not
  // create another onboarding loop.
  if (!canManage && !storedCompanyComplete)
    return <WorkspaceSetupPending />;

  if (requiresSalespersonIdentity && !crmIdentity)
    return <DashboardLayoutSkeleton />;
  if (requiresSalespersonIdentity && crmIdentity && !crmIdentity.mapped)
    return (
      <SalespersonIdentityGate
        candidates={crmIdentity.candidates}
        pending={identityPending}
        onConfirm={confirmCrmIdentity}
      />
    );

  return (
    <SidebarProvider>
      <Sidebar
        collapsible="icon"
        className="border-r border-[#52677F] bg-[#3A4D66] text-white"
      >
        <SidebarHeader className="h-[88px] justify-center border-b border-white/15 px-5">
          <BrandMark inverse />
        </SidebarHeader>
        <SidebarContent className="px-3 py-4">
          <OrganisationSwitcher
            currentName={organisation.data?.organisationName}
            organisations={organisations.data ?? []}
            pending={switchOrganisation.isPending}
            onSelect={organisationId => switchOrganisation.mutate({ organisationId })}
          />

          <p className="px-3 pb-2 pt-5 text-[9px] font-black uppercase tracking-[.15em] text-[#C4D0DD]">
            Sales workspace
          </p>
          <SidebarMenu>
            {dailyMenu.map(item => (
              <AppNavItem key={item.path} {...item} />
            ))}
          </SidebarMenu>

          {secondaryMenu.length ? (
            <>
              <p className="px-3 pb-2 pt-5 text-[9px] font-black uppercase tracking-[.15em] text-[#C4D0DD]">
                Manage
              </p>
              <SidebarMenu>
                {secondaryMenu.map(item => (
                  <AppNavItem key={item.path} {...item} />
                ))}
              </SidebarMenu>
            </>
          ) : null}
        </SidebarContent>
        <SidebarFooter className="border-t border-white/15 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/10">
                <Avatar className="size-9 border border-white/20 bg-[#58708D]">
                  <AvatarFallback className="bg-[#58708D] text-xs font-bold text-white">
                    {user.name?.slice(0, 1).toUpperCase() ?? "A"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">
                    {user.name || "Amarktai user"}
                  </p>
                  <p className="truncate text-xs text-[#CFD8E3]">
                    {user.email || "Sales workspace"}
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={logout}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-[#F5F7FA]">
        <AppTopbar onAssistant={() => navigate("/assistant")} />
        <main className="min-h-[calc(100vh-66px)] p-4 sm:p-6 lg:p-8">
          {canManage && !effectiveCompanyComplete && location !== "/company-setup" ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D5DFEB] bg-white px-4 py-3 text-sm text-[#33445B] shadow-sm">
              <span>
                Finish the company setup so Amarktai can use your business and CRM context.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/company-setup")}
              >
                Continue setup
              </Button>
            </div>
          ) : null}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function WorkspaceSetupPending() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-3xl border border-[#DCE2E9] bg-white p-8 shadow-sm sm:p-10">
        <BrandMark />
        <div className="mt-10 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Building2 size={23} />
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold tracking-[-.06em]">
          Your company workspace is being prepared.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          Your manager is connecting the shared business knowledge and CRM. You
          won’t need to repeat that setup when it’s ready.
        </p>
      </div>
    </div>
  );
}

function SalespersonIdentityGate({
  candidates,
  pending,
  onConfirm,
}: {
  candidates: CrmIdentity["candidates"];
  pending: boolean;
  onConfirm: (mappingId: number) => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-3xl border border-[#DCE2E9] bg-white p-8 shadow-sm sm:p-10">
        <BrandMark />
        <div className="mt-10 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <ContactRound size={23} />
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold tracking-[-.06em]">
          Which CRM salesperson are you?
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          Confirm your match once so your customers and tasks stay tied to the right person.
        </p>
        {candidates.length ? (
          <div className="mt-6 grid gap-3">
            {candidates.map(candidate => (
              <button
                key={candidate.id}
                disabled={pending}
                onClick={() => onConfirm(candidate.id)}
                className="rounded-xl border border-[#DCE2E9] bg-[#F8FAFC] p-4 text-left transition hover:border-[#8EACEB] hover:bg-[#EDF3FF]"
              >
                <p className="font-bold">{candidate.displayName}</p>
                <p className="mt-1 text-xs text-[#6C798B]">
                  {candidate.email || "CRM salesperson"}
                </p>
                <span className="mt-3 inline-block text-sm font-bold text-[#3F70D8]">
                  This is me
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-[#E8D5A8] bg-[#FBF3DF] p-4 text-sm leading-6 text-[#7B5A22]">
            We couldn’t find an exact match yet. Ask your manager to link your CRM salesperson record to your Amarktai account.
          </p>
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-md rounded-3xl border border-[#DCE2E9] bg-white p-8 shadow-sm">
        <BrandMark />
        <div className="mb-5 mt-10 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Bot size={23} />
        </div>
        <h1 className="font-display text-4xl font-bold tracking-[-.06em]">
          Your sales assistant is ready when you are.
        </h1>
        <p className="mt-4 leading-6 text-[#6C798B]">
          Sign in to work with your customers, calls, priorities and CRM.
        </p>
        <Button
          onClick={() => startLogin()}
          className="mt-7 h-12 w-full rounded-xl bg-[#3F70D8] font-bold text-white hover:bg-[#315BB6]"
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
    onError: () => setFeedback("That code wasn’t accepted. Check the six digits or request a new one."),
  });

  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-[#DCE2E9] bg-white shadow-sm lg:grid-cols-[.9fr_1.1fr]">
        <section className="bg-[#EEF4FB] p-8 sm:p-10">
          <BrandMark />
          <div className="mt-14 grid size-12 place-items-center rounded-2xl bg-[#DDE9FB] text-[#315BB6]">
            <LockKeyhole size={21} />
          </div>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[.9] tracking-[-.07em]">
            One quick security check.
          </h1>
          <p className="mt-5 text-sm leading-6 text-[#6C798B]">
            Verify your email before opening customer and company information.
          </p>
        </section>
        <section className="p-8 sm:p-10">
          <div className="grid size-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
            <MailCheck size={20} />
          </div>
          <h2 className="mt-6 font-display text-4xl font-bold tracking-[-.06em]">
            Confirm access
          </h2>
          {feedback ? (
            <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
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
                className="mt-7 h-12 w-full"
              >
                {requestCode.isPending ? "Sending…" : "Send code"}
              </Button>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm leading-6 text-[#6C798B]">Enter the six-digit code.</p>
              <input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="mt-6 h-14 w-full rounded-xl border-2 border-[#D5DDE7] text-center font-display text-3xl font-bold tracking-[.32em] outline-none focus:border-[#6F91E2]"
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
        </section>
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
      <div className="rounded-lg border border-white/15 bg-white/10 px-3 py-2">
        <p className="truncate text-xs font-bold text-white">
          {currentName || "Sales workspace"}
        </p>
      </div>
    );
  return (
    <label className="block rounded-lg border border-white/15 bg-white/10 px-3 py-2">
      <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-[#D7E0EA]">
        <Building2 size={13} /> Workspace
      </span>
      <select
        aria-label="Workspace"
        disabled={pending}
        value={
          organisations.find(item => item.organisationName === currentName)?.organisationId ?? ""
        }
        onChange={event => onSelect(Number(event.target.value))}
        className="mt-1 w-full bg-transparent text-sm font-bold text-white outline-none"
      >
        <option value="" disabled>Select workspace</option>
        {organisations.map(item => (
          <option key={item.organisationId} value={item.organisationId} className="bg-[#3A4D66]">
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
      <div className="w-full max-w-xl rounded-3xl border border-[#DCE2E9] bg-white p-8 shadow-sm sm:p-10">
        <BrandMark />
        <h1 className="mt-10 font-display text-4xl font-bold tracking-[-.06em]">
          Which workspace are you using?
        </h1>
        <div className="mt-6 grid gap-3">
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
  const active =
    location === path ||
    (path === "/crm" && location.startsWith("/crm/"));
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => setLocation(path)}
        tooltip={label}
        aria-label={label}
        className={`h-11 rounded-lg px-3 transition-all hover:bg-[#465C77] hover:text-white ${
          active
            ? "bg-[#F7F9FB] text-[#26354A] hover:bg-[#F7F9FB]"
            : "text-[#E1E7EE]"
        }`}
      >
        <Icon className="size-[18px]" />
        <span className="font-semibold group-data-[collapsible=icon]:hidden">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppTopbar({ onAssistant }: { onAssistant: () => void }) {
  const isMobile = useIsMobile();
  if (!isMobile)
    return (
      <header className="flex h-[66px] items-center justify-between border-b border-[#DCE2E9] bg-white/95 px-8 backdrop-blur">
        <p className="text-sm font-bold text-[#526277]">Sales workspace</p>
        <button
          onClick={onAssistant}
          className="flex items-center gap-2 rounded-full border border-[#D5DFEB] bg-[#F3F6FA] px-3 py-1.5 text-xs font-bold text-[#526277] transition hover:border-[#9CB8E8] hover:bg-[#EDF3FF]"
        >
          <Bot className="h-3.5 w-3.5 text-[#3F70D8]" />
          Ask Amarktai
        </button>
      </header>
    );
  return (
    <header className="flex h-14 items-center justify-between border-b border-[#DCE2E9] bg-white px-2">
      <div className="flex items-center">
        <SidebarTrigger className="rounded-lg text-[#26354A] hover:bg-[#EEF2F5]" />
        <span className="ml-2 text-sm font-bold text-[#26354A]">Amarktai</span>
      </div>
      <button onClick={onAssistant} aria-label="Ask Amarktai" className="mr-2 text-[#3F70D8]">
        <Bot className="h-5 w-5" />
      </button>
    </header>
  );
}
