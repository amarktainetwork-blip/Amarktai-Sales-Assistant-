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
      <img
        src="/images/site-intelligence.svg"
        alt="AmarktAI sales workspace illustration"
      />
      <div className="amk-auth__shade" />
      <div className="amk-auth__visual-inner">
        <div className="amk-auth__topline">
          <BrandMark inverse />
        </div>
        <div className="amk-auth__message">
          <p className="amk-auth__eyebrow">
            <ShieldCheck size={15} /> SECURE COMPANY SETUP
          </p>
          <h1>
            Set it up once.
            <br />
            Work here every day.
          </h1>
          <p>
            AmarktAI learns the approved business context, connects to the CRM
            you already use and keeps important customer actions reviewable.
          </p>
          <div className="amk-auth__proof">
            <span>
              <CheckCircle2 size={16} /> CRM remains the system of record
            </span>
            <span>
              <CheckCircle2 size={16} /> Company knowledge is approved first
            </span>
            <span>
              <CheckCircle2 size={16} /> Daily sales work happens in AmarktAI
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

  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";

  useEffect(() => {
    const mode = organisation.data?.settings?.workspaceMode;
    if (mode === "individual" || mode === "team") setWorkspaceMode(mode);
  }, [organisation.data?.settings?.workspaceMode]);

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
  const learningRunning = ["queued", "running"].includes(
    learning.data?.status || ""
  );
  const learningNeedsAttention = ["needs_attention", "failed"].includes(
    learning.data?.status || ""
  );

  const step = useMemo(() => {
    if (!workspaceMode || !profileSaved) return 1;
    if (!knowledgeConfirmed) return 2;
    if (!crmConnected) return 3;
    return 4;
  }, [workspaceMode, profileSaved, knowledgeConfirmed, crmConnected]);

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
          "AmarktAI couldn't start learning from the website. Nothing was approved or changed."
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
          "Company learning could not resume. Please try again."
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
        allowedWriteCapabilities,
      });
      await systems.refetch();
      await updateOnboarding.mutateAsync({ step: 3 });
      if (provider.method === "oauth") {
        const result = await beginOAuth.mutateAsync({
          organisationId,
          connectedSystemId: id,
        });
        window.location.assign(result.authorizationUrl);
        return;
      }
      toast.success(
        "CRM added. Sign in directly inside your private CRM workspace."
      );
      navigate(`/crm/${id}`);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "The CRM could not be connected. Please try again."
        )
      );
    }
  }

  if (organisation.isLoading || setup.isLoading)
    return (
      <SetupShell>
        <div className="flex min-h-72 items-center justify-center gap-3 text-sm font-semibold text-[#66758A]">
          <Loader2 className="h-5 w-5 animate-spin text-[#2F6FED]" />
          Preparing your setup…
        </div>
      </SetupShell>
    );

  if (organisation.data && !canManage)
    return (
      <SetupShell>
        <Bot className="h-8 w-8 text-[#2F6FED]" />
        <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
          YOUR PERSONAL WORKSPACE
        </p>
        <h2 className="mt-2 text-4xl font-bold tracking-[-.05em] text-[#203047]">
          Your company setup is already handled.
        </h2>
        <p className="mt-4 text-sm leading-7 text-[#607086]">
          Shared company knowledge and the CRM are managed once for the team.
          Your own AmarktAI identity, CRM mapping and mailbox stay personal to
          you.
        </p>
        <Button className="mt-7" onClick={() => navigate("/assistant")}>
          Open AmarktAI <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </SetupShell>
    );

  const labels = ["Business", "Learn", "CRM", "Ready"];

  return (
    <SetupShell wide>
      <div className="border-b border-[#E5EAF0] pb-5">
        <p className="amk-auth__panel-eyebrow">COMPANY SETUP</p>
        <h2 className="!text-[clamp(34px,3vw,46px)]">
          Get AmarktAI ready for the sales day.
        </h2>
        <p className="amk-auth__muted !mt-3">
          Complete the company setup once. Your CRM remains the system of record;
          AmarktAI becomes the daily workspace for preparation, calls, follow-up
          and review.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
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
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                STEP 1 · WORKSPACE
              </p>
              <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
                Who will use this workspace?
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#607086]">
                Choose the shape of the workspace. You can still add team members
                later if you start with one salesperson.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={updateOnboarding.isPending}
                  onClick={() => void chooseMode("individual")}
                  className="rounded-2xl border border-[#DCE4EE] bg-[#FAFCFF] p-5 text-left transition hover:border-[#8EACEB] hover:bg-[#F3F7FF]"
                >
                  <Building2 className="h-5 w-5 text-[#2F6FED]" />
                  <p className="mt-4 font-bold">Just me</p>
                  <p className="mt-2 text-sm leading-6 text-[#718096]">
                    One salesperson with a personal daily sales workspace.
                  </p>
                </button>
                <button
                  type="button"
                  disabled={updateOnboarding.isPending}
                  onClick={() => void chooseMode("team")}
                  className="rounded-2xl border border-[#DCE4EE] bg-[#FAFCFF] p-5 text-left transition hover:border-[#8EACEB] hover:bg-[#F3F7FF]"
                >
                  <Users className="h-5 w-5 text-[#2F6FED]" />
                  <p className="mt-4 font-bold">My sales team</p>
                  <p className="mt-2 text-sm leading-6 text-[#718096]">
                    Shared approved company knowledge with private salesperson
                    workspaces.
                  </p>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                STEP 1 · BUSINESS
              </p>
              <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
                Tell AmarktAI which business it is working for.
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
                Start with the essentials. The next step reads the authorised
                public website and shows you exactly what it learned before any
                information becomes trusted knowledge.
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
                  disabled={!profile.companyName.trim() || saveProfile.isPending}
                  onClick={() => void saveBusiness()}
                >
                  {saveProfile.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save and continue
                </Button>
                <Button variant="ghost" onClick={() => setWorkspaceMode(null)}>
                  Change workspace type
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
            STEP 2 · LEARN
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Let AmarktAI learn the public business context.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            AmarktAI reads the authorised public company website, organises the
            useful facts and then gives you a review. Nothing becomes trusted
            company knowledge until you confirm it.
          </p>

          {learningRunning ? (
            <div className="mt-6 rounded-2xl border border-blue-100 bg-[#F4F8FF] p-5">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#2F6FED]" />
                <div>
                  <p className="font-bold">
                    {learning.data?.humanStatus || "Reading website"}
                  </p>
                  <p className="mt-1 text-sm text-[#718096]">
                    Progress is saved automatically. You can safely leave and
                    return to this setup.
                  </p>
                </div>
              </div>
            </div>
          ) : learningNeedsAttention ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="font-bold text-amber-900">
                Website learning paused before it finished.
              </p>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                Nothing new was trusted. Resume from the saved progress.
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void retryCompanyLearning()}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Resume
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
              Learn from website
            </Button>
          )}
          {!profile.websiteUrl.trim() ? (
            <p className="mt-3 text-xs text-amber-700">
              Add the company website in the previous step before starting.
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
            STEP 3 · CRM
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-.035em] text-[#203047]">
            Connect the CRM your team already uses.
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607086]">
            The CRM stays your system of record. AmarktAI uses the authorised
            connection to bring customers, tasks and opportunities into the
            daily workspace. Browser-based CRM passwords are entered only inside
            the private CRM session.
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
                    ? "border-[#2F6FED] bg-[#F3F7FF]"
                    : "border-[#DCE4EE] bg-[#FAFCFF] hover:border-[#AFC3E8]"
                }`}
              >
                <p className="font-bold">{option.label}</p>
                <p className="mt-1 text-xs text-[#718096]">
                  {option.method === "browser"
                    ? "Secure CRM workspace"
                    : "Secure account connection"}
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

      {step === 4 ? (
        <section className="mt-7">
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">
            STEP 4 · PROVE THE CONNECTION
          </p>
          <h3 className="mt-2 text-3xl font-bold tracking-[-.04em] text-[#203047]">
            Sign in to your CRM and let AmarktAI prove safe access.
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#607086]">
            Open the private CRM workspace and sign in directly. Setup is not
            complete just because authentication succeeds: AmarktAI must still
            prove the required CRM reads and governed write operations before
            the daily workspace is called ready.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Business", "Approved"],
              ["CRM", connectedSystems[0]?.displayName || "Connected"],
              ["Daily workspace", "Ready after live proof"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-[#E1E7EF] bg-[#FAFCFF] p-4"
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
            Open CRM and continue setup
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      ) : null}
    </SetupShell>
  );
}
