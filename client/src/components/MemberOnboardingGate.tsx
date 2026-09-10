import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  Building2,
  Check,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { friendlyError } from "@/lib/friendlyError";
import { nextRequiredOnboardingPath } from "@/lib/onboardingNextStep";

type Persona =
  | "individual"
  | "company_owner"
  | "manager"
  | "salesperson"
  | "auditor";

type MemberState = {
  step: number;
  complete: boolean;
  persona?: Persona;
  preferredName?: string;
  primaryGoal?: string;
  workingStyle?: string;
  crmIdentityConfirmed?: boolean;
  crmCredentialsSaved?: boolean;
};

type PersonalCrm = {
  id: number;
  provider: string;
  displayName: string;
  baseUrl: string | null;
  status: string;
  hasCredentials: boolean;
};

type IdentityCandidate = {
  id: number;
  connectedSystemId: number;
  externalUserId: string;
  displayName: string;
  email: string | null;
  userId: number | null;
};

type Snapshot = {
  member: MemberState;
  role: "owner" | "manager" | "salesperson" | "auditor";
  organisationId: number;
  organisationName: string;
  canManage: boolean;
  company: {
    complete: boolean;
    step: number;
    workspaceMode: "individual" | "team" | null;
  };
  personalCrm: PersonalCrm[];
  identity: {
    mappingsExist: boolean;
    mapped: boolean;
    current: IdentityCandidate[];
    candidates: IdentityCandidate[];
  };
  mailbox: {
    configured: boolean;
    connected: boolean;
    mailbox: null | {
      email: string;
      displayName: string | null;
      status: string;
    };
  };
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => {
    throw new Error("Your setup could not be loaded. Please try again.");
  })) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(
      friendlyError(
        body?.error,
        "Your setup could not be saved. Please try again."
      )
    );
  if (!body || typeof body !== "object")
    throw new Error("Your setup could not be loaded. Please try again.");
  return body;
}

function personaForRole(
  role: Snapshot["role"],
  mode: Snapshot["company"]["workspaceMode"]
): Persona {
  if (role === "salesperson") return "salesperson";
  if (role === "manager") return "manager";
  if (role === "auditor") return "auditor";
  return mode === "individual" ? "individual" : "company_owner";
}

function personaLabel(persona: Persona) {
  return {
    individual: "Individual salesperson",
    company_owner: "Company / team owner",
    manager: "Sales manager",
    salesperson: "Salesperson",
    auditor: "Reviewer / auditor",
  }[persona];
}

const blueButton =
  "h-11 rounded-xl bg-[#2F6FED] px-5 font-bold text-white hover:bg-[#2459C2]";

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid size-11 place-items-center rounded-xl bg-[#EAF1FF] text-[#2F6FED]">
      {children}
    </span>
  );
}

function SetupVisual() {
  return (
    <section className="amk-auth__visual">
      <img
        src="/images/people/pexels-kampus-8204317.jpg"
        alt="AmarktAI sales intelligence workspace"
      />
      <div className="amk-auth__shade" />
      <div className="amk-auth__visual-inner">
        <div className="amk-auth__topline">
          <span className="amk-auth__back">
            <ShieldCheck size={16} /> Secure onboarding
          </span>
          <BrandMark inverse />
        </div>
        <div className="amk-auth__message">
          <h1>Make room for selling.</h1>
          <p>Bring your company, customers and email together.</p>
        </div>
      </div>
    </section>
  );
}

export default function MemberOnboardingGate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [persona, setPersona] = useState<Persona | null>(null);
  const [preferredName, setPreferredName] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [workingStyle, setWorkingStyle] = useState("");

  async function refresh() {
    try {
      const next = await api<Snapshot>("/api/user-onboarding");
      if (!next.member || !next.company || !next.identity || !next.mailbox)
        throw new Error("Your setup could not be loaded. Please try again.");
      setSnapshot(next);
      setPersona(
        next.member.persona ||
          personaForRole(next.role, next.company.workspaceMode)
      );
      setPrimaryGoal(next.member.primaryGoal || "");
      setPreferredName(next.member.preferredName || "");
      setWorkingStyle(next.member.workingStyle || "");
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Onboarding could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const needsIdentity = Boolean(
    snapshot?.role === "salesperson" &&
      snapshot.identity.mappingsExist &&
      !snapshot.identity.mapped
  );
  const needsMailbox = Boolean(
    snapshot?.company.complete &&
      snapshot.mailbox.configured &&
      !snapshot.mailbox.connected
  );
  const pathname =
    typeof window === "undefined" ? "" : window.location.pathname;
  const companySetupAllowed = pathname === "/company-setup";

  const shouldBlock = useMemo(() => {
    if (loading) return true;
    if (!snapshot) return Boolean(error);
    if (!snapshot.member.complete) return true;
    if (
      snapshot.canManage &&
      !snapshot.company.complete &&
      !companySetupAllowed
    )
      return true;
    if (snapshot.company.complete && (needsIdentity || needsMailbox))
      return true;
    return false;
  }, [
    loading,
    snapshot,
    error,
    companySetupAllowed,
    needsIdentity,
    needsMailbox,
  ]);

  useEffect(() => {
    const route = document.getElementById("workspace-route");
    if (!route) return;
    route.inert = shouldBlock;
    return () => { route.inert = false; };
  }, [shouldBlock]);

  if (!shouldBlock) return null;

  async function saveProfile() {
    if (!snapshot || !persona || !preferredName.trim() || !primaryGoal.trim())
      return;
    try {
      setSaving(true);
      setError("");
      await api("/api/user-onboarding", {
        method: "PUT",
        body: JSON.stringify({
          step: 2,
          persona,
          preferredName: preferredName.trim(),
          primaryGoal: primaryGoal.trim(),
          workingStyle: workingStyle.trim(),
        }),
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your onboarding details were not saved."
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmIdentity(mappingId: number) {
    try {
      setSaving(true);
      setError("");
      await api("/api/team/crm-identity", {
        method: "PUT",
        body: JSON.stringify({ mappingId }),
      });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your CRM identity could not be confirmed."
      );
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    try {
      setSaving(true);
      setError("");
      await api("/api/user-onboarding/complete", {
        method: "POST",
        body: "{}",
      });
      const next = await api<Snapshot>("/api/user-onboarding");
      window.location.assign(nextRequiredOnboardingPath(next));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Onboarding could not be completed."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="amk-auth fixed inset-0 z-[250] overflow-y-auto">
        <SetupVisual />
        <section className="amk-auth__form-side">
          <div className="amk-auth__mobile-brand">
            <BrandMark />
          </div>
          <div className="amk-auth__form-wrap">
            <p className="amk-auth__panel-eyebrow">SECURE ONBOARDING</p>
            <h2>Preparing your workspace…</h2>
            <p className="amk-auth__muted flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-[#2F6FED]" /> Loading
              your saved setup.
            </p>
          </div>
        </section>
      </main>
    );

  if (!snapshot)
    return (
      <main className="amk-auth fixed inset-0 z-[250] overflow-y-auto">
        <SetupVisual />
        <section className="amk-auth__form-side">
          <div className="amk-auth__mobile-brand">
            <BrandMark />
          </div>
          <div className="amk-auth__form-wrap">
            <p className="amk-auth__panel-eyebrow">SETUP NEEDS ATTENTION</p>
            <h2>Your workspace could not be prepared.</h2>
            <p className="amk-auth__muted">{error}</p>
            <Button
              className={`mt-6 ${blueButton}`}
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          </div>
        </section>
      </main>
    );

  const personalProfileReady = Boolean(
    snapshot.member.persona &&
      snapshot.member.preferredName?.trim() &&
      snapshot.member.primaryGoal?.trim()
  );

  return (
    <main className="amk-auth fixed inset-0 z-[250] overflow-y-auto">
      <SetupVisual />
      <section className="amk-auth__form-side">
        <div className="amk-auth__mobile-brand">
          <BrandMark />
        </div>
        <div className="amk-auth__form-wrap">
          {snapshot.member.complete &&
          snapshot.canManage &&
          !snapshot.company.complete ? (
            <>
              <StepIcon>
                <Building2 size={19} />
              </StepIcon>
              <p className="amk-auth__panel-eyebrow">PERSONAL SETUP COMPLETE</p>
              <h2>Set up your company.</h2>
              <p className="amk-auth__muted">
                Add your company knowledge and connect the systems your team
                uses.
              </p>
              <Button
                className={`mt-7 ${blueButton}`}
                onClick={() => window.location.assign("/company-setup")}
              >
                Continue company setup <ArrowRight className="ml-2 size-4" />
              </Button>
            </>
          ) : !personalProfileReady ? (
            <>
              <StepIcon>
                <UserRound size={19} />
              </StepIcon>
              <p className="amk-auth__panel-eyebrow">STEP 1 · ABOUT YOU</p>
              <h2>Tell us about you.</h2>
              <p className="amk-auth__muted">
                Choose how AmarktAI should address you and what you want to
                achieve.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {(snapshot.role === "owner"
                  ? (["individual", "company_owner"] as Persona[])
                  : ([
                      personaForRole(
                        snapshot.role,
                        snapshot.company.workspaceMode
                      ),
                    ] as Persona[])
                ).map(option => (
                  <button
                    key={option}
                    aria-pressed={persona === option}
                    type="button"
                    onClick={() => setPersona(option)}
                    className={`rounded-xl border p-4 text-left transition ${persona === option ? "border-[#7FA4E8] bg-[#EEF4FF] text-[#2459C2]" : "border-[#DCE4EE] bg-white text-[#40516A] hover:border-[#AFC3E8] hover:bg-[#F8FAFD]"}`}
                  >
                    <span className="text-sm font-bold">
                      {personaLabel(option)}
                    </span>
                  </button>
                ))}
              </div>
              <form
                className="amk-auth-form"
                onSubmit={event => {
                  event.preventDefault();
                  void saveProfile();
                }}
              >
                <label className="amk-auth-field">
                  <span>Preferred name *</span>
                  <Input
                    value={preferredName}
                    onChange={event => setPreferredName(event.target.value)}
                    placeholder="Your preferred first name"
                    autoComplete="given-name"
                    required
                    maxLength={120}
                  />
                </label>
                <label className="amk-auth-field">
                  <span>Main sales goal *</span>
                  <Input
                    required
                    maxLength={500}
                    value={primaryGoal}
                    onChange={event => setPrimaryGoal(event.target.value)}
                    placeholder="For example: never miss a follow-up"
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Working preferences (optional)</summary>
                  <label className="amk-auth-field mt-3">
                  <span className="sr-only">Working preferences</span>
                  <Textarea
                    maxLength={2000}
                    value={workingStyle}
                    onChange={event => setWorkingStyle(event.target.value)}
                    placeholder="Optional — working style, priorities or preferences"
                    className="min-h-24 rounded-xl border-[#CBD7E6] bg-white text-[#26354A]"
                  />
                  </label>
                </details>
                <Button
                  type="submit"
                  disabled={
                    !persona ||
                    !preferredName.trim() ||
                    !primaryGoal.trim() ||
                    saving
                  }
                  className={`mt-6 ${blueButton}`}
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Save and continue
                </Button>
              </form>
            </>
          ) : needsIdentity ? (
            <>
              <StepIcon>
                <UserRound size={19} />
              </StepIcon>
              <p className="amk-auth__panel-eyebrow">STEP 2 · CRM IDENTITY</p>
              <h2>Confirm who you are in the CRM.</h2>
              <p className="amk-auth__muted">
                This keeps customers, tasks, activity and reporting tied to the
                correct salesperson without exposing another user’s workspace.
              </p>
              <div className="mt-6 grid gap-3">
                {snapshot.identity.candidates.length ? (
                  snapshot.identity.candidates.map(candidate => (
                    <button
                      key={candidate.id}
                      type="button"
                      disabled={saving}
                      onClick={() => void confirmIdentity(candidate.id)}
                      className="flex items-center justify-between gap-4 rounded-xl border border-[#DCE4EE] bg-white p-4 text-left transition hover:border-[#8EACEB] hover:bg-[#F2F6FF]"
                    >
                      <span>
                        <strong className="block text-sm text-[#26354A]">
                          {candidate.displayName}
                        </strong>
                        <span className="mt-1 block text-xs text-[#718096]">
                          {candidate.email || "CRM salesperson record"}
                        </span>
                      </span>
                      <ArrowRight className="size-4 text-[#2F6FED]" />
                    </button>
                  ))
                ) : (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    Your CRM salesperson identity has not been mapped yet. Ask
                    your manager to link your CRM owner record to your AmarktAI
                    account.
                  </p>
                )}
              </div>
            </>
          ) : needsMailbox ? (
            <>
              <StepIcon>
                <KeyRound size={19} />
              </StepIcon>
              <p className="amk-auth__panel-eyebrow">STEP 3 · YOUR MAILBOX</p>
              <h2>Connect your Outlook mailbox.</h2>
              <p className="amk-auth__muted">
                Sign in with Microsoft to connect your sales email.
              </p>
              <Button
                className={`mt-6 ${blueButton}`}
                onClick={() =>
                  window.location.assign("/api/mailbox/microsoft/start")
                }
              >
                Connect Outlook <ArrowRight className="ml-2 size-4" />
              </Button>
            </>
          ) : (
            <>
              <StepIcon>
                <Check size={20} />
              </StepIcon>
              <p className="amk-auth__panel-eyebrow">PERSONAL SETUP COMPLETE</p>
              <h2>Review your setup.</h2>
              <p className="amk-auth__muted">
                {snapshot.canManage && !snapshot.company.complete
                  ? "Next, complete the company setup once so approved knowledge and the CRM can be inherited by the team."
                  : `You are joining ${snapshot.organisationName} with your own Assistant identity, memory, CRM context and Review Everything as your safe starting point.`}
              </p>
              <Button
                disabled={saving}
                onClick={() => void complete()}
                className={`mt-7 ${blueButton}`}
              >
                {saving ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                Continue <ArrowRight className="ml-2 size-4" />
              </Button>
            </>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
            >
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
