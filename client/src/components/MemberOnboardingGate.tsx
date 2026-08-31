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

export default function MemberOnboardingGate() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [persona, setPersona] = useState<Persona | null>(null);
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

  const browserCrm = snapshot?.personalCrm[0];
  const needsPersonalCrm = false;
  const needsIdentity = Boolean(
    snapshot?.role === "salesperson" &&
      snapshot.identity.mappingsExist &&
      !snapshot.identity.mapped
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
    if (snapshot.company.complete && (needsPersonalCrm || needsIdentity))
      return true;
    return false;
  }, [
    loading,
    snapshot,
    error,
    companySetupAllowed,
    needsPersonalCrm,
    needsIdentity,
  ]);

  if (!shouldBlock) return null;

  async function saveProfile() {
    if (!snapshot || !persona || !primaryGoal.trim()) return;
    try {
      setSaving(true);
      setError("");
      await api("/api/user-onboarding", {
        method: "PUT",
        body: JSON.stringify({
          step: 2,
          persona,
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
      <div className="fixed inset-0 z-[250] grid place-items-center bg-[#f4f1e9] text-[#171719]">
        <div className="flex items-center gap-3 text-sm font-bold">
          <Loader2 className="size-5 animate-spin" /> Preparing your workspace…
        </div>
      </div>
    );

  if (!snapshot)
    return (
      <div className="fixed inset-0 z-[250] grid place-items-center bg-[#f4f1e9] p-6 text-[#171719]">
        <div className="w-full max-w-lg border border-stone-300 bg-white p-8">
          <BrandMark />
          <h1 className="mt-8 font-display text-4xl font-bold tracking-[-.06em]">
            Your workspace could not be prepared.
          </h1>
          <p className="mt-4 text-sm leading-6 text-stone-600">{error}</p>
          <Button
            className="mt-6 bg-[#171719] text-white"
            onClick={() => void refresh()}
          >
            Retry
          </Button>
        </div>
      </div>
    );

  const personalProfileReady = Boolean(
    snapshot.member.persona && snapshot.member.primaryGoal?.trim()
  );

  return (
    <div className="fixed inset-0 z-[250] overflow-y-auto bg-[#f4f1e9] text-[#171719]">
      <div className="mx-auto min-h-screen w-full max-w-[1180px] px-5 py-8 sm:px-8 sm:py-12">
        <header className="flex items-center justify-between border-b border-stone-300 pb-6">
          <BrandMark />
          <span className="text-[10px] font-black uppercase tracking-[.16em] text-stone-500">
            First-time setup
          </span>
        </header>

        <div className="grid gap-12 py-10 lg:grid-cols-[.72fr_1.28fr] lg:py-16">
          <section>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#2466cc]">
              Your workspace
            </p>
            <h1 className="mt-4 font-display text-5xl font-bold leading-[.92] tracking-[-.07em] sm:text-6xl">
              Set up the person behind the sales work.
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-7 text-stone-600">
              Company knowledge can be shared. Your Amarktai account, assistant
              context, CRM identity belongs to you; CRM sign-in happens directly
              on the CRM website. Every person completes this once.
            </p>
            <div className="mt-8 space-y-3 text-sm text-stone-700">
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 text-[#2466cc]" /> Your own
                Amarktai login and private assistant workspace
              </p>
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 text-[#2466cc]" /> Shared
                approved company knowledge when you are on a team
              </p>
              <p className="flex gap-3">
                <Check className="mt-0.5 size-4 text-[#2466cc]" /> Your own CRM
                identity and human-controlled CRM session
              </p>
            </div>
          </section>

          <section className="border border-stone-300 bg-[#fffefa] p-6 sm:p-8">
            {snapshot.member.complete &&
            snapshot.canManage &&
            !snapshot.company.complete ? (
              <>
                <div className="grid size-11 place-items-center rounded-full bg-stone-900 text-white">
                  <Building2 size={19} />
                </div>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2466cc]">
                  Personal setup complete
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.055em]">
                  Now set up the company once.
                </h2>
                <p className="mt-4 text-sm leading-6 text-stone-600">
                  Add the company details, let Amarktai understand the public
                  website, approve the useful knowledge and connect the CRM.
                  Future team members inherit that shared company setup, but
                  still complete their own personal onboarding.
                </p>
                <Button
                  className="mt-7 h-11 bg-[#171719] text-white hover:bg-black"
                  onClick={() => window.location.assign("/company-setup")}
                >
                  Continue company setup <ArrowRight className="ml-2 size-4" />
                </Button>
              </>
            ) : !personalProfileReady ? (
              <>
                <div className="grid size-11 place-items-center rounded-full bg-stone-900 text-white">
                  <UserRound size={19} />
                </div>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2466cc]">
                  01 / About your work
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.055em]">
                  Make the workspace yours.
                </h2>
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
                      className={`border p-4 text-left transition ${persona === option ? "border-[#2466cc] bg-[#eef4ff]" : "border-stone-300 bg-white hover:border-stone-500"}`}
                    >
                      <span className="text-sm font-bold">
                        {personaLabel(option)}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="mt-6 block text-xs font-bold text-stone-700">
                  What is the main result you want from Amarktai?
                  <Input
                    value={primaryGoal}
                    onChange={event => setPrimaryGoal(event.target.value)}
                    placeholder="For example: never miss a follow-up and stay focused on the right customers"
                    className="mt-2 border-stone-300 bg-white text-[#171719]"
                  />
                </label>
                <label className="mt-4 block text-xs font-bold text-stone-700">
                  Anything important about how you prefer to work?
                  <Textarea
                    value={workingStyle}
                    onChange={event => setWorkingStyle(event.target.value)}
                    placeholder="Optional — your working style, priorities or preferences"
                    className="mt-2 min-h-24 border-stone-300 bg-white text-[#171719]"
                  />
                </label>
                <Button
                  disabled={!persona || !primaryGoal.trim() || saving}
                  onClick={() => void saveProfile()}
                  className="mt-6 h-11 bg-[#171719] text-white hover:bg-black"
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Save and continue
                </Button>
              </>
            ) : needsIdentity ? (
              <>
                <div className="grid size-11 place-items-center rounded-full bg-stone-900 text-white">
                  <UserRound size={19} />
                </div>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2466cc]">
                  03 / CRM identity
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.055em]">
                  Confirm who you are in the CRM.
                </h2>
                <p className="mt-4 text-sm leading-6 text-stone-600">
                  This keeps your customers, tasks, activity and reporting tied
                  to the correct salesperson without exposing another
                  salesperson’s private workspace.
                </p>
                <div className="mt-6 grid gap-3">
                  {snapshot.identity.candidates.length ? (
                    snapshot.identity.candidates.map(candidate => (
                      <button
                        key={candidate.id}
                        disabled={saving}
                        onClick={() => void confirmIdentity(candidate.id)}
                        className="flex items-center justify-between gap-4 border border-stone-300 bg-white p-4 text-left hover:border-[#2466cc]"
                      >
                        <span>
                          <strong className="block text-sm">
                            {candidate.displayName}
                          </strong>
                          <span className="mt-1 block text-xs text-stone-500">
                            {candidate.email || "CRM salesperson record"}
                          </span>
                        </span>
                        <ArrowRight className="size-4 text-[#2466cc]" />
                      </button>
                    ))
                  ) : (
                    <p className="border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                      Your CRM salesperson identity has not been mapped yet. Ask
                      your manager to link your CRM owner record to your
                      Amarktai user; you will not need to repeat company
                      onboarding.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="grid size-11 place-items-center rounded-full bg-stone-900 text-white">
                  <Check size={20} />
                </div>
                <p className="mt-6 text-[10px] font-black uppercase tracking-[.14em] text-[#2466cc]">
                  Ready
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-.055em]">
                  Your personal workspace is ready.
                </h2>
                <p className="mt-4 text-sm leading-6 text-stone-600">
                  {snapshot.canManage && !snapshot.company.complete
                    ? "Next, complete the company setup once so approved knowledge and the CRM can be inherited by the team."
                    : `You are joining ${snapshot.organisationName} with your own private Amarktai workspace and user-specific CRM identity.`}
                </p>
                <Button
                  disabled={saving}
                  onClick={() => void complete()}
                  className="mt-7 h-11 bg-[#171719] text-white hover:bg-black"
                >
                  {saving ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  Complete my onboarding <ArrowRight className="ml-2 size-4" />
                </Button>
              </>
            )}

            {error ? (
              <p
                role="alert"
                className="mt-5 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
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
