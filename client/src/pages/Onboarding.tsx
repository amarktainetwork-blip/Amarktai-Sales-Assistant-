import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import WorkflowFeedback, { type WorkflowFeedbackState } from "@/components/WorkflowFeedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  CRM_CAPABILITY_PRESENTATION,
  humanBrowserCapabilityStatus,
  humanizeCrmFailure,
  onboardingSellingReadiness,
} from "@/lib/onboardingReadiness";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Globe2,
  Network,
  Plus,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type Provider =
  | "genie"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "zoho"
  | "custom_browser";
type Method = "oauth" | "browser";
type CrmCapability =
  | "contacts.read"
  | "contacts.write"
  | "companies.read"
  | "companies.write"
  | "opportunities.read"
  | "opportunities.write"
  | "tasks.read"
  | "tasks.write"
  | "activities.read"
  | "activities.write"
  | "notes.read"
  | "notes.write"
  | "owners.read"
  | "pipelines.read"
  | "email.send"
  | "sms.send"
  | "whatsapp.send"
  | "sequences.apply";

type CrmForm = {
  provider: Provider;
  displayName: string;
  baseUrl: string;
  connectionMethod: Method;
  capabilities: CrmCapability[];
};

type AutomaticCommissioning = {
  id: number;
  state: string;
  status: string;
  humanStatus: string;
  safeTestRequired: boolean;
  temporaryRecordSupported: boolean;
  temporaryRecordGuidance: string;
  advancedFallback: boolean;
  progress: Record<string, unknown>;
  optionalFailures: Record<string, string>;
};

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

const defaultCapabilities: CrmCapability[] = [
  "contacts.read",
  "contacts.write",
  "companies.read",
  "companies.write",
  "opportunities.read",
  "opportunities.write",
  "tasks.read",
  "tasks.write",
  "activities.read",
  "activities.write",
  "notes.read",
  "notes.write",
  "owners.read",
  "pipelines.read",
  "email.send",
  "sms.send",
  "whatsapp.send",
  "sequences.apply",
];
const providerLabels: Record<Provider, string> = {
  genie: "Genie",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  pipedrive: "Pipedrive",
  zoho: "Zoho CRM",
  custom_browser: "Other CRM",
};
const steps = [
  "Business",
  "Learn business",
  "Knowledge review",
  "Connect CRM",
  "Safe automation rules",
  "Test & start selling",
];

function isBrowser(provider: Provider) {
  return provider === "genie" || provider === "custom_browser";
}
function completedProgress(value: unknown) {
  const status = value && typeof value === "object" && "status" in value
    ? String((value as { status?: unknown }).status || "")
    : String(value || "");
  return /^(?:ready|complete)$/i.test(status);
}
function setupStepLabel(input: { value?: unknown; active?: boolean; awaitingApproval?: boolean }) {
  if (completedProgress(input.value)) return "Complete";
  if (input.awaitingApproval) return "Awaiting approval";
  if (input.active) return "Running";
  return "Not started";
}
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[#0C1E3E] p-6 sm:p-8">
      {children}
    </section>
  );
}
function StepHeading({
  icon: Icon,
  number,
  title,
  text,
}: {
  icon: typeof Building2;
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid size-10 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[.15em] text-[#83AEFF]">
          Step {number}
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold text-white">
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#A9BFDF]">
          {text}
        </p>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const organisation = trpc.organisation.current.useQuery();
  const organisationId = organisation.data?.organisationId;
  const canManage =
    organisation.data?.role === "owner" ||
    organisation.data?.role === "manager";
  const setup = trpc.companySetup.get.useQuery();
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(organisationId) }
  );
  const outlook = trpc.outlook.readiness.useQuery(undefined, { retry: false });
  const [step, setStep] = useState(1);
  const [feedback, setFeedback] = useState<WorkflowFeedbackState | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"individual" | "team" | null>(null);
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
  const [preview, setPreview] = useState<{
    discoveryId: number;
    sourceUrl: string;
    proposedKnowledge: Array<{ title: string; content: string; sourceUrl: string; fetchedAt: string; category: string }>;
    pages: Array<{ url: string; title: string | null; category: string; fetchedAt: string; rendered: boolean; textChars: number }>;
  } | null>(null);
  const [selectedKnowledge, setSelectedKnowledge] = useState<number[]>([]);
  const [crm, setCrm] = useState<CrmForm>({
    provider: "genie",
    displayName: "Genie CRM",
    baseUrl: "",
    connectionMethod: "browser",
    capabilities: defaultCapabilities,
  });
  const [browserCredentials, setBrowserCredentials] = useState({
    username: "",
    password: "",
  });
  const [browserConnectionId, setBrowserConnectionId] = useState<number | null>(
    null
  );
  const [commissioning, setCommissioning] = useState<AutomaticCommissioning | null>(null);
  const [commissioningPending, setCommissioningPending] = useState(false);
  const [playbook, setPlaybook] = useState({
    title: "",
    trigger: "",
    description: "",
    agentKey: "supervisor",
  });

  useEffect(() => {
    const saved = setup.data?.profile;
    if (saved)
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

  useEffect(() => {
    if (preview) return;
    const saved = setup.data?.discoveries.find(discovery => discovery.status === "review_required");
    if (!saved) return;
    const proposedKnowledge = saved.proposedKnowledge as Array<{ title: string; content: string; sourceUrl: string; fetchedAt: string; category: string }>;
    const facts = saved.proposedFacts as { pages?: Array<{ url: string; title: string | null; category: string; fetchedAt: string; rendered: boolean; textChars: number }> };
    setPreview({ discoveryId: saved.id, sourceUrl: saved.sourceUrl, proposedKnowledge, pages: facts.pages ?? [] });
    setSelectedKnowledge(proposedKnowledge.map((_, index) => index));
  }, [preview, setup.data?.discoveries]);

  useEffect(() => {
    const savedMode = organisation.data?.settings?.workspaceMode;
    if (savedMode === "individual" || savedMode === "team") setWorkspaceMode(savedMode);
    const savedOnboarding = organisation.data?.settings?.onboarding;
    if (savedOnboarding && typeof savedOnboarding === "object" && "step" in savedOnboarding) {
      const savedStep = Number((savedOnboarding as { step?: unknown }).step);
      if (Number.isInteger(savedStep) && savedStep >= 1 && savedStep <= 6) setStep(savedStep);
    }
  }, [organisation.data?.settings]);

  useEffect(() => {
    if (browserConnectionId) return;
    const existing = systems.data?.find(system => system.connectionMethod === "browser");
    if (existing) setBrowserConnectionId(existing.id);
  }, [browserConnectionId, systems.data]);

  const onboardingProgress = trpc.organisation.updateOnboarding.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Saving setup progress", detail: "Your place in setup is being saved so you can resume later." }),
    onSuccess: async result => {
      if (result.workspaceMode === "individual" || result.workspaceMode === "team") setWorkspaceMode(result.workspaceMode);
      await utils.organisation.current.invalidate();
      setFeedback({ kind: "success", title: "Setup progress saved", detail: "You can safely leave and resume this guided setup later." });
    },
    onError: error => setFeedback({ kind: "error", title: "Setup progress was not saved", detail: `Your current screen is unaffected. ${error.message}`, actionLabel: "Retry", onAction: () => onboardingProgress.mutate({ workspaceMode: workspaceMode ?? undefined, step }) }),
  });

  const saveProfile = trpc.companySetup.saveProfile.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Saving business details", detail: "Amarktai is securing the business context for this workspace." }),
    onSuccess: () => {
      utils.companySetup.get.invalidate();
      setStep(2);
      onboardingProgress.mutate({ step: 2 });
      toast.success("Company profile saved.");
      setFeedback({ kind: "success", title: "Business details saved", detail: "Website discovery can now use this approved starting point." });
    },
    onError: error => setFeedback({ kind: "error", title: "Business details were not saved", detail: `No discovery was started. ${error.message}`, actionLabel: "Retry save", onAction: () => saveProfile.mutate(profile) }),
  });
  const discover = trpc.companySetup.discoverWebsite.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Reading the public website", detail: "Amarktai is scanning a bounded set of authorised pages. This can take a moment." }),
    onSuccess: result => {
      setPreview(result);
      setSelectedKnowledge(result.proposedKnowledge.map((_, index) => index));
      setStep(3);
      onboardingProgress.mutate({ step: 3 });
      toast.success(
        "Website context is saved as a review-only draft. Approve facts before Amarktai can trust or use them."
      );
      setFeedback({ kind: "success", title: "Website review is ready", detail: "The results are review-only. Select and approve facts before they become trusted knowledge." });
    },
    onError: error => setFeedback({ kind: "error", title: "The business website could not be read", detail: `No content became trusted knowledge. Check the public URL or site access and try again. ${error.message}`, actionLabel: "Retry website scan", onAction: () => discover.mutate() }),
  });
  const confirm = trpc.companySetup.confirmDiscovery.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Approving selected knowledge", detail: "Only the facts you selected will become trusted context." }),
    onSuccess: () => {
      utils.companySetup.get.invalidate();
      setPreview(null);
      setStep(4);
      onboardingProgress.mutate({ step: 4 });
      toast.success("Selected knowledge was confirmed.");
      setFeedback({ kind: "success", title: "Knowledge approved", detail: "Sales assistance can now use the confirmed facts and their source references." });
    },
    onError: error => setFeedback({ kind: "error", title: "Knowledge was not approved", detail: `The review remains available and no unconfirmed facts were trusted. ${error.message}`, actionLabel: "Retry approval", onAction: () => preview && confirm.mutate({ discoveryId: preview.discoveryId, knowledgeIndexes: selectedKnowledge, corrections: selectedKnowledge.map(index => ({ index, title: preview.proposedKnowledge[index].title, content: preview.proposedKnowledge[index].content })) }) }),
  });
  const addDomain = trpc.connectedSystems.addDomain.useMutation();
  const beginOAuth = trpc.connectedSystems.beginOAuth.useMutation();
  const addConnection = trpc.connectedSystems.create.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: `Connecting ${crm.displayName || "CRM"}`, detail: "Amarktai is creating the governed connection and validating its authorised location." }),
    onSuccess: async id => {
      if (!organisationId) return;
      if (isBrowser(crm.provider)) {
        const url = new URL(crm.baseUrl);
        await addDomain.mutateAsync({
          organisationId,
          connectedSystemId: id,
          hostname: url.hostname,
          allowedPaths: ["/"],
        });
        await jsonRequest(`/api/connected-system-admin/${id}/browser`, {
          method: "PUT",
          body: JSON.stringify(browserCredentials),
        });
        setBrowserCredentials(current => ({ ...current, password: "" }));
        setBrowserConnectionId(id);
        await systems.refetch();
        setFeedback({ kind: "loading", title: "Setting up your CRM", detail: "Secure sign-in was saved. Amarktai is now checking the connection and every function it can safely verify." });
        try {
          const result = await jsonRequest(
            `/api/connected-system-admin/${id}/commissioning`,
            { method: "POST", body: "{}" }
          );
          setCommissioning(result as AutomaticCommissioning);
          setFeedback({ kind: "loading", title: "Setting up your CRM", detail: "Amarktai is signing in, discovering functions and testing safe reads in the background." });
        } catch (error) {
          console.error("[crm-onboarding] automatic setup failed", error);
          setFeedback({
            kind: "error",
            title: "CRM setup needs attention",
            detail: humanizeCrmFailure(
              error instanceof Error ? error.message : String(error)
            ),
          });
        }
        return;
      }
      await systems.refetch();
      toast.success(
        "CRM registered. Continue with the provider's secure OAuth screen."
      );
      const result = await beginOAuth.mutateAsync({
        organisationId,
        connectedSystemId: id,
      });
      window.location.assign(result.authorizationUrl);
    },
    onError: error => setFeedback({ kind: "error", title: "CRM connection could not be created", detail: `No sales action was enabled. Check the sign-in URL and details, then retry. ${error.message}`, actionLabel: "Retry connection", onAction: registerConnection }),
  });
  const savePlaybook = trpc.companySetup.savePlaybook.useMutation({
    onSuccess: () => {
      utils.companySetup.get.invalidate();
      setStep(6);
      onboardingProgress.mutate({ step: 6 });
      toast.success("Review-first playbook saved.");
    },
    onError: error => toast.error(error.message),
  });
  const [safeTestMode, setSafeTestMode] = useState<"existing" | "temporary">(
    "existing"
  );
  const [safeTestCustomer, setSafeTestCustomer] = useState("");
  const [safeTestEmail, setSafeTestEmail] = useState("");
  const [safeTestPhone, setSafeTestPhone] = useState("");
  const profileSaved = Boolean(setup.data?.profile);
  const knowledgeConfirmed =
    setup.data?.profile?.discoveryStatus === "confirmed";
  const browserSystem = systems.data?.find(
    system => system.id === browserConnectionId
  );
  const browserReadiness = trpc.connectedSystems.browserOperationMatrix.useQuery(
    { organisationId: organisationId ?? 0, connectedSystemId: browserSystem?.id ?? 0 },
    { enabled: Boolean(organisationId && browserSystem?.id), retry: false }
  );
  useEffect(() => {
    if (!browserSystem?.id || !canManage) return;
    let cancelled = false;
    let terminal = ["ready", "needs_attention", "failed", "cancelled"].includes(
      commissioning?.status || ""
    );
    const refresh = async () => {
      try {
        const result = await jsonRequest(
          `/api/connected-system-admin/${browserSystem.id}/commissioning`
        );
        if (cancelled) return;
        setCommissioning((result.job || null) as AutomaticCommissioning | null);
        terminal = ["ready", "needs_attention", "failed", "cancelled"].includes(
          result.job?.status
        );
        if (result.job?.status === "ready") {
          await Promise.all([systems.refetch(), browserReadiness.refetch()]);
          setFeedback({ kind: "success", title: "Your CRM is ready", detail: "Core sales functions were automatically verified. Optional functions that need attention remain safely unavailable." });
        }
      } catch (error) {
        if (!cancelled)
          console.error("[crm-onboarding] commissioning status failed", error);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (!terminal) void refresh();
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [browserSystem?.id, canManage, commissioning?.status]);
  const sellingReadiness = onboardingSellingReadiness({
    profileSaved,
    knowledgeConfirmed,
    nativeSystems: systems.data?.filter(system => system.connectionMethod === "oauth"),
    browserSystem,
    browserOperations: browserReadiness.data?.operations,
  });

  function selectProvider(provider: Provider) {
    setCrm(current => ({
      ...current,
      provider,
      displayName: providerLabels[provider],
      baseUrl: "",
      connectionMethod: isBrowser(provider) ? "browser" : "oauth",
    }));
  }
  function registerConnection() {
    if (!organisationId) return;
    const allowedReadCapabilities = crm.capabilities.filter(capability =>
      capability.endsWith(".read")
    );
    const allowedWriteCapabilities = crm.capabilities.filter(
      capability => !capability.endsWith(".read")
    );
    addConnection.mutate({
      organisationId,
      provider: crm.provider,
      displayName: crm.displayName.trim() || providerLabels[crm.provider],
      baseUrl: crm.baseUrl.trim() || null,
      connectionMethod: crm.connectionMethod,
      allowedReadCapabilities,
      allowedWriteCapabilities,
    });
  }

  async function startBrowserCommissioning() {
    if (!browserSystem) return;
    try {
      setCommissioningPending(true);
      setFeedback({ kind: "loading", title: "Setting up your CRM", detail: "Automatic discovery and safe read testing are starting in the background." });
      const result = await jsonRequest(
        `/api/connected-system-admin/${browserSystem.id}/commissioning`,
        { method: "POST", body: "{}" }
      );
      setCommissioning(result as AutomaticCommissioning);
    } catch (error) {
      setFeedback({ kind: "error", title: "CRM setup could not start", detail: humanizeCrmFailure(error instanceof Error ? error.message : String(error)) });
    } finally {
      setCommissioningPending(false);
    }
  }

  async function approveSafeTestRecord() {
    if (
      !browserSystem ||
      (safeTestMode === "existing" && !safeTestCustomer.trim())
    ) return;
    try {
      setCommissioningPending(true);
      const result = await jsonRequest(
        `/api/connected-system-admin/${browserSystem.id}/commissioning/safe-test`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: safeTestMode,
            reference: safeTestCustomer.trim(),
            authorisedDestinations: {
              email: safeTestEmail.trim() || undefined,
              sms: safeTestPhone.trim() || undefined,
              whatsapp: safeTestPhone.trim() || undefined,
              dialler: safeTestPhone.trim() || undefined,
            },
          }),
        }
      );
      setCommissioning(result as AutomaticCommissioning);
      setFeedback({ kind: "loading", title: "Testing updates", detail: "Amarktai is running only the controlled tests authorised for this setup record and checking every result." });
    } catch (error) {
      setFeedback({ kind: "error", title: "Safe test could not start", detail: humanizeCrmFailure(error instanceof Error ? error.message : String(error)) });
    } finally {
      setCommissioningPending(false);
    }
  }

  if (organisation.data && !canManage)
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl text-[#EEF5FF]">
          <Card>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
              Your team workspace
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] text-white">
              Your company setup is already here.
            </h1>
            <p className="mt-4 text-sm leading-6 text-[#B7CAE7]">
              You inherit the approved business knowledge, CRM connection,
              available functions, mappings and workspace policies. You do not
              need to scan the website, reconnect the CRM or repeat company-wide
              tests.
            </p>
            <Button onClick={() => navigate("/today")} className="mt-6 bg-emerald-600 hover:bg-emerald-500">
              Start selling
            </Button>
          </Card>
        </div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6 text-[#EEF5FF]">
        <Card>
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#83AEFF]">
            Organisation intelligence
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] text-white sm:text-5xl">
            Set up your <span className="text-[#83AEFF]">Sales Assistant.</span>
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[#B7CAE7]">
            Build a trusted organisation context, connect the CRM your team
            already uses, and verify every external capability before it becomes
            available.
          </p>
        </Card>
        {canManage && <ManagementElevation />}
        <WorkflowFeedback state={feedback} />
        {!workspaceMode && (
          <Card>
            <StepHeading
              icon={Building2}
              number="A"
              title="Who are you setting this up for?"
              text="Choose the experience that fits your work. You can use the same core workspace and change this later in company setup."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                disabled={onboardingProgress.isPending}
                onClick={() => onboardingProgress.mutate({ workspaceMode: "individual", step: 1 })}
                className="rounded-2xl border border-white/10 bg-[#08172F] p-5 text-left transition hover:border-[#4E8BFF] hover:bg-[#102A56]"
              >
                <p className="font-display text-2xl font-bold text-white">Just me</p>
                <p className="mt-2 text-sm leading-6 text-[#A9BFDF]">A focused salesperson workspace without team administration clutter.</p>
              </button>
              <button
                disabled={onboardingProgress.isPending}
                onClick={() => onboardingProgress.mutate({ workspaceMode: "team", step: 1 })}
                className="rounded-2xl border border-white/10 bg-[#08172F] p-5 text-left transition hover:border-[#4E8BFF] hover:bg-[#102A56]"
              >
                <p className="font-display text-2xl font-bold text-white">My company / sales team</p>
                <p className="mt-2 text-sm leading-6 text-[#A9BFDF]">Add members, roles, targets, mappings, assurance, QA, and team reporting.</p>
              </button>
            </div>
          </Card>
        )}
        {workspaceMode && (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0C1E3E] px-4 py-3 text-sm">
            <span className="font-bold text-white">Experience: {workspaceMode === "individual" ? "Individual salesperson" : "Company / sales team"}</span>
            <button onClick={() => setWorkspaceMode(null)} className="font-bold text-[#83AEFF]">Change</button>
          </div>
        )}
        <nav className="grid gap-2 rounded-[1.5rem] border border-white/10 bg-[#0C1E3E] p-3 sm:grid-cols-6">
          {steps.map((label, index) => (
            <button
              key={label}
              onClick={() => setStep(index + 1)}
              className={`rounded-xl px-3 py-3 text-left text-xs font-bold ${step === index + 1 ? "bg-[#153B7A] text-white" : "text-[#A9BFDF] hover:bg-white/[.05]"}`}
            >
              <span className="mr-2 text-[#83AEFF]">
                {String(index + 1).padStart(2, "0")}
              </span>
              {label}
            </button>
          ))}
        </nav>

        {!workspaceMode ? null : <>
        {step === 1 && (
          <Card>
            <StepHeading
              icon={Building2}
              number="01"
              title="Tell us about your organisation"
              text="This private profile gives Amarktai the business context it needs to prepare useful sales work."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Input
                value={profile.companyName}
                onChange={event =>
                  setProfile({ ...profile, companyName: event.target.value })
                }
                placeholder="Your organisation"
                className="border-white/15 bg-[#08172F] text-white"
              />
              <Input
                value={profile.websiteUrl}
                onChange={event =>
                  setProfile({ ...profile, websiteUrl: event.target.value })
                }
                placeholder="https://example.com"
                className="border-white/15 bg-[#08172F] text-white"
              />
              <Input
                value={profile.industry}
                onChange={event =>
                  setProfile({ ...profile, industry: event.target.value })
                }
                placeholder="Industry"
                className="border-white/15 bg-[#08172F] text-white"
              />
              <Input
                value={profile.primarySalesObjective}
                onChange={event =>
                  setProfile({ ...profile, primarySalesObjective: event.target.value })
                }
                placeholder="Primary sales objective"
                className="border-white/15 bg-[#08172F] text-white"
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Textarea
                value={profile.productsServices}
                onChange={event => setProfile({ ...profile, productsServices: event.target.value })}
                placeholder="Products and services"
                className="min-h-24 border-white/15 bg-[#08172F] text-white"
              />
              <Textarea
                value={profile.typicalCustomer}
                onChange={event => setProfile({ ...profile, typicalCustomer: event.target.value })}
                placeholder="Typical customer"
                className="min-h-24 border-white/15 bg-[#08172F] text-white"
              />
            </div>
            <Textarea
              value={profile.brandVoice}
              onChange={event =>
                setProfile({ ...profile, brandVoice: event.target.value })
              }
              placeholder="Approved voice, policies, and sales guidance…"
              className="mt-4 min-h-28 border-white/15 bg-[#08172F] text-white"
            />
            <Button
              disabled={!profile.companyName || saveProfile.isPending}
              onClick={() => saveProfile.mutate(profile)}
              className="mt-5 bg-[#1B64F2]"
            >
              Save and continue
            </Button>
          </Card>
        )}
        {step === 2 && (
          <Card>
            <StepHeading
              icon={Globe2}
              number="02"
              title="Preview website context"
              text="A bounded public-site scan blocks private destinations. Results remain review-only until you approve them."
            />
            <Button
              disabled={!profileSaved || discover.isPending}
              onClick={() => discover.mutate()}
              className="mt-6 bg-[#1B64F2]"
            >
              Start secure preview
            </Button>
          </Card>
        )}
        {step === 3 && (
          <Card>
            <StepHeading
              icon={BadgeCheck}
              number="03"
              title="Confirm usable knowledge"
              text="Only selected public website facts become approved workspace knowledge."
            />
            {preview ? (
              <>
                <div className="mt-6 space-y-3">
                  {preview.proposedKnowledge.map((item, index) => (
                    <label
                      key={`${item.title}-${index}`}
                      className="flex gap-3 rounded-xl border border-white/10 bg-[#08172F] p-4"
                    >
                      <input
                        type="checkbox"
                        checked={selectedKnowledge.includes(index)}
                        onChange={() =>
                          setSelectedKnowledge(
                            selectedKnowledge.includes(index)
                              ? selectedKnowledge.filter(
                                  value => value !== index
                                )
                              : [...selectedKnowledge, index]
                          )
                        }
                      />
                      <span>
                        <Input
                          value={item.title}
                          onChange={event => setPreview(current => current ? { ...current, proposedKnowledge: current.proposedKnowledge.map((candidate, position) => position === index ? { ...candidate, title: event.target.value } : candidate) } : current)}
                          className="border-white/15 bg-[#071326] font-bold text-white"
                          aria-label={`Correct the title for ${item.title}`}
                        />
                        <Textarea value={item.content} onChange={event => setPreview(current => current ? { ...current, proposedKnowledge: current.proposedKnowledge.map((candidate, position) => position === index ? { ...candidate, content: event.target.value } : candidate) } : current)} className="mt-2 min-h-24 border-white/15 bg-[#071326] text-sm text-[#DCE7F8]" aria-label={`Correct ${item.title}`} />
                        {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs font-bold text-[#83AEFF]">
                          Source: {item.sourceUrl} · {item.fetchedAt ? `read ${new Date(item.fetchedAt).toLocaleString()}` : "saved discovery"}
                        </a> : null}
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  disabled={confirm.isPending}
                  onClick={() =>
                    confirm.mutate({ discoveryId: preview.discoveryId, knowledgeIndexes: selectedKnowledge, corrections: selectedKnowledge.map(index => ({ index, title: preview.proposedKnowledge[index].title, content: preview.proposedKnowledge[index].content })) })
                  }
                  className="mt-5 bg-[#1B64F2]"
                >
                  Confirm selected knowledge
                </Button>
              </>
            ) : (
              <p className="mt-5 text-sm text-[#A9BFDF]">
                Start a fresh website preview first.
              </p>
            )}
          </Card>
        )}
        {step === 4 && (
          <Card>
            <StepHeading
              icon={Network}
              number="04"
              title="Connect the CRM you already use"
              text="Choose your CRM and sign in. Amarktai automatically uses the correct secure connection, discovery and testing flow."
            />
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  "genie",
                  "hubspot",
                  "salesforce",
                  "pipedrive",
                  "zoho",
                  "custom_browser",
                ] as Provider[]
              ).map(provider => (
                <button
                  type="button"
                  key={provider}
                  onClick={() => selectProvider(provider)}
                  className={`rounded-2xl border p-4 text-left transition ${crm.provider === provider ? "border-[#4E8BFF] bg-[#153B7A]" : "border-white/10 bg-[#08172F] hover:border-white/25"}`}
                >
                  <p className="font-display text-xl font-bold text-white">
                    {providerLabels[provider]}
                  </p>
                  <p className="mt-1 text-xs text-[#A9BFDF]">
                    {isBrowser(provider)
                      ? "Secure browser connection"
                      : "Secure provider sign-in"}
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {isBrowser(crm.provider) && (
                <>
                  <Input
                    value={crm.baseUrl}
                    onChange={event =>
                      setCrm({ ...crm, baseUrl: event.target.value })
                    }
                    placeholder="https://crm.company.example/login"
                    className="border-white/15 bg-[#08172F] text-white sm:col-span-2"
                    aria-label="CRM login page"
                  />
                  <Input
                    value={browserCredentials.username}
                    onChange={event =>
                      setBrowserCredentials({
                        ...browserCredentials,
                        username: event.target.value,
                      })
                    }
                    placeholder="Username or email"
                    autoComplete="off"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                  <Input
                    type="password"
                    value={browserCredentials.password}
                    onChange={event =>
                      setBrowserCredentials({
                        ...browserCredentials,
                        password: event.target.value,
                      })
                    }
                    placeholder="Password"
                    autoComplete="new-password"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                </>
              )}
            </div>
            <p className="mt-4 text-sm leading-6 text-[#A9BFDF]">
              Amarktai will discover the functions permitted by this account.
              You do not need to choose technical permissions manually.
            </p>
            <Button
              disabled={
                !organisationId ||
                !crm.displayName.trim() ||
                !crm.capabilities.length ||
                (isBrowser(crm.provider) && !crm.baseUrl.trim()) ||
                (isBrowser(crm.provider) &&
                  (!browserCredentials.username.trim() ||
                    !browserCredentials.password)) ||
                addConnection.isPending ||
                beginOAuth.isPending
              }
              onClick={registerConnection}
              className="mt-5 bg-[#1B64F2]"
            >
              <Plus className="mr-2 size-4" />
              {isBrowser(crm.provider) ? "Connect" : "Sign in securely"}
            </Button>
            {browserSystem && organisationId && (
              <section className="mt-6 space-y-5 rounded-2xl border border-[#4E8BFF]/35 bg-[#071326] p-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#83AEFF]">
                    Connect → Discover → Test → Ready
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-white">
                    Setting up your CRM
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#A9BFDF]">
                    Amarktai checks sign-in and discovers CRM functions automatically.
                    A function is shown as Ready only after the existing safe test
                    confirms it; optional functions can remain unavailable without
                    blocking your core sales work.
                  </p>
                </div>
                {commissioning && (
                  <div className="rounded-xl border border-white/10 bg-[#08172F] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#83AEFF]">CRM</p>
                        <p className="font-bold text-white">{browserSystem.displayName || "Genie"}</p>
                        <p className="mt-1 text-xs text-[#B7CAE7]">{commissioning.humanStatus}</p>
                      </div>
                      <span className={`text-xs font-bold ${commissioning.status === "ready" ? "text-emerald-200" : commissioning.advancedFallback ? "text-amber-100" : "text-[#9FC2FF]"}`}>
                        {commissioning.status === "ready" ? "Ready" : commissioning.advancedFallback ? "Needs setup" : "Working"}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-[#B7CAE7] sm:grid-cols-2">
                      {[
                        { label: "Authentication", value: commissioning.progress.authentication, active: commissioning.state === "AUTHENTICATE" },
                        { label: "Session verification", value: commissioning.progress.sessionReplay },
                        { label: "CRM discovery", value: commissioning.progress.capabilities, active: ["DISCOVER_NAVIGATION", "DISCOVER_CAPABILITIES"].includes(commissioning.state) },
                        { label: "Safe reads", value: commissioning.progress.safeReads, active: commissioning.state === "TEST_SAFE_READS" },
                        { label: "Controlled write test", value: commissioning.progress.controlledWrites, active: ["TEST_CONTROLLED_WRITES", "VERIFY_READBACK"].includes(commissioning.state), awaitingApproval: commissioning.safeTestRequired },
                        { label: "Result readback", value: commissioning.progress.readback, active: commissioning.state === "VERIFY_READBACK" },
                        { label: "Ready", value: commissioning.status === "ready" ? "complete" : undefined, active: commissioning.state === "PUBLISH_PROVEN_OPERATIONS" },
                      ].map(item => {
                        const stepLabel = setupStepLabel(item);
                        return <div key={item.label} className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2">
                          <span>{item.label}</span>
                          <span className={stepLabel === "Complete" ? "font-bold text-emerald-200" : stepLabel === "Awaiting approval" ? "font-bold text-amber-100" : stepLabel === "Running" ? "font-bold text-[#9FC2FF]" : "text-[#7896C1]"}>{stepLabel}</span>
                        </div>;
                      })}
                    </div>
                  </div>
                )}
                {(!commissioning || ["needs_attention", "failed", "cancelled"].includes(commissioning.status)) && <Button
                  onClick={() => void startBrowserCommissioning()}
                  disabled={commissioningPending}
                  className="bg-[#1B64F2]"
                >
                  {commissioningPending ? "Setting up CRM…" : commissioning ? "Retry CRM setup" : "Start automatic setup"}
                </Button>}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CRM_CAPABILITY_PRESENTATION.map(capability => {
                    const status = humanBrowserCapabilityStatus(
                      browserReadiness.data?.operations,
                      capability.keys
                    );
                    return (
                      <div key={capability.label} className="rounded-xl border border-white/10 bg-[#08172F] p-3">
                        <p className="text-sm font-bold text-white">{capability.label}</p>
                        <p className={`mt-1 text-xs font-bold ${status === "Ready" ? "text-emerald-200" : status === "Failed" ? "text-rose-200" : "text-amber-100"}`}>
                          {status}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {commissioning?.safeTestRequired && (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-400/[.06] p-4">
                    <h4 className="font-bold text-amber-100">Complete your CRM setup</h4>
                    <p className="mt-2 text-xs leading-5 text-[#D7C9A4]">
                      To make sure Amarktai can update your CRM safely, choose a
                      test customer. Amarktai will then run the available
                      controlled tests automatically and verify each result.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="flex items-center gap-2 text-xs text-white">
                        <input type="radio" checked={safeTestMode === "existing"} onChange={() => setSafeTestMode("existing")} />
                        Enter an existing CRM test record
                      </label>
                      {commissioning.temporaryRecordSupported && (
                        <label className="flex items-center gap-2 text-xs text-white">
                          <input type="radio" checked={safeTestMode === "temporary"} onChange={() => setSafeTestMode("temporary")} />
                          Create an Amarktai Setup Test contact
                        </label>
                      )}
                    </div>
                    {safeTestMode === "existing" ? (
                      <Input
                        value={safeTestCustomer}
                        onChange={event => setSafeTestCustomer(event.target.value)}
                        placeholder="Exact CRM contact ID, email, phone, or unique name"
                        className="mt-3 border-white/15 bg-[#071326] text-white"
                      />
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-[#D7C9A4]">
                        Amarktai will create an explicitly labelled temporary
                        contact and retain its exact ID. It remains for a manager
                        to remove unless this connector has an already verified,
                        explicitly safe delete operation.
                      </p>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Input
                        value={safeTestEmail}
                        onChange={event => setSafeTestEmail(event.target.value)}
                        placeholder="Authorised test email (optional)"
                        className="border-white/15 bg-[#071326] text-white"
                      />
                      <Input
                        value={safeTestPhone}
                        onChange={event => setSafeTestPhone(event.target.value)}
                        placeholder="Authorised test phone (optional)"
                        className="border-white/15 bg-[#071326] text-white"
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[#D7C9A4]">
                      Messaging and calling are tested only when you provide the
                      matching authorised destination. Otherwise those optional
                      functions remain unavailable.
                    </p>
                    {canManage && (
                      <Button
                        variant="outline"
                        disabled={(safeTestMode === "existing" && !safeTestCustomer.trim()) || commissioningPending}
                        onClick={() => void approveSafeTestRecord()}
                        className="mt-3 border-white/15 bg-white/5 text-white"
                      >
                        Approve and test automatically
                      </Button>
                    )}
                  </div>
                )}
                {canManage && commissioning?.advancedFallback && (
                  <details className="rounded-xl border border-white/10 bg-[#08172F] p-4">
                    <summary className="cursor-pointer text-sm font-bold text-[#A9C7FF]">
                      Advanced CRM Setup
                    </summary>
                    <p className="mt-2 text-xs leading-5 text-[#91A9CF]">
                      Automatic setup could not safely finish one or more
                      functions. Manager-only calibration, diagnostics and
                      individual replay remain available as fallback.
                    </p>
                    <Button variant="outline" onClick={() => navigate("/connections")} className="mt-3 border-white/15 bg-white/5 text-white">
                      Open Advanced CRM Setup
                    </Button>
                  </details>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={() => setStep(5)}
                    disabled={!sellingReadiness.coreGenieReady}
                    className="bg-emerald-600 hover:bg-emerald-500"
                  >
                    Continue to automation rules
                  </Button>
                </div>
              </section>
            )}
            {systems.data?.some(system => system.connectionMethod === "oauth") && (
              <div className="mt-6 space-y-2 rounded-xl border border-white/10 bg-[#08172F] p-4">
                <p className="text-sm font-bold text-white">Connected CRM</p>
                {systems.data
                  .filter(system => system.connectionMethod === "oauth")
                  .map(system => {
                    const checked = ["ready", "limited_permissions"].includes(
                      system.status
                    );
                    return (
                      <div key={system.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/15 px-3 py-2">
                        <span className="text-sm text-[#DCE7F8]">{system.displayName}</span>
                        <span className={`text-xs font-bold ${checked ? "text-emerald-200" : "text-amber-100"}`}>
                          {checked ? "Connected and checked" : "Needs setup"}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}
            <div className="mt-6 rounded-xl border border-white/10 bg-[#08172F] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-white">
                    Microsoft 365 / Outlook
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#A9BFDF]">
                    Optional reviewed sales email and calendar actions use the
                    approved Microsoft Graph tenant configured for this
                    deployment.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${outlook.data?.ready ? "bg-emerald-400/15 text-emerald-200" : "bg-white/8 text-[#A9BFDF]"}`}
                >
                  {outlook.data?.ready ? "Configured" : "Not configured"}
                </span>
              </div>
            </div>
          </Card>
        )}
        {step === 5 && (
          <Card>
            <StepHeading
              icon={ShieldCheck}
              number="05"
              title="Choose the first safe automation rule"
              text="Playbooks prepare controlled work. They never authorise external actions."
            />
            <Input
              value={playbook.title}
              onChange={event =>
                setPlaybook({ ...playbook, title: event.target.value })
              }
              placeholder="Playbook title"
              className="mt-6 border-white/15 bg-[#08172F] text-white"
            />
            <Input
              value={playbook.trigger}
              onChange={event =>
                setPlaybook({ ...playbook, trigger: event.target.value })
              }
              placeholder="Trigger"
              className="mt-4 border-white/15 bg-[#08172F] text-white"
            />
            <Textarea
              value={playbook.description}
              onChange={event =>
                setPlaybook({ ...playbook, description: event.target.value })
              }
              placeholder="What should the assistant prepare?"
              className="mt-4 min-h-28 border-white/15 bg-[#08172F] text-white"
            />
            <Button
              disabled={
                !playbook.title ||
                !playbook.trigger ||
                !playbook.description ||
                savePlaybook.isPending
              }
              onClick={() =>
                savePlaybook.mutate({
                  ...playbook,
                  requiredCapabilities: ["tasks"],
                  status: "draft",
                })
              }
              className="mt-5 bg-[#1B64F2]"
            >
              Save playbook
            </Button>
          </Card>
        )}
        {step === 6 && (
          <Card>
            <StepHeading
              icon={Rocket}
              number="06"
              title="Test readiness and start selling"
              text="This friendly checklist uses stored server evidence. A CRM task is ready only after an authorised test and readback pass."
            />
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Profile", profileSaved],
                ["Knowledge", knowledgeConfirmed],
                ["Verified CRM", sellingReadiness.crmVerified],
                ["Core selling functions", sellingReadiness.coreGenieReady],
              ].map(([label, ready]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-white/10 bg-[#08172F] p-4"
                >
                  <p className="font-bold text-white">{label}</p>
                  <p
                    className={`mt-2 text-sm ${ready ? "text-emerald-200" : "text-amber-200"}`}
                  >
                    {ready ? "Recorded" : "Still required"}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm leading-6 text-[#A9BFDF]">
              You can start selling when the core sales loop is verified. Optional
              functions such as calling, messaging, quotes and appointments remain
              individually unavailable until their own safe test succeeds.
            </p>
            <Button
              disabled={!sellingReadiness.canStartSelling || onboardingProgress.isPending}
              onClick={() => onboardingProgress.mutate({ step: 6, complete: true }, { onSuccess: () => navigate("/today") })}
              className="mt-5 bg-emerald-600 hover:bg-emerald-500"
            >
              Start selling
            </Button>
          </Card>
        )}
        </>}
      </div>
    </DashboardLayout>
  );
}
