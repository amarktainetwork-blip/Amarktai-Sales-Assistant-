import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { friendlyError } from "@/lib/friendlyError";
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
              ? "bg-[#3F70D8] text-white"
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
          "Amarktai couldn't start learning from the website. Nothing was approved or changed."
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
      <DashboardLayout>
        <div className="grid min-h-[55vh] place-items-center text-[#66758A]">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Loader2 className="h-5 w-5 animate-spin text-[#3F70D8]" />
            Preparing your setup…
          </div>
        </div>
      </DashboardLayout>
    );

  if (organisation.data && !canManage)
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl rounded-3xl border border-[#DCE4EE] bg-white p-7 text-[#26354A] shadow-sm sm:p-9">
          <Bot className="h-8 w-8 text-[#3F70D8]" />
          <h1 className="mt-5 font-display text-4xl font-bold tracking-[-.06em]">
            Your workspace is ready for you.
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#66758A]">
            Your company has already set up the shared business knowledge and
            CRM. You only need your own Amarktai account and, when required,
            your own CRM sign-in.
          </p>
          <Button className="mt-6" onClick={() => navigate("/assistant")}>
            Open Assistant <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </DashboardLayout>
    );

  const labels = ["Business", "Learn", "CRM", "Assistant"];

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl text-[#26354A]">
        <header className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#3F70D8]">
            Setup
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">
            Get Amarktai ready for your sales team.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66758A]">
            Four simple steps. Amarktai handles the technical checks in the
            background so your team can focus on customers.
          </p>
          <div className="mt-6 grid gap-3 border-t border-[#EEF2F6] pt-5 sm:grid-cols-4">
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
        </header>

        {error ? (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {error}
          </div>
        ) : null}

        {step === 1 ? (
          <section className="mt-6 rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
            {!workspaceMode ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#3F70D8]">
                    <Users className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[.12em] text-[#8290A3]">
                      First
                    </p>
                    <h2 className="font-display text-2xl font-bold">
                      Who will use this workspace?
                    </h2>
                  </div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={updateOnboarding.isPending}
                    onClick={() => void chooseMode("individual")}
                    className="rounded-2xl border border-[#DCE4EE] bg-[#FAFCFF] p-5 text-left transition hover:border-[#9CB8E8]"
                  >
                    <Building2 className="h-5 w-5 text-[#3F70D8]" />
                    <p className="mt-4 font-bold">Just me</p>
                    <p className="mt-2 text-sm leading-6 text-[#718096]">
                      A simple personal sales workspace.
                    </p>
                  </button>
                  <button
                    type="button"
                    disabled={updateOnboarding.isPending}
                    onClick={() => void chooseMode("team")}
                    className="rounded-2xl border border-[#DCE4EE] bg-[#FAFCFF] p-5 text-left transition hover:border-[#9CB8E8]"
                  >
                    <Users className="h-5 w-5 text-[#3F70D8]" />
                    <p className="mt-4 font-bold">My sales team</p>
                    <p className="mt-2 text-sm leading-6 text-[#718096]">
                      Shared company knowledge with private salesperson
                      workspaces.
                    </p>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#3F70D8]">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[.12em] text-[#8290A3]">
                      Step 1
                    </p>
                    <h2 className="font-display text-2xl font-bold">
                      Tell me about your business.
                    </h2>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66758A]">
                  Start with the essentials. I’ll learn the public website in
                  the next step and ask you to confirm what I found.
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
                  <Button
                    variant="ghost"
                    onClick={() => setWorkspaceMode(null)}
                  >
                    Change workspace type
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {step === 2 ? (
          <section className="mt-6 rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#3F70D8]">
                <Globe2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#8290A3]">
                  Step 2
                </p>
                <h2 className="font-display text-2xl font-bold">
                  Let me learn your business.
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66758A]">
              I’ll read the public company website, organise the useful business
              facts and then show you a short review before anything becomes
              trusted knowledge.
            </p>

            {learningRunning ? (
              <div className="mt-6 rounded-2xl border border-blue-100 bg-[#F4F8FF] p-5">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-[#3F70D8]" />
                  <div>
                    <p className="font-bold">Learning your business…</p>
                    <p className="mt-1 text-sm text-[#718096]">
                      You can leave this page. Progress is saved automatically.
                    </p>
                  </div>
                </div>
              </div>
            ) : learningNeedsAttention ? (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="font-bold text-amber-900">
                  Learning paused before it finished.
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  Nothing new was trusted. Resume from the saved progress when
                  you’re ready.
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
          <section className="mt-6 rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#EDF3FF] text-[#3F70D8]">
                <Network className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#8290A3]">
                  Step 3
                </p>
                <h2 className="font-display text-2xl font-bold">
                  Connect your CRM.
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66758A]">
              Choose the CRM your team already uses. For browser-based CRMs, you
              sign in directly inside your private CRM workspace.
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
                      ? "border-[#3F70D8] bg-[#F3F7FF]"
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
          <section className="mt-6 rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[.12em] text-emerald-700">
                  Final step
                </p>
                <h2 className="font-display text-3xl font-bold">
                  Sign in to your CRM.
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#66758A]">
              Open your private CRM workspace and sign in directly. Once
              Amarktai confirms safe read access, setup completes automatically
              and your Assistant opens.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Business", "Understood"],
                ["CRM", connectedSystems[0]?.displayName || "Connected"],
                ["Assistant", "Ready after sign-in"],
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
              Open CRM and finish setup
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </section>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
