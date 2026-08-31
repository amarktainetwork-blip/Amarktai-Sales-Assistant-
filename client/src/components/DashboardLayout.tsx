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
  LibraryBig,
  MonitorUp,
  LockKeyhole,
  LogOut,
  MailCheck,
  Settings2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
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

const primaryMenu: NavItem[] = [
  { icon: CalendarDays, label: "Today", path: "/today" },
  { icon: ContactRound, label: "Customers", path: "/customers" },
  { icon: Bot, label: "Assistant", path: "/agents" },
  { icon: Headphones, label: "Calls", path: "/calls" },
  { icon: MonitorUp, label: "CRM", path: "/crm" },
];
const individualSecondaryMenu: NavItem[] = [
  { icon: LibraryBig, label: "Knowledge", path: "/knowledge" },
  { icon: Cable, label: "Connections", path: "/connections" },
  { icon: Settings2, label: "Settings", path: "/company-setup" },
];
const teamSecondaryMenu: NavItem[] = [
  { icon: LayoutDashboard, label: "Team intelligence", path: "/team" },
  { icon: Users, label: "Team members", path: "/team/manage" },
  { icon: LibraryBig, label: "Knowledge", path: "/knowledge" },
  { icon: Cable, label: "Connections", path: "/connections" },
  { icon: Settings2, label: "Settings", path: "/company-setup" },
];

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
  const utils = trpc.useUtils();
  const switchOrganisation = trpc.organisation.switch.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.organisation.current.invalidate(),
        utils.organisation.available.invalidate(),
      ]);
      window.location.reload();
    },
    onError: error => toast.error(error.message),
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
  const onboardingComplete = onboarding?.complete === true;
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager" ||
    user?.role === "admin";
  const requiresSalespersonIdentity =
    organisation.data?.role === "salesperson" &&
    !canManage &&
    onboardingComplete;

  useEffect(() => {
    if (!requiresSalespersonIdentity) return;
    fetch("/api/team/crm-identity", { credentials: "include" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "CRM identity could not be loaded.");
        setCrmIdentity(body as CrmIdentity);
      })
      .catch(error => {
        console.error("[salesperson-onboarding] identity lookup failed", error);
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
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "CRM identity could not be confirmed.");
      setCrmIdentity({ mapped: true, candidates: [] });
      toast.success("CRM identity confirmed. Your sales workspace is ready.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "CRM identity could not be confirmed."
      );
    } finally {
      setIdentityPending(false);
    }
  }

  const secondaryMenu =
    workspaceMode === "team" && canManage
      ? teamSecondaryMenu
      : individualSecondaryMenu;

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
        onSelect={organisationId =>
          switchOrganisation.mutate({ organisationId })
        }
      />
    );
  if ((!workspaceMode || !onboardingComplete) && !canManage)
    return <WorkspaceSetupPending />;
  if (
    (!workspaceMode || !onboardingComplete) &&
    !canManage &&
    location !== "/company-setup"
  )
    return <SetupGate onContinue={() => navigate("/company-setup")} />;
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
    <>
      <SidebarProvider>
        <Sidebar
          collapsible="icon"
          className="border-r border-[#52677F] bg-[#3A4D66] text-white"
        >
          <SidebarHeader className="h-[98px] justify-center border-b border-white/15 px-5">
            <BrandMark inverse />
          </SidebarHeader>
          <SidebarContent className="px-3 py-5">
            <OrganisationSwitcher
              currentName={organisation.data?.organisationName}
              organisations={organisations.data ?? []}
              pending={switchOrganisation.isPending}
              onSelect={organisationId =>
                switchOrganisation.mutate({ organisationId })
              }
            />
            <p className="px-3 pb-2 pt-6 text-[9px] font-black uppercase tracking-[.15em] text-[#C4D0DD]">
              Daily work
            </p>
            <SidebarMenu>
              {primaryMenu.map(item => (
                <AppNavItem key={item.path} {...item} />
              ))}
            </SidebarMenu>
            <p className="px-3 pb-2 pt-6 text-[9px] font-black uppercase tracking-[.15em] text-[#C4D0DD]">
              Manage
            </p>
            <SidebarMenu>
              {secondaryMenu.map(item => (
                <AppNavItem key={item.path} {...item} />
              ))}
            </SidebarMenu>
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
                      {user.email || "Authenticated workspace"}
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
          <AppTopbar />
          <main className="min-h-[calc(100vh-66px)] p-4 sm:p-6 lg:p-8">
            {canManage && (!workspaceMode || !onboardingComplete) ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D5DFEB] bg-white px-4 py-3 text-sm text-[#33445B]">
                <span>
                  <strong>Setup is still in progress.</strong> Continue the
                  guided setup when you are ready.
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
    </>
  );
}

function SetupGate({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-[1.5rem] border border-[#DCE2E9] bg-white p-8 shadow-[0_20px_55px_rgba(45,61,82,.1)] sm:p-10">
        <BrandMark />
        <div className="mt-12 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Settings2 size={23} />
        </div>
        <p className="mt-7 text-xs font-black uppercase tracking-[.16em] text-[#3F70D8]">
          Complete setup
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.065em]">
          Connect, discover, test—then sell.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          Choose an individual or company experience, confirm business
          knowledge, connect the CRM, and pass the friendly readiness check.
          Your progress is saved.
        </p>
        <Button
          onClick={onContinue}
          className="mt-8 h-12 w-full rounded-xl bg-[#3F70D8] font-bold hover:bg-[#315BB6]"
        >
          Continue guided setup
        </Button>
      </div>
    </div>
  );
}

function WorkspaceSetupPending() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-xl rounded-[1.5rem] border border-[#DCE2E9] bg-white p-8 shadow-[0_20px_55px_rgba(45,61,82,.1)] sm:p-10">
        <BrandMark />
        <div className="mt-12 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Building2 size={23} />
        </div>
        <p className="mt-7 text-xs font-black uppercase tracking-[.16em] text-[#3F70D8]">
          Team workspace
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.065em]">
          Your manager is finishing company setup.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          You will inherit the approved knowledge, CRM connection, available
          functions and policies. You will not need to scan the website,
          reconnect the CRM or repeat company-wide tests.
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
      <div className="w-full max-w-xl rounded-[1.5rem] border border-[#DCE2E9] bg-white p-8 shadow-[0_20px_55px_rgba(45,61,82,.1)] sm:p-10">
        <BrandMark />
        <div className="mt-12 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <ContactRound size={23} />
        </div>
        <p className="mt-7 text-xs font-black uppercase tracking-[.16em] text-[#3F70D8]">
          Your sales identity
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.065em]">
          Confirm who you are in the CRM.
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          Your company knowledge, CRM connection and policies are already set
          up. Confirm your matching salesperson identity; you will not repeat
          company onboarding.
        </p>
        {candidates.length ? (
          <div className="mt-7 grid gap-3">
            {candidates.map(candidate => (
              <button
                key={candidate.id}
                disabled={pending}
                onClick={() => onConfirm(candidate.id)}
                className="rounded-xl border border-[#DCE2E9] bg-[#F8FAFC] p-4 text-left transition hover:border-[#8EACEB] hover:bg-[#EDF3FF]"
              >
                <p className="font-bold text-[#26354A]">
                  We found {candidate.displayName} in your CRM. Is this you?
                </p>
                <p className="mt-1 text-xs text-[#6C798B]">
                  {candidate.email || "Matched CRM salesperson"}
                </p>
                <span className="mt-3 inline-block text-sm font-bold text-[#3F70D8]">
                  Yes, that's me
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-7 rounded-xl border border-[#E8D5A8] bg-[#FBF3DF] p-4 text-sm leading-6 text-[#7B5A22]">
            No exact CRM identity match is available yet. Ask your workspace
            manager to link your CRM salesperson record; you do not need to
            reconnect the CRM or repeat company setup.
          </p>
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="w-full max-w-md rounded-[1.5rem] border border-[#DCE2E9] bg-white p-8 shadow-[0_20px_55px_rgba(45,61,82,.1)]">
        <BrandMark />
        <div className="mb-5 mt-11 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Bot size={23} />
        </div>
        <p className="mb-2 text-xs font-black uppercase tracking-[.16em] text-[#3F70D8]">
          Protected workspace
        </p>
        <h1 className="font-display text-4xl font-bold tracking-[-.065em]">
          A clear view of the sales day.
        </h1>
        <p className="mt-4 leading-6 text-[#6C798B]">
          Sign in to open your sales dashboard, prepare work, review decisions
          and connect the team’s CRM.
        </p>
        <Button
          onClick={() => startLogin()}
          className="mt-8 h-12 w-full rounded-xl bg-[#3F70D8] font-bold text-white hover:bg-[#315BB6]"
        >
          Open secure access
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
  const [feedback, setFeedback] = useState<"send" | "verify" | null>(null);
  const [feedbackDetail, setFeedbackDetail] = useState("");
  const status = trpc.security.status.useQuery();
  const requestCode = trpc.security.requestEmailCode.useMutation({
    onSuccess: () => {
      setRequested(true);
      setFeedback(null);
      toast.success("A verification code was sent to your email.");
    },
    onError: error => {
      setFeedback("send");
      setFeedbackDetail(error.message);
    },
  });
  const verifyCode = trpc.security.verifyEmailCode.useMutation({
    onSuccess: () => {
      setFeedback(null);
      toast.success("Access verification complete.");
      status.refetch();
      window.location.assign("/dashboard");
    },
    onError: error => {
      setFeedback("verify");
      setFeedbackDetail(error.message);
    },
  });
  return (
    <div className="grid min-h-screen place-items-center bg-[#F5F7FA] p-5 text-[#26354A]">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[1.5rem] border border-[#DCE2E9] bg-white shadow-[0_20px_60px_rgba(45,61,82,.12)] lg:grid-cols-[.9fr_1.1fr]">
        <section className="bg-[#EEF4FB] p-8 sm:p-10">
          <BrandMark />
          <div className="mt-16 grid size-12 place-items-center rounded-2xl bg-[#DDE9FB] text-[#315BB6]">
            <LockKeyhole size={21} />
          </div>
          <p className="mt-7 text-xs font-black uppercase tracking-[.15em] text-[#3F70D8]">
            Access verification
          </p>
          <h1 className="mt-3 font-display text-5xl font-bold leading-[.88] tracking-[-.075em]">
            Protect the work that matters.
          </h1>
          <p className="mt-5 text-sm leading-6 text-[#6C798B]">
            Verify your email before Amarktai can show customer context, team
            performance or external actions.
          </p>
          <div className="mt-8 space-y-3 text-sm text-[#516178]">
            <p className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3F70D8]" />
              Codes expire after ten minutes.
            </p>
            <p className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#3F70D8]" />
              Verification persists for twelve hours.
            </p>
          </div>
        </section>
        <section className="p-8 sm:p-10">
          <div className="grid size-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
            <MailCheck size={20} />
          </div>
          <h2 className="mt-6 font-display text-4xl font-bold leading-[.9] tracking-[-.07em]">
            Confirm access.
          </h2>
          {feedback ? (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-[#E5B9C0] bg-[#FAECEF] p-4 text-sm text-[#923F4B]"
            >
              <p className="font-bold">
                {feedback === "send"
                  ? "The verification email could not be sent."
                  : "That verification code was not accepted."}
              </p>
              <p className="mt-1 leading-5">
                {feedbackDetail}{" "}
                {feedback === "send"
                  ? "Check email delivery and try again."
                  : "Check the six digits or request a new code."}
              </p>
              <Button
                size="sm"
                onClick={() =>
                  feedback === "send"
                    ? requestCode.mutate()
                    : verifyCode.mutate({ code })
                }
                className="mt-3 bg-[#3F70D8]"
              >
                Retry
              </Button>
            </div>
          ) : null}
          {!hasEmail ? (
            <Notice text="This account has no configured email address. Add the administrator email before enabling access verification." />
          ) : !smtpReady ? (
            <Notice text="SMTP is not configured yet. Add the SMTP settings before sending access codes." />
          ) : !requested ? (
            <>
              <p className="mt-4 text-sm leading-6 text-[#6C798B]">
                We will send a six-digit code to the authenticated email
                address.
              </p>
              <Button
                onClick={() => requestCode.mutate()}
                disabled={requestCode.isPending}
                className="mt-8 h-12 w-full rounded-xl bg-[#3F70D8] font-bold hover:bg-[#315BB6]"
              >
                {requestCode.isPending
                  ? "Sending code…"
                  : "Send verification code"}
              </Button>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm leading-6 text-[#6C798B]">
                Enter the code sent to your email.
              </p>
              <input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={event =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                placeholder="000000"
                className="mt-6 h-14 w-full rounded-xl border-2 border-[#D5DDE7] bg-white text-center font-display text-3xl font-bold tracking-[.32em] text-[#26354A] outline-none placeholder:text-[#A7B0BC] focus:border-[#6F91E2]"
              />
              <Button
                onClick={() => verifyCode.mutate({ code })}
                disabled={code.length !== 6 || verifyCode.isPending}
                className="mt-4 h-12 w-full rounded-xl bg-[#3F70D8] font-bold hover:bg-[#315BB6]"
              >
                {verifyCode.isPending
                  ? "Verifying…"
                  : "Verify and open dashboard"}
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
          {currentName || "Loading workspace"}
        </p>
        <p className="mt-0.5 text-[9px] font-black uppercase tracking-[.12em] text-[#CFD8E3]">
          Active organisation
        </p>
      </div>
    );
  return (
    <label className="block rounded-lg border border-white/15 bg-white/10 px-3 py-2">
      <span className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[.12em] text-[#D7E0EA]">
        <Building2 size={13} />
        Active organisation
      </span>
      <select
        aria-label="Active organisation"
        disabled={pending}
        value={
          organisations.find(
            organisation => organisation.organisationName === currentName
          )?.organisationId ?? ""
        }
        onChange={event => onSelect(Number(event.target.value))}
        className="mt-1 w-full bg-transparent text-sm font-bold text-white outline-none"
      >
        <option value="" disabled>
          Select workspace
        </option>
        {organisations.map(organisation => (
          <option
            key={organisation.organisationId}
            value={organisation.organisationId}
            className="bg-[#3A4D66]"
          >
            {organisation.organisationName}
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
      <div className="w-full max-w-xl rounded-[1.5rem] border border-[#DCE2E9] bg-white p-8 shadow-[0_20px_55px_rgba(45,61,82,.1)] sm:p-10">
        <BrandMark />
        <div className="mt-12 grid size-12 place-items-center rounded-2xl bg-[#EDF3FF] text-[#315BB6]">
          <Building2 size={23} />
        </div>
        <p className="mt-7 text-xs font-black uppercase tracking-[.16em] text-[#3F70D8]">
          Choose workspace
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.065em]">
          Which organisation are you working in?
        </h1>
        <p className="mt-4 text-sm leading-6 text-[#6C798B]">
          Amarktai keeps sales data, connected systems, and reviews separated by
          organisation. Select an authorised workspace to continue.
        </p>
        <div className="mt-7 grid gap-3">
          {organisations.map(organisation => (
            <button
              key={organisation.organisationId}
              disabled={pending}
              onClick={() => onSelect(organisation.organisationId)}
              className="flex items-center justify-between rounded-xl border border-[#DCE2E9] bg-[#F8FAFC] px-4 py-4 text-left font-bold text-[#26354A] transition hover:border-[#8EACEB] hover:bg-[#EDF3FF]"
            >
              <span>{organisation.organisationName}</span>
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
        className={`h-11 rounded-lg px-3 transition-all hover:bg-[#465C77] hover:text-white ${active ? "bg-[#F7F9FB] text-[#26354A] hover:bg-[#F7F9FB]" : "text-[#E1E7EE]"}`}
      >
        <Icon className="size-[18px]" />
        <span className="font-semibold group-data-[collapsible=icon]:hidden">
          {label}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppTopbar() {
  const isMobile = useIsMobile();
  if (!isMobile)
    return (
      <header className="flex h-[66px] items-center justify-between border-b border-[#DCE2E9] bg-white/95 px-8 backdrop-blur">
        <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#748196]">
          Amarktai / Sales workspace
        </p>
        <div className="flex items-center gap-2 rounded-full border border-[#D5DFEB] bg-[#F3F6FA] px-3 py-1.5 text-xs font-bold text-[#5A6A80]">
          <span className="size-1.5 rounded-full bg-[#438F91]" />
          Governed automation ready
        </div>
      </header>
    );
  return (
    <header className="flex h-14 items-center border-b border-[#DCE2E9] bg-white px-2">
      <SidebarTrigger className="rounded-lg text-[#26354A] hover:bg-[#EEF2F5]" />
      <span className="ml-2 text-sm font-bold text-[#26354A]">Amarktai</span>
    </header>
  );
}
