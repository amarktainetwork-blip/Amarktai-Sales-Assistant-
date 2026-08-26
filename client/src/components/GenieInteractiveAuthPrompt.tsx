import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type InteractiveCommissioning = {
  interactiveAuthRequired?: boolean;
  verificationExpired?: boolean;
  humanStatus?: string;
};
type PreOtpReadiness = {
  ready: boolean;
  states: Record<"browserReady" | "genieLoginReachable" | "secureSignInReady" | "sessionHandoffReady", boolean>;
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

export default function GenieInteractiveAuthPrompt({
  organisationId,
  enabled,
}: {
  organisationId?: number;
  enabled: boolean;
}) {
  const systems = trpc.connectedSystems.list.useQuery(
    { organisationId: organisationId ?? 0 },
    { enabled: Boolean(enabled && organisationId), retry: false }
  );
  const genie = useMemo(
    () => systems.data?.find(system => system.provider === "genie"),
    [systems.data]
  );
  const [challenge, setChallenge] = useState<InteractiveCommissioning | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const [readiness, setReadiness] = useState<PreOtpReadiness | null>(null);

  useEffect(() => {
    if (!enabled || !genie?.id) {
      setChallenge(null);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const result = await jsonRequest(
          `/api/connected-system-admin/${genie.id}/commissioning`
        );
        if (cancelled) return;
        const job = (result.job || null) as InteractiveCommissioning | null;
        setChallenge(job?.interactiveAuthRequired ? job : null);
      } catch {
        // Onboarding already reports ordinary commissioning failures. This
        // helper only surfaces the human-in-the-loop Genie verification step.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, genie?.id]);

  if (!enabled || !genie?.id || (!approved && !challenge?.interactiveAuthRequired)) return null;

  async function verify() {
    if (!code.trim() || !genie?.id) return;
    try {
      setPending(true);
      setError("");
      await jsonRequest(
        `/api/connected-system-admin/${genie.id}/interactive-auth/verify`,
        { method: "POST", body: JSON.stringify({ code: code.trim() }) }
      );
      setCode("");
      setApproved(true);
      setChallenge(null);
      toast.success("Genie sign-in approved. CRM setup is continuing.");
      window.setTimeout(() => setApproved(false), 6_000);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (/MANAGEMENT_ELEVATION_/.test(detail))
        setError(
          "Sensitive management mode expired. Reconfirm your Amarktai password above, then submit the Genie code again."
        );
      else if (/CONTROLS_NOT_READY|VERIFICATION_NOT_CONFIRMED/.test(detail))
        setError(
          "Genie is still finishing the verification screen. Keep this same code, wait a few seconds, then press Verify again. Do not request a new code."
        );
      else if (/EXPIRED|CHALLENGE_REQUIRED/.test(detail))
        setError("That Genie verification request expired. Request a new code below.");
      else if (/REJECTED|INVALID/.test(detail))
        setError("Genie did not accept that code. Check the newest code and try again.");
      else if (/GENIE_PERSISTENT_PROFILE_IN_USE/.test(detail))
        setError("This deployment's trusted Genie browser is bound to a different CRM connection. Amarktai blocked the session from being shared.");
      else if (/GENIE_SESSION_REPLAY_FAILED|GENIE_PERSISTENT_PROFILE_UNAVAILABLE|GENIE_AUTHENTICATED_PAGE_UNAVAILABLE/.test(detail))
        setError("Genie accepted the sign-in, but the exact approved browser tab is no longer usable. Do not request repeated codes; the browser runtime needs attention.");
      else if (/CALIBRATION_REQUIRED/.test(detail))
        setError(
          "Amarktai can still see the live Genie verification session but could not safely map the verification controls. Keep this code and retry Verify once; do not request a new code unless Amarktai says the challenge expired."
        );
      else setError("Genie verification could not be completed. Retry Verify once before requesting another code.");
    } finally {
      setPending(false);
    }
  }

  async function requestNewCode() {
    if (!genie?.id) return;
    try {
      setPending(true);
      setError("");
      const result = (await jsonRequest(
        `/api/connected-system-admin/${genie.id}/commissioning`,
        { method: "POST", body: "{}" }
      )) as InteractiveCommissioning;
      setChallenge(result.interactiveAuthRequired ? result : null);
      setReadiness(null);
      setCode("");
      if (result.interactiveAuthRequired)
        toast.success("A fresh Genie verification code was requested.");
      else {
        setApproved(true);
        toast.success("Genie is already authenticated. CRM setup is continuing.");
        window.setTimeout(() => setApproved(false), 6_000);
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (/MANAGEMENT_ELEVATION_/.test(detail))
        setError(
          "Sensitive management mode expired. Reconfirm your Amarktai password above, then request a new Genie code."
        );
      else if (/GENIE_PERSISTENT_PROFILE_IN_USE/.test(detail))
        setError("This deployment's trusted Genie browser is already bound to another CRM connection and cannot be shared.");
      else if (/GENIE_AUTHENTICATED_PAGE_UNAVAILABLE/.test(detail))
        setError("The approved Genie tab is no longer available. Do not request another code until the browser runtime has been checked.");
      else setError("A new Genie verification code could not be requested yet.");
    } finally {
      setPending(false);
    }
  }

  async function checkReadiness() {
    if (!genie?.id) return;
    try {
      setPending(true);
      setError("");
      const result = await jsonRequest(`/api/connected-system-admin/${genie.id}/pre-otp`, { method: "POST", body: "{}" }) as PreOtpReadiness;
      setReadiness(result);
      toast.success("Secure Genie sign-in is ready for one fresh code.");
    } catch (cause) {
      setReadiness(null);
      setError(cause instanceof Error ? cause.message : "Secure sign-in readiness could not be proved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="fixed bottom-5 right-5 z-[100] w-[min(430px,calc(100vw-2rem))] rounded-[1.5rem] border border-[#4E8BFF]/55 bg-[#0C1E3E] p-5 text-[#EEF5FF] shadow-[0_28px_80px_rgba(0,0,0,.65)]">
      <div className="flex items-start gap-3" aria-live="polite">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#153B7A] text-[#9FC2FF]">
          <KeyRound size={20} />
        </span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.14em] text-[#83AEFF]">
            Genie sign-in verification
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-white">
            {approved
              ? "Genie sign-in approved"
              : challenge?.verificationExpired
              ? "Request a new Genie code"
              : "Enter the code Genie sent you"}
          </h2>
          <p className="mt-2 text-xs leading-5 text-[#B7CAE7]">
            {approved
              ? "The exact MFA-approved Genie tab remains active. Amarktai is now discovering and testing your CRM through that same authenticated page."
              : "Genie requires this one-time code to approve the sign-in. Amarktai does not store the code. After Genie accepts it, Amarktai keeps that exact authenticated browser tab alive for CRM discovery and later operations instead of opening a replacement tab."}
          </p>
        </div>
      </div>

      {!approved && !challenge?.verificationExpired && (
        <div className="mt-4 flex gap-2">
          <Input
            value={code}
            onChange={event => setCode(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") void verify();
            }}
            placeholder="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Genie verification code"
            className="border-white/15 bg-[#071326] font-mono text-base tracking-[.12em] text-white"
          />
          <Button
            disabled={pending || !code.trim()}
            onClick={() => void verify()}
            className="shrink-0 bg-[#1B64F2] hover:bg-[#2B76FF]"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            <span className="ml-2">Verify</span>
          </Button>
        </div>
      )}

      {!approved && challenge?.verificationExpired && <div className="mt-4 space-y-3"><div className="grid gap-2 sm:grid-cols-2">{([
        ["browserReady", "Browser ready"],
        ["genieLoginReachable", "Genie login reachable"],
        ["secureSignInReady", "Secure sign-in ready"],
        ["sessionHandoffReady", "Session handoff ready"],
      ] as const).map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-[11px]"><span>{label}</span><span className={readiness?.states[key] ? "font-bold text-emerald-200" : "text-[#7896C1]"}>{readiness?.states[key] ? "Ready" : "Not checked"}</span></div>)}</div><Button variant="outline" disabled={pending} onClick={() => void checkReadiness()} className="w-full border-white/15 bg-white/5 text-white">{pending ? "Checking readiness…" : "Check secure sign-in readiness"}</Button></div>}

      {!approved && error && (
        <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-400/[.07] p-3 text-xs leading-5 text-amber-100">
          {error}
        </p>
      )}

      {!approved && <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[#8FA9CF]">
          Use the newest code Genie sent to the account owner.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !readiness?.ready}
          onClick={() => void requestNewCode()}
          className="shrink-0 border-white/15 bg-white/5 text-white hover:bg-white/10"
        >
          <RefreshCw className="mr-2 size-3.5" />
          New code
        </Button>
      </div>}
    </aside>
  );
}
