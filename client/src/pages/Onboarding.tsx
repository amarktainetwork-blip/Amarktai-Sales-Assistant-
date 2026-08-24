import DashboardLayout from "@/components/DashboardLayout";
import ManagementElevation from "@/components/ManagementElevation";
import WorkflowFeedback, { type WorkflowFeedbackState } from "@/components/WorkflowFeedback";
import { BrowserOperationMatrix } from "./ConnectionsV2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
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

const capabilityOptions: Array<{ value: CrmCapability; label: string }> = [
  { value: "contacts.read", label: "Read contacts" },
  { value: "contacts.write", label: "Update contacts" },
  { value: "companies.read", label: "Read companies" },
  { value: "companies.write", label: "Update companies" },
  { value: "opportunities.read", label: "Read opportunities" },
  { value: "opportunities.write", label: "Update opportunities" },
  { value: "tasks.read", label: "Read tasks" },
  { value: "tasks.write", label: "Manage tasks" },
  { value: "activities.read", label: "Read activities" },
  { value: "activities.write", label: "Log activities" },
  { value: "notes.read", label: "Read notes" },
  { value: "notes.write", label: "Write notes" },
  { value: "owners.read", label: "Read owners" },
  { value: "pipelines.read", label: "Read pipelines" },
  { value: "email.send", label: "Send email" },
  { value: "sms.send", label: "Send SMS" },
  { value: "whatsapp.send", label: "Send WhatsApp" },
  { value: "sequences.apply", label: "Apply sequences" },
];
const defaultCapabilities: CrmCapability[] = [
  "contacts.read",
  "contacts.write",
  "companies.read",
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
];
const providerLabels: Record<Provider, string> = {
  genie: "Entrepreneurs Circle GenieAI",
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
  "Connect CRM & discover communications",
  "Safe automation rules",
  "Test & start selling",
];

function isBrowser(provider: Provider) {
  return provider === "genie" || provider === "custom_browser";
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
  const [sidecarToken, setSidecarToken] = useState("");
  const [businessMapping, setBusinessMapping] = useState({
    owners: "",
    pipelinesAndStages: "",
    leadStatuses: "",
    taskMeanings: "",
    customFields: "",
    permittedCommunicationChannels: "email",
    automationMode: "review",
  });
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
    onError: error => setFeedback({ kind: "error", title: "Knowledge was not approved", detail: `The review remains available and no unconfirmed facts were trusted. ${error.message}`, actionLabel: "Retry approval", onAction: () => preview && confirm.mutate({ discoveryId: preview.discoveryId, knowledgeIndexes: selectedKnowledge }) }),
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
        toast.success(
          "Encrypted Genie sign-in saved. Continue discovery, mapping and Teach Amarktai here."
        );
        setFeedback({ kind: "success", title: "Genie sign-in saved securely", detail: "Continue with discovery and the friendly readiness test. Credentials are encrypted and never sent to the AI." });
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
  const verifyBrowser = trpc.connectedSystems.verify.useMutation({
    onMutate: () => setFeedback({ kind: "loading", title: "Testing the CRM connection", detail: "Amarktai is checking sign-in and the currently proven CRM functions." }),
    onSuccess: result => {
      systems.refetch();
      toast[result.status === "ready" ? "success" : "warning"](result.summary);
      setFeedback(result.status === "ready" ? { kind: "success", title: "CRM connection is ready", detail: result.summary } : { kind: "error", title: "CRM needs attention", detail: `${result.summary} Reconnect or re-teach only the affected task, then retry.`, actionLabel: "Retry test", onAction: () => browserConnectionId && verifyBrowser.mutate({ organisationId: organisationId ?? 0, connectedSystemId: browserConnectionId }) });
    },
    onError: error => setFeedback({ kind: "error", title: "CRM test could not finish", detail: `Selling remains protected from unproven actions. ${error.message}`, actionLabel: "Retry test", onAction: () => browserConnectionId && verifyBrowser.mutate({ organisationId: organisationId ?? 0, connectedSystemId: browserConnectionId }) }),
  });
  const issueSidecar = trpc.sidecar.issueSession.useMutation({
    onSuccess: result => {
      setSidecarToken(result.token);
      toast.success("Sidecar session issued for guided training.");
    },
    onError: error => toast.error(error.message),
  });
  const profileSaved = Boolean(setup.data?.profile);
  const knowledgeConfirmed =
    setup.data?.profile?.discoveryStatus === "confirmed";
  const readySystems =
    systems.data?.filter(system => system.status === "ready") ?? [];
  const browserSystem = systems.data?.find(
    system => system.id === browserConnectionId
  );
  const browserReadiness = trpc.connectedSystems.browserOperationMatrix.useQuery(
    { organisationId: organisationId ?? 0, connectedSystemId: browserSystem?.id ?? 0 },
    { enabled: Boolean(organisationId && browserSystem?.id), retry: false }
  );
  const coreGenieTasks = [
    "contact.search",
    "contact.read",
    "task.list",
    "note.create",
    "task.create_callback",
    "opportunity.read",
    "opportunity.update",
  ];
  const coreGenieReady = !browserSystem || coreGenieTasks.every(key =>
    browserReadiness.data?.operations.some(operation => operation.key === key && operation.status === "LIVE_PROVEN")
  );

  function selectProvider(provider: Provider) {
    setCrm(current => ({
      ...current,
      provider,
      displayName: providerLabels[provider],
      baseUrl: "",
      connectionMethod: isBrowser(provider) ? "browser" : "oauth",
    }));
  }
  function toggleCapability(capability: CrmCapability) {
    setCrm(current => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter(item => item !== capability)
        : [...current.capabilities, capability],
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

  async function saveBusinessMapping() {
    if (!browserConnectionId) return;
    const lines = (value: string) =>
      value
        .split("\n")
        .map(item => item.trim())
        .filter(Boolean);
    try {
      await jsonRequest(
        `/api/connected-system-admin/${browserConnectionId}/business-mapping`,
        {
          method: "PUT",
          body: JSON.stringify({
            owners: lines(businessMapping.owners),
            pipelinesAndStages: lines(businessMapping.pipelinesAndStages),
            leadStatuses: lines(businessMapping.leadStatuses),
            taskMeanings: lines(businessMapping.taskMeanings),
            customFields: lines(businessMapping.customFields),
            permittedCommunicationChannels: lines(
              businessMapping.permittedCommunicationChannels
            ),
            automationMode: businessMapping.automationMode,
          }),
        }
      );
      await systems.refetch();
      toast.success("CRM mappings and governed automation choices saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save CRM mappings."
      );
    }
  }

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

        <ManagementElevation />
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
                        <b>{item.title}</b>
                        <span className="mt-1 block text-sm text-[#A9BFDF]">
                          {item.content}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <Button
                  disabled={confirm.isPending}
                  onClick={() =>
                    confirm.mutate({ discoveryId: preview.discoveryId, knowledgeIndexes: selectedKnowledge })
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
              title="Connect and verify your sales systems"
              text="Choose a native OAuth CRM or complete the full authorised Genie connection, training, mapping and readiness flow here."
            />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <select
                value={crm.provider}
                onChange={event =>
                  selectProvider(event.target.value as Provider)
                }
                className="h-11 rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"
              >
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="pipedrive">Pipedrive</option>
                <option value="zoho">Zoho CRM</option>
                <option value="genie">Entrepreneurs Circle GenieAI</option>
                <option value="custom_browser">Other CRM (browser)</option>
              </select>
              <Input
                value={crm.displayName}
                onChange={event =>
                  setCrm({ ...crm, displayName: event.target.value })
                }
                placeholder="Connection display name"
                className="border-white/15 bg-[#08172F] text-white"
              />
              {isBrowser(crm.provider) && (
                <>
                  <Input
                    value={crm.baseUrl}
                    onChange={event =>
                      setCrm({ ...crm, baseUrl: event.target.value })
                    }
                    placeholder="https://crm.company.example/login"
                    className="border-white/15 bg-[#08172F] text-white sm:col-span-2"
                  />
                  <Input
                    value={browserCredentials.username}
                    onChange={event =>
                      setBrowserCredentials({
                        ...browserCredentials,
                        username: event.target.value,
                      })
                    }
                    placeholder="CRM username / email"
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
                    placeholder="CRM password (encrypted at rest)"
                    autoComplete="new-password"
                    className="border-white/15 bg-[#08172F] text-white"
                  />
                </>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {capabilityOptions.map(option => (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => toggleCapability(option.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs ${crm.capabilities.includes(option.value) ? "border-[#4E8BFF] bg-[#153B7A] text-white" : "border-white/10 text-[#A9BFDF]"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
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
              Register and authenticate CRM
            </Button>
            {browserSystem && organisationId && (
              <section className="mt-6 space-y-5 rounded-2xl border border-[#4E8BFF]/35 bg-[#071326] p-5">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#83AEFF]">
                    Genie commissioning · one continuous flow
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-white">
                    Connect, discover, map, teach and prove.
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[#A9BFDF]">
                    The login URL and hostname are authorised, credentials are
                    encrypted, and every operation remains non-live until
                    controlled replay verifies its result.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      verifyBrowser.mutate({
                        organisationId,
                        connectedSystemId: browserSystem.id,
                      })
                    }
                    disabled={verifyBrowser.isPending}
                    className="bg-[#1B64F2]"
                  >
                    Connect / test login and discover
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => issueSidecar.mutate({ organisationId })}
                    disabled={issueSidecar.isPending}
                    className="border-white/15 bg-white/5 text-white"
                  >
                    Issue Teach Amarktai session
                  </Button>
                </div>
                {sidecarToken && (
                  <div className="rounded-xl border border-amber-300/20 bg-amber-400/[.06] p-3">
                    <p className="text-xs font-bold text-amber-100">
                      Copy once into the Sidecar; it expires and is
                      organisation-scoped.
                    </p>
                    <Input
                      readOnly
                      value={sidecarToken}
                      className="mt-2 border-white/15 bg-[#08172F] font-mono text-xs text-white"
                    />
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.12em] text-[#83AEFF]">
                    Map CRM business meaning
                  </p>
                  <p className="mt-1 text-xs text-[#91A9CF]">
                    One item per line. These labels remain organisation-specific
                    and do not become global Genie assumptions.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {(
                      [
                        ["owners", "CRM owners → Amarktai users"],
                        ["pipelinesAndStages", "Pipelines and stages"],
                        ["leadStatuses", "Lead statuses"],
                        ["taskMeanings", "Task / Manual Action meanings"],
                        ["customFields", "Key custom fields"],
                        [
                          "permittedCommunicationChannels",
                          "Permitted channels (email, sms, whatsapp)",
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="grid gap-1 text-xs font-bold text-[#AFC3E2]"
                      >
                        {label}
                        <Textarea
                          value={businessMapping[key]}
                          onChange={event =>
                            setBusinessMapping({
                              ...businessMapping,
                              [key]: event.target.value,
                            })
                          }
                          rows={2}
                          className="border-white/15 bg-[#08172F] text-white"
                        />
                      </label>
                    ))}
                    <label className="grid gap-1 text-xs font-bold text-[#AFC3E2]">
                      Automation policy
                      <select
                        value={businessMapping.automationMode}
                        onChange={event =>
                          setBusinessMapping({
                            ...businessMapping,
                            automationMode: event.target.value,
                          })
                        }
                        className="h-10 rounded-xl border border-white/15 bg-[#08172F] px-3 text-white"
                      >
                        <option value="advise">Advise only</option>
                        <option value="review">Review required</option>
                        <option value="auto_preapproved">
                          Auto preapproved safe actions
                        </option>
                      </select>
                    </label>
                  </div>
                  <Button
                    onClick={() => void saveBusinessMapping()}
                    className="mt-3 bg-[#1B64F2]"
                  >
                    Save CRM mapping
                  </Button>
                </div>
                <BrowserOperationMatrix
                  organisationId={organisationId}
                  experience="guided"
                  system={{
                    id: browserSystem.id,
                    provider: browserSystem.provider,
                    configuration: browserSystem.configuration as Record<
                      string,
                      unknown
                    >,
                  }}
                />
                <div className="flex justify-end">
                  <Button
                    onClick={() => setStep(5)}
                    className="bg-emerald-600 hover:bg-emerald-500"
                  >
                    Continue to automation rules
                  </Button>
                </div>
              </section>
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
                ["Verified CRM", readySystems.length > 0],
                ["Core Genie tasks", coreGenieReady],
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
              If a Genie task needs attention, return to Connections and show only
              that task again. Authorised write tests must use the client's dummy
              record and must confirm the changed state before selling begins.
            </p>
            <Button
              disabled={!profileSaved || !knowledgeConfirmed || !readySystems.length || !coreGenieReady || onboardingProgress.isPending}
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
