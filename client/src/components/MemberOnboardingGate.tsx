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
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status}).`);
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
    if (snapshot.company.complete && (needsIdentity || needsMailbox)) return true;
    return false;
  }, [
    loading,
    snapshot,
    error,
    companySetupAllowed,
    needsIdentity,
    needsMailbox,
  ]);

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
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Onboarding could not be completed."
      );
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <div className="fixed inset-0 z-[250] grid place-items-center bg-[#F4F7FA] text-[#26354A]">
        <div className="flex items-center gap-3 text-sm font-bold">
          <Loader2 className="size-5 animate-spin text-[#2F6FED]" /> Preparing
          your workspace…
        </div>
      </div>
    );

  if (!snapshot)
    return (
      <div className="fixed inset-0 z-[250] grid place-items-center bg-[#F4F7FA] p-6 text-[#26354A]">
        <div className="w-full max-w-lg rounded-2xl border border-[#DCE4EE] bg-white p-8 shadow-sm">
          <BrandMark />
          <h1 className="mt-8 font-display text-4xl font-bold tracking-[-.05em]">
            Your workspace could not be prepared.
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#66758A]">{error}</p>
          <Button className={`mt-6 ${blueButton}`} onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );

  const personalProfileReady = Boolean(
    snapshot.member.persona &&
      snapshot.member.preferredName?.trim() &&
      snapshot.member.primaryGoal?.trim()
  );

  return (
    <div className="fixed inset-0 z-[250] overflow-y-auto bg-[#F4F7FA] text-[#26354A]">
      <div className="mx-auto min-h-screen w-full max-w-[1160px] px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex items-center justify-between border-b border-[#DCE4EE] pb-5">
          <BrandMark />
          <span className="text-[10px] font-black uppercase tracking-[.15em] text-[#7A889A]">
            Personal setup
          </span>
        </header>

        <div className="grid gap-10 py-10 lg:grid-cols-[.72fr_1.28fr] lg:items-start lg:py-14">
          <section className="lg:sticky lg:top-10">
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#2F6FED]">
              Your Amarktai workspace
            </p>
            <h1 className="mt-4 max-w-xl font-display text-4xl font-bold leading-[.98] tracking-[-.055em] sm:text-5xl">
              Set up the person behind the sales work.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#66758A]">
              Company knowledge can be shared. Your name, sales goal, working
              style, mailbox and Assistant memory belong to your own account.
            </p>
            <div className="mt-7 space-y-3 text-sm text-[#52647A]">
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[#2F6FED]" /> Your
                own Amarktai login and Assistant memory
              </p>
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[#2F6FED]" />
                Shared, manager-approved company knowledge
              </p>
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[#2F6FED]" /> Your
                own CRM identity and Microsoft mailbox
              </p>
            </div>
          </section>

          <section className="rounded-3xl border border-[#DCE4EE] bg-white p-6 shadow-[0_18px_50px_rgba(38,53,74,.06)] sm:p-8">
            {snapshot.member.complete &&
            snapshot.canManage &&
            !snapshot.company.complete ? (
              <>
                <StepIcon>
                  <Building2 size={19} />
                </StepIcon>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  Personal setup complete
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.045em]">
                  Now set up the company once.
                </h2>
                <p className="mt-4 text-sm leading-6 text-[#66758A]">
                  Add the company details, let Amarktai learn the authorised
                  public website, approve the useful knowledge and connect the
                  CRM. Future team members inherit that company setup while
                  keeping their own personal workspace.
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
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  01 / About you
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.045em]">
                  Make the Assistant yours.
                </h2>
                <p className="mt-3 text-sm leading-6 text-[#66758A]">
                  These details help Amarktai address you naturally and keep its
                  recommendations aligned with the way you actually sell.
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
                      onClick={() => setPersona(option)}
                      className={`rounded-xl border p-4 text-left transition ${persona === option ? "border-[#7FA4E8] bg-[#EEF4FF] text-[#2459C2]" : "border-[#DCE4EE] bg-white text-[#40516A] hover:border-[#AFC3E8] hover:bg-[#F8FAFD]"}`}
                    >
                      <span className="text-sm font-bold">
                        {personaLabel(option)}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="mt-6 block text-xs font-bold text-[#40516A]">
                  What should Amarktai call you?
                  <Input
                    value={preferredName}
                    onChange={event => setPreferredName(event.target.value)}
                    placeholder="Your preferred first name"
                    autoComplete="given-name"
                    className="mt-2 rounded-xl border-[#CBD7E6] bg-white text-[#26354A]"
                  />
                </label>
                <label className="mt-5 block text-xs font-bold text-[#40516A]">
                  What is the main result you want from Amarktai?
                  <Input
                    value={primaryGoal}
                    onChange={event => setPrimaryGoal(event.target.value)}
                    placeholder="For example: never miss a follow-up and stay focused on the right customers"
                    className="mt-2 rounded-xl border-[#CBD7E6] bg-white text-[#26354A]"
                  />
                </label>
                <label className="mt-5 block text-xs font-bold text-[#40516A]">
                  Anything important about how you prefer to work?
                  <Textarea
                    value={workingStyle}
                    onChange={event => setWorkingStyle(event.target.value)}
                    placeholder="Optional — your working style, priorities or preferences"
                    className="mt-2 min-h-24 rounded-xl border-[#CBD7E6] bg-white text-[#26354A]"
                  />
                </label>
                <Button
                  disabled={
                    !persona ||
                    !preferredName.trim() ||
                    !primaryGoal.trim() ||
                    saving
                  }
                  onClick={() => void saveProfile()}
                  className={`mt-6 ${blueButton}`}
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Save and continue
                </Button>
              </>
            ) : needsIdentity ? (
              <>
                <StepIcon>
                  <UserRound size={19} />
                </StepIcon>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  02 / CRM identity
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.045em]">
                  Confirm who you are in the CRM.
                </h2>
                <p className="mt-4 text-sm leading-6 text-[#66758A]">
                  This keeps your customers, tasks, activity and reporting tied
                  to the correct salesperson without exposing another user’s
                  private workspace.
                </p>
                <div className="mt-6 grid gap-3">
                  {snapshot.identity.candidates.length ? (
                    snapshot.identity.candidates.map(candidate => (
                      <button
                        key={candidate.id}
                        disabled={saving}
                        onClick={() => void confirmIdentity(candidate.id)}
                        className="flex items-center justify-between gap-4 rounded-xl border border-[#DCE4EE] bg-[#FAFCFF] p-4 text-left transition hover:border-[#8EACEB] hover:bg-[#F2F6FF]"
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
                      your manager to link your CRM owner record to your Amarktai
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
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  03 / Your mailbox
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.045em]">
                  Connect your Outlook mailbox.
                </h2>
                <p className="mt-4 text-sm leading-6 text-[#66758A]">
                  Microsoft handles the sign-in and verification. Amarktai never
                  asks for your Outlook password. Mailbox access remains tied to
                  your own Amarktai user.
                </p>
                <Button
                  className={`mt-6 ${blueButton}`}
                  onClick={() =>
                    window.location.assign("/api/mailbox/microsoft/start")
                  }
                >
                  Connect Outlook <ArrowRight className="ml-2 size-4" />
                </Button>
                <div className="mt-7 border-t border-[#E5EAF0] pt-6">
                  <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                    04 / Autonomy &amp; approvals
                  </p>
                  <h3 className="mt-2 text-lg font-bold">Start with review.</h3>
                  <p className="mt-2 text-sm leading-6 text-[#66758A]">
                    Every customer-facing action waits for your confirmation at
                    first. You can give Amarktai more freedom later in Settings.
                  </p>
                </div>
              </>
            ) : (
              <>
                <StepIcon>
                  <Check size={20} />
                </StepIcon>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2F6FED]">
                  05 / Ready
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.045em]">
                  Your personal workspace is ready.
                </h2>
                <p className="mt-4 text-sm leading-6 text-[#66758A]">
                  {snapshot.canManage && !snapshot.company.complete
                    ? "Next, complete the company setup once so approved knowledge and the CRM can be inherited by the team."
                    : `You are joining ${snapshot.organisationName} with your own Assistant identity, memory, CRM context and Review everything as your safe starting point.`}
                </p>
                <Button
                  disabled={saving}
                  onClick={() => void complete()}
                  className={`mt-7 ${blueButton}`}
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Complete my setup <ArrowRight className="ml-2 size-4" />
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
          </section>
        </div>
      </div>
    </div>
  );
}