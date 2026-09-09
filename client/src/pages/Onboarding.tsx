import { BrandMark } from "@/components/BrandMark";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Globe2,
  Loader2,
  Mail,
  Network,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type Provider =
  | "genie"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "zoho"
  | "custom_browser";

type ProviderOption = {
  provider: Provider;
  label: string;
  url: string;
  method: "browser" | "oauth";
};

type MailboxStatus = {
  configured: boolean;
  connected: boolean;
  mailbox: null | {
    email: string;
    displayName?: string | null;
    status: string;
  };
};

const providers: ProviderOption[] = [
  {
    provider: "genie",
    label: "Genie",
    url: "https://genie.entrepreneurscircle.org/",
    method: "browser",
  },
  {
    provider: "hubspot",
    label: "HubSpot",
    url: "https://app.hubspot.com/",
    method: "oauth",
  },
  {
    provider: "salesforce",
    label: "Salesforce",
    url: "https://login.salesforce.com/",
    method: "oauth",
  },
  {
    provider: "pipedrive",
    label: "Pipedrive",
    url: "https://app.pipedrive.com/",
    method: "oauth",
  },
  {
    provider: "zoho",
    label: "Zoho CRM",
    url: "https://crm.zoho.com/",
    method: "oauth",
  },
  {
    provider: "custom_browser",
    label: "Other CRM",
    url: "",
    method: "browser",
  },
];

const allowedReadCapabilities = [
  "contacts.read",
  "companies.read",
  "opportunities.read",
  "tasks.read",
  "activities.read",
  "notes.read",
  "owners.read",
  "pipelines.read",
];
const allowedWriteCapabilities = [
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

function StepDot({
  number,
  label,
  state,
}: {
  number: number;
  label: string;
  state: "done" | "current" | "next";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black ${
          state === "done"
            ? "bg-emerald-100 text-emerald-700"
            : state === "current"
              ? "bg-[#2F6FED] text-white"
              : "bg-[#EEF2F7] text-[#8793A4]"
        }`}
      >
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : number}
      </span>
      <span
        className={`truncate text-xs font-bold ${
          state === "current" ? "text-[#26354A]" : "text-[#718096]"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function SetupVisual() {
  return (
    <section className="amk-auth__visual amk-auth__visual--product">
      <img src="/images/site-intelligence.svg" alt="AmarktAI sales workspace" />
      <div className="amk-auth__shade" />
      <div className="amk-auth__visual-inner">
        <div className="amk-auth__topline">
          <BrandMark inverse />
        </div>
        <div className="amk-auth__message">
          <p className="amk-auth__eyebrow">
            <ShieldCheck size={15} /> SET UP YOUR SALES WORKSPACE
          </p>
          <h1>
            A few steps now.
            <br />A simpler sales day after.
          </h1>
          <p>
            Tell AmarktAI about your business, connect the tools your team
            already uses, and then work from one clear daily sales workspace.
          </p>
          <div className="amk-auth__proof">
            <span>
              <CheckCircle2 size={16} /> Your business facts stay under your
              control
            </span>
            <span>
              <CheckCircle2 size={16} /> Connect the CRM you already use
            </span>
            <span>
              <CheckCircle2 size={16} /> Review important actions before they
              happen
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SetupShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <DashboardLayout>
      <main className="amk-auth amk-auth--setup fixed inset-0 z-[240] overflow-y-auto">
        <SetupVisual />
        <section className="amk-auth__form-side amk-auth__form-side--setup">
          <div className="amk-auth__mobile-brand">
            <BrandMark />
          </div>
          <div
            className={`amk-auth__form-wrap ${wide ? "amk-auth__form-wrap--wide" : "amk-auth__form-wrap--setup"}`}
          >
            {children}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}

export default function Onboarding() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const organisation = trpc.organisation.current.useQuery();
  const setup = trpc.companySetup.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const learning = trpc.companySetup.companyLearningStatus.useQuery(undefined, {
    retry: false,
    refetchInterval: 3_000,
  });
  const organisationId = organisation.data?.organisationId;
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId || 0 },
    { enabled: Boolean(organisationId), refetchInterval: 4_000 }
  );
  const saveProfile = trpc.companySetup.saveProfile.useMutation();
  const discover = trpc.companySetup.discoverWebsite.useMutation();
  const retryLearning = trpc.companySetup.retryWebsiteLearning.useMutation();
  const updateOnboarding = trpc.organisation.updateOnboarding.useMutation();
  const createConnection = trpc.connectedSystems.create.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation();

  const [workspaceMode, setWorkspaceMode] = useState<
    "individual" | "team" | null
  >(null);
  const [profile, setProfile] = useState({
    companyName: "",
    websiteUrl: "",
    industry: "",
    companySize: "",
    primaryMarket: "",
    salesMotion: "",
    productsServices: "",
    typicalCustomer: "",
    primarySalesObjective: "",
    brandVoice: "",
  });
  const [provider, setProvider] = useState<ProviderOption>(providers[0]);
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState("");
  const [mailboxStatus, setMailboxStatus] = useState<MailboxStatus | null>(
    null
  );

  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";

  useEffect(() => {
    const mode = organisation.data?.settings?.workspaceMode;
    if (mode === "individual" || mode === "team") setWorkspaceMode(mode);
  }, [organisation.data?.settings?.workspaceMode]);

  useEffect(() => {
    let cancelled = false;
    const loadMailbox = async () => {
      const response = await fetch("/api/mailbox", { credentials: "include" });
      if (!response.ok || cancelled) return;
      const body = (await response
        .json()
        .catch(() => null)) as MailboxStatus | null;
      if (body && !cancelled) setMailboxStatus(body);
    };
    void loadMailbox();
    const timer = window.setInterval(() => void loadMailbox(), 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const saved = setup.data?.profile;
    if (!saved) return;
    setProfile({
      companyName: saved.companyName,
      websiteUrl: saved.websiteUrl ?? "",
      industry: saved.industry ?? "",
      companySize: saved.companySize ?? "",
      primaryMarket: saved.primaryMarket ?? "",
      salesMotion: saved.salesMotion ?? "",
      productsServices: saved.productsServices ?? "",
      typicalCustomer: saved.typicalCustomer ?? "",
      primarySalesObjective: saved.primarySalesObjective ?? "",
      brandVoice: saved.brandVoice ?? "",
    });
  }, [setup.data?.profile]);

  const profileSaved = Boolean(setup.data?.profile);
  const knowledgeConfirmed =
    setup.data?.profile?.discoveryStatus === "confirmed";
  const connectedSystems = systems.data ?? [];
  const crmConnected = connectedSystems.length > 0;
  const mailboxConnected = Boolean(mailboxStatus?.connected);
  const learningRunning = ["queued", "running"].includes(
    learning.data?.status || ""
  );
  const learningNeedsAttention = ["needs_attention", "failed"].includes(
    learning.data?.status || ""
  );
  const learningProgress = (learning.data?.progress || {}) as {
    discoveredPages?: number;
    totalPagesKnown?: number;
    processedPages?: number;
    failedPages?: number;
    currentHost?: string;
    retryState?: string;
  };

  const step = useMemo(() => {
    if (!workspaceMode || !profileSaved) return 1;
    if (!knowledgeConfirmed) return 2;
    if (!mailboxConnected) return 3;
    if (!crmConnected) return 4;
    return 5;
  }, [
    workspaceMode,
    profileSaved,
    knowledgeConfirmed,
    mailboxConnected,
    crmConnected,
  ]);

  async function chooseMode(mode: "individual" | "team") {
    try {
      setError("");
      await updateOnboarding.mutateAsync({ workspaceMode: mode, step: 1 });
      setWorkspaceMode(mode);
      await utils.organisation.current.invalidate();
    } catch (cause) {
      setError(
        friendlyError(cause, "Your workspace choice could not be saved.")
      );
    }
  }

  async function saveBusiness() {
    if (!profile.companyName.trim()) return;
    try {
      setError("");
      await saveProfile.mutateAsync({
        ...profile,
        companyName: profile.companyName.trim(),
        websiteUrl: profile.websiteUrl.trim(),
      });
      await updateOnboarding.mutateAsync({ step: 2 });
      await Promise.all([
        utils.companySetup.get.invalidate(),
        utils.organisation.current.invalidate(),
      ]);
      toast.success("Business details saved.");
    } catch (cause) {
      setError(
        friendlyError(cause, "Your business details could not be saved.")
      );
    }
  }

  async function startLearning() {
    try {
      setError("");
      await discover.mutateAsync();
      await learning.refetch();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "AmarktAI couldn't read the website just now. Nothing was changed, so you can safely try again."
        )
      );
    }
  }

  async function retryCompanyLearning() {
    if (!learning.data?.id) return;
    try {
      setError("");
      await retryLearning.mutateAsync({ jobId: learning.data.id });
      await learning.refetch();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "AmarktAI couldn't continue reading the website. Please try again."
        )
      );
    }
  }

  async function connectCrm() {
    if (!organisationId) return;
    const startUrl =
      provider.provider === "custom_browser" ? customUrl.trim() : provider.url;
    try {
      const parsed = new URL(startUrl);
      if (parsed.protocol !== "https:") throw new Error("https required");
      setError("");
      const id = await createConnection.mutateAsync({
        organisationId,
        provider: provider.provider,
        displayName: provider.label,
        baseUrl: startUrl,
        connectionMethod: provider.method,
        allowedReadCapabilities,
        // Onboarding proves reads only. Writes require later explicit commissioning.
        allowedWriteCapabilities: [],
      });
      await systems.refetch();
      await updateOnboarding.mutateAsync({ step: 4 });
      if (provider.method === "oauth") {
        const result = await beginOAuth.mutateAsync({
          organisationId,
          connectedSystemId: id,
        });
        window.location.assign(result.authorizationUrl);
        return;
      }
      toast.success(
        `Open ${provider.label} and sign in directly inside your private CRM workspace.`
      );
      navigate(`/crm/${id}`);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          `${provider.label} could not be connected. Check the address and try again.`
        )
      );
    }
  }

  if (organisation.isLoading || setup.isLoading)
    return (
      <SetupShell>
        <div className="flex min-h-72 items-center justify-center gap-3 text-sm font-semibold text-[#66758A]">
          <Loader2 className="h-5 w-5 animate-spin text-[#2F6FED]" />
          Getting your workspace ready…
        </div>
      </SetupShell>
    );

  if (organisation.data && !canManage)
    return (
      <SetupShell>
        <Bot className="h-8 w-8 text-[#2F6FED]" />
        <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
          YOUR WORKSPACE
        </p>
        <h2 className="mt-2 text-4xl font-bold tracking-[-.05em] text-[#203047]">
          Your company is already set up.
        </h2>
        <p className="mt-4 text-sm leading-7 text-[#607086]">
          The shared business information and CRM are already connected for your
          team. You only need your own salesperson match and mailbox so AmarktAI
          can show the right customers and follow-ups to you.
        </p>
        <Button className="mt-7" onClick={() => navigate("/assistant")}>
          Continue to my workspace <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </SetupShell>
    );

  const labels = ["Business", "Learn", "Outlook", "CRM", "Ready"];

  return (
    <SetupShell wide>
      <div className="border-b border-[#C9D3DF] pb-5">
        <p className="amk-auth__panel-eyebrow">COMPANY SETUP</p>
        <h2 className="!text-[clamp(34px,3vw,46px)]">
          Set up AmarktAI for your business.
        </h2>
        <p className="amk-auth__muted !mt-3">
          We’ll guide you through the basics, learn from your public website and
          connect the CRM your team already uses. You can review everything as
          you go.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          {labels.map((label, index) => (
            <StepDot
              key={label}
              number={index + 1}
              label={label}
              state={
                index + 1 < step
                  ? "done"
                  : index + 1 === step
                    ? "current"
                    : "next"
              }
            />
          ))}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="mt-7">
          {!workspaceMode ? (
            <>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
                STEP 1 · WHO IS USING AMARKTAI?
              </p>
              <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
                Who are we setting this up for?
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#607086]">
                Start with yourself or set up the whole sales team. You can add
                more people later.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={updateOnboarding.isPending}
                  onClick={() => void chooseMode("individual")}
                  className="rounded-2xl border border-[#C9D3DF] bg-[#F7F9FC] p-5 text-left transition hover:border-[#8EACEB] hover:bg-white"
                >
                  <Building2 className="h-5 w-5 text-[#2F6FED]" />
                  <p className="mt-4 font-bold">One salesperson</p>
                  <p className="mt-2 text-sm leading-6 text-[#65768B]">
                    A personal daily sales workspace for one person.
                  </p>
                </button>
                <button
                  type="button"
                  disabled={updateOnboarding.isPending}
                  onClick={() => void chooseMode("team")}
                  className="rounded-2xl border border-[#C9D3DF] bg-[#F7F9FC] p-5 text-left transition hover:border-[#8EACEB] hover:bg-white"
                >
                  <Users className="h-5 w-5 text-[#2F6FED]" />
                  <p className="mt-4 font-bold">A sales team</p>
                  <p className="mt-2 text-sm leading-6 text-[#65768B]">
                    Shared company information with a private workspace for each
                    salesperson.
                  </p>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
                STEP 1 · YOUR BUSINESS
              </p>
              <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
                Tell us about your business.
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
                Start with the essentials. If you add your website, AmarktAI can
                read the public pages in the next step and show you what it
                found before any information becomes trusted knowledge.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Input
                  value={profile.companyName}
                  onChange={event =>
                    setProfile(current => ({
                      ...current,
                      companyName: event.target.value,
                    }))
                  }
                  placeholder="Company name"
                  aria-label="Company name"
                />
                <Input
                  value={profile.websiteUrl}
                  onChange={event =>
                    setProfile(current => ({
                      ...current,
                      websiteUrl: event.target.value,
                    }))
                  }
                  placeholder="https://yourcompany.com"
                  aria-label="Company website"
                />
                <Input
                  value={profile.industry}
                  onChange={event =>
                    setProfile(current => ({
                      ...current,
                      industry: event.target.value,
                    }))
                  }
                  placeholder="Industry (optional)"
                  aria-label="Industry"
                />
                <Input
                  value={profile.primarySalesObjective}
                  onChange={event =>
                    setProfile(current => ({
                      ...current,
                      primarySalesObjective: event.target.value,
                    }))
                  }
                  placeholder="Main sales goal (optional)"
                  aria-label="Main sales goal"
                />
              </div>
              <Textarea
                value={profile.productsServices}
                onChange={event =>
                  setProfile(current => ({
                    ...current,
                    productsServices: event.target.value,
                  }))
                }
                placeholder="Anything important about what you sell? (optional)"
                className="mt-4 min-h-24"
              />
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  disabled={
                    !profile.companyName.trim() || saveProfile.isPending
                  }
                  onClick={() => void saveBusiness()}
                >
                  {saveProfile.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save and continue
                </Button>
                <Button variant="ghost" onClick={() => setWorkspaceMode(null)}>
                  Change who this is for
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 2 · LEARN
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Let AmarktAI learn your public website.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            AmarktAI will read the public pages you’ve authorised and turn them
            into a clear business summary.{" "}
            {"Nothing becomes trusted company knowledge until you confirm it."}
          </p>

          {learningRunning ? (
            <div className="mt-6 rounded-2xl border border-[#CAD8EA] bg-[#F4F7FB] p-5">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#2F6FED]" />
                <div>
                  <p className="font-bold">
                    {learning.data?.humanStatus || "Reading your website"}
                  </p>
                  <p className="mt-1 text-sm text-[#718096]">
                    You can leave this page and come back. Your progress is
                    saved.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#D5E0EE] bg-white px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#718096]">
                    Authorised pages found
                  </p>
                  <p className="mt-1 text-lg font-bold text-[#26354A]">
                    {learningProgress.discoveredPages ?? "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-[#D5E0EE] bg-white px-3 py-2 sm:col-span-2">
                  <p className="text-[10px] font-black uppercase tracking-[.1em] text-[#718096]">
                    Reading progress
                  </p>
                  <p className="mt-1 text-sm font-bold text-[#26354A]">
                    {typeof learningProgress.processedPages === "number" &&
                    typeof learningProgress.totalPagesKnown === "number"
                      ? `${learningProgress.processedPages} of ${learningProgress.totalPagesKnown} pages processed`
                      : "Preparing the authorised page list…"}
                  </p>
                  {learningProgress.currentHost ? (
                    <p className="mt-1 truncate text-xs text-[#718096]">
                      Reading {learningProgress.currentHost}
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="mt-4 text-xs leading-5 text-[#66758A]">
                Larger websites can take several minutes because AmarktAI reads
                the authorised pages, removes duplicates and checks important
                facts before asking you to approve them. No percentage or finish
                time is guessed.
              </p>
            </div>
          ) : learningNeedsAttention ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="font-bold text-amber-900">
                Website learning paused before it finished.
              </p>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                Nothing new was trusted. Nothing was added. Continue from where
                it stopped.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void retryCompanyLearning()}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Continue reading
              </Button>
            </div>
          ) : (
            <Button
              className="mt-6"
              disabled={!profile.websiteUrl.trim() || discover.isPending}
              onClick={() => void startLearning()}
            >
              {discover.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Globe2 className="mr-2 h-4 w-4" />
              )}
              Read my website
            </Button>
          )}
          {!profile.websiteUrl.trim() ? (
            <p className="mt-3 text-xs text-amber-700">
              Add your company website in the previous step first.
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 3 · YOUR OUTLOOK MAILBOX
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Connect the mailbox you already use for sales.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            Connect Microsoft Outlook with the existing secure sign-in. AmarktAI
            uses your own mailbox for customer context and reviewed follow-ups;
            connecting it does not send anything.
          </p>
          {mailboxStatus?.configured === false ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Microsoft mailbox connection is not configured on this
              installation yet.
            </div>
          ) : null}
          <Button
            className="mt-5"
            disabled={mailboxStatus?.configured === false}
            onClick={() =>
              window.location.assign("/api/mailbox/microsoft/start")
            }
          >
            <Mail className="mr-2 h-4 w-4" /> Connect Outlook
          </Button>
          {mailboxStatus?.connected && mailboxStatus.mailbox ? (
            <p className="mt-3 text-sm font-semibold text-emerald-700">
              Connected as {mailboxStatus.mailbox.email}
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#35516F]">
            STEP 4 · YOUR CRM
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Connect the CRM your team already uses.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            Choose your CRM below. You’ll sign in with the CRM itself, and
            AmarktAI will use that connection to bring your customers, tasks and
            opportunities into the daily workspace.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map(option => (
              <button
                key={option.provider}
                type="button"
                onClick={() => {
                  setProvider(option);
                  setError("");
                }}
                className={`rounded-2xl border p-4 text-left transition ${
                  provider.provider === option.provider
                    ? "border-[#2F6FED] bg-white shadow-sm"
                    : "border-[#C9D3DF] bg-[#F7F9FC] hover:border-[#AFC3E8] hover:bg-white"
                }`}
              >
                <p className="font-bold">{option.label}</p>
                <p className="mt-1 text-xs text-[#718096]">
                  {option.method === "browser"
                    ? "Secure CRM workspace"
                    : "Connect your account securely"}
                </p>
              </button>
            ))}
          </div>
          {provider.provider === "custom_browser" ? (
            <Input
              value={customUrl}
              onChange={event => setCustomUrl(event.target.value)}
              placeholder="https://crm.yourcompany.com"
              aria-label="CRM address"
              className="mt-4 max-w-xl"
            />
          ) : null}
          <Button
            className="mt-5"
            disabled={
              createConnection.isPending ||
              beginOAuth.isPending ||
              (provider.provider === "custom_browser" && !customUrl.trim())
            }
            onClick={() => void connectCrm()}
          >
            {createConnection.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Network className="mr-2 h-4 w-4" />
            )}
            Connect {provider.label}
          </Button>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
            STEP 5 · FINISH SETUP
          </p>
          <h3 className="mt-2 text-3xl font-bold tracking-[-.04em] text-[#203047]">
            Sign in to your CRM and finish the connection.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#607086]">
            Open the private CRM workspace and sign in directly with your CRM.
            AmarktAI will then check that customers, tasks and opportunities
            come through before the workspace is called ready.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Business", "Ready"],
              ["CRM", connectedSystems[0]?.displayName || "Connected"],
              ["Workspace", "Final connection check"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-[#C9D3DF] bg-[#F7F9FC] p-4"
              >
                <p className="text-xs font-bold text-[#8290A3]">{label}</p>
                <p className="mt-1 font-bold text-[#26354A]">{value}</p>
              </div>
            ))}
          </div>
          <Button
            className="mt-6"
            onClick={() => navigate(`/crm/${connectedSystems[0]?.id}`)}
          >
            <Network className="mr-2 h-4 w-4" />
            Open {connectedSystems[0]?.displayName || "CRM"} and finish setup
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      ) : null}
    </SetupShell>
  );
}
