import { BrandMark } from "@/components/BrandMark";
import { startLogin } from "@/const";
import { friendlyError } from "@/lib/friendlyError";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
const AUTH_PHOTO =
  "https://images.pexels.com/photos/8485714/pexels-photo-8485714.jpeg?auto=compress&cs=tinysrgb&w=1800";

export default function Auth() {
  const mode = trpc.auth.mode.useQuery();
  const query =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const invite = query.get("invite");
  const reset = query.get("reset");
  const authView = query.get("mode");
  const isRegister = authView === "register";

  const localPanel = reset ? (
    <ResetPasswordForm token={reset} />
  ) : isRegister ? (
    <LocalRegistrationForm />
  ) : authView === "forgot" ? (
    <PasswordRecoveryForm />
  ) : (
    <LocalLoginForm />
  );

  const title = reset
    ? "Choose a new password."
    : isRegister
      ? "Create your Amarktai account."
      : authView === "forgot"
        ? "Recover your account."
        : "Welcome back.";
  const eyebrow = isRegister
    ? "CREATE ACCOUNT"
    : authView === "forgot" || reset
      ? "ACCOUNT RECOVERY"
      : "SECURE SIGN IN";

  return (
    <main className={`amk-auth${isRegister ? " amk-auth--register" : ""}`}>
      <section className="amk-auth__visual">
        <img
          src={AUTH_PHOTO}
          alt="Professional saleswoman working in a bright modern office"
        />
        <div className="amk-auth__shade" />
        <div className="amk-auth__visual-inner">
          <div className="amk-auth__topline">
            <Link href="/" className="amk-auth__back">
              <ChevronLeft size={16} /> Back to website
            </Link>
            <BrandMark inverse />
          </div>
          <div className="amk-auth__message">
            <p className="amk-auth__eyebrow">
              <ShieldCheck size={15} /> AMARKTAI NETWORK · SALES ASSISTANT
            </p>
            <h1>
              Your customer context.
              <br />
              Your sales day.
            </h1>
            <p>
              Secure access to company knowledge, CRM context, calls and
              follow-through.
            </p>
            <div className="amk-auth__proof">
              <span>
                <CheckCircle2 size={16} /> Personal user account
              </span>
              <span>
                <CheckCircle2 size={16} /> Second-factor verification
              </span>
              <span>
                <CheckCircle2 size={16} />
                {"CRM sign-in stays between you and your CRM"}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="amk-auth__form-side">
        <div className="amk-auth__mobile-brand">
          <BrandMark />
        </div>
        <div className="amk-auth__form-wrap">
          {invite ? (
            <InviteAcceptForm token={invite} />
          ) : (
            <>
              <p className="amk-auth__panel-eyebrow">{eyebrow}</p>
              <h2>{title}</h2>
              {mode.isLoading ? (
                <p className="amk-auth__muted">Loading secure access…</p>
              ) : mode.data?.local ? (
                localPanel
              ) : (
                <ManagedSignIn />
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function InviteAcceptForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [acceptedEmail, setAcceptedEmail] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) return toast.error("The passwords do not match.");
    setPending(true);
    try {
      const response = await fetch("/api/team-admin/accept-invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        email?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Invitation could not be accepted.");
      window.history.replaceState({}, "", "/auth");
      setAcceptedEmail(body.email ?? "");
      toast.success(
        "Your Amarktai Network account is ready. Sign in to continue."
      );
    } catch (error) {
      toast.error(
        friendlyError(
          error,
          "That invitation could not be accepted. Check that the invitation is still valid and try again."
        )
      );
    } finally {
      setPending(false);
    }
  }

  if (acceptedEmail !== null) {
    return (
      <>
        <p className="amk-auth__panel-eyebrow">INVITATION ACCEPTED</p>
        <h2>Your account is ready.</h2>
        <LocalLoginForm initialEmail={acceptedEmail} />
      </>
    );
  }

  return (
    <>
      <div className="amk-auth__icon">
        <UserPlus size={20} />
      </div>
      <p className="amk-auth__panel-eyebrow">TEAM INVITATION</p>
      <h2>Create your password.</h2>
      <p className="amk-auth__muted">
        This setup link is short-lived and becomes unusable after your password
        is created.
      </p>
      <form onSubmit={submit} className="amk-auth-form">
        <Field
          name="invite-password"
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
        />
        <Field
          name="invite-confirm-password"
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          type="password"
          autoComplete="new-password"
        />
        <button type="submit" disabled={pending} className="amk-auth__primary">
          {pending ? "Activating…" : "Activate account"}{" "}
          <ArrowRight size={17} />
        </button>
      </form>
      <Fineprint />
    </>
  );
}

function ManagedSignIn() {
  return (
    <>
      <p className="amk-auth__muted">
        Continue through your organisation's secure identity flow to open
        Amarktai Sales Assistant.
      </p>
      <button
        onClick={() => startLogin()}
        className="amk-auth__primary amk-auth__primary--spaced"
      >
        Open Amarktai Sales Assistant <ArrowRight size={17} />
      </button>
      <Fineprint />
    </>
  );
}

function LocalRegistrationForm() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const register = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success(
        "Account created. Complete email verification to continue."
      );
      navigate("/dashboard");
    },
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "Your account could not be created. Check the details and try again."
        )
      ),
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        register.mutate({ name, email, password });
      }}
      className="amk-auth-form"
    >
      <p className="amk-auth__muted">
        Create your personal Amarktai Network account. Company or team setup
        happens after secure access is verified.
      </p>
      <Field
        name="register-name"
        label="Your name"
        value={name}
        onChange={setName}
        autoComplete="name"
      />
      <Field
        name="register-email"
        label="Work email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
      />
      <Field
        name="register-password"
        label="Password"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="new-password"
      />
      <button
        type="submit"
        disabled={register.isPending}
        className="amk-auth__primary"
      >
        {register.isPending ? "Creating account…" : "Create account"}
        <ArrowRight size={17} />
      </button>
      <p className="amk-auth__switch">
        Already have an account? <Link href="/auth">Sign in</Link>
      </p>
      <Fineprint />
    </form>
  );
}

function LocalLoginForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const login = trpc.auth.localLogin.useMutation({
    onSuccess: () => navigate("/dashboard"),
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "Sign in was not accepted. Check your email and password and try again."
        )
      ),
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        login.mutate({ email, password });
      }}
      className="amk-auth-form"
    >
      <Field
        name="login-email"
        label="Email address"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
      />
      <Field
        name="login-password"
        label="Password"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
      />
      <div className="amk-auth__forgot-row">
        <Link href="/auth?mode=forgot">Forgot password?</Link>
      </div>
      <button
        type="submit"
        disabled={login.isPending}
        className="amk-auth__primary"
      >
        {login.isPending ? "Signing in…" : "Sign in"} <ArrowRight size={17} />
      </button>
      <p className="amk-auth__switch">
        New to Amarktai?{" "}
        <Link href="/auth?mode=register">Create an account</Link>
      </p>
      <Fineprint />
    </form>
  );
}

function PasswordRecoveryForm() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const recovery = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "The recovery request could not be completed. Try again shortly."
        )
      ),
  });

  if (sent)
    return (
      <>
        <p className="amk-auth__muted">
          If that address belongs to an Amarktai account, a recovery link has
          been sent. Check your inbox and spam folder.
        </p>
        <button
          className="amk-auth__secondary"
          onClick={() => navigate("/auth")}
        >
          Back to sign in
        </button>
      </>
    );

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        recovery.mutate({ email });
      }}
      className="amk-auth-form"
    >
      <p className="amk-auth__muted">
        Enter your account email. If it matches an account, we’ll send a
        short-lived reset link.
      </p>
      <Field
        name="recovery-email"
        label="Account email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
      />
      <button
        type="submit"
        disabled={recovery.isPending}
        className="amk-auth__primary"
      >
        {recovery.isPending ? "Sending…" : "Send recovery link"}
      </button>
      <p className="amk-auth__switch">
        <Link href="/auth">Back to sign in</Link>
      </p>
      <Fineprint />
    </form>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      toast.success("Password updated. Sign in with your new password.");
      window.history.replaceState({}, "", "/auth");
      navigate("/auth");
    },
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "That reset link could not be used. Request a fresh recovery link and try again."
        )
      ),
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (password !== confirm)
          return toast.error("The passwords do not match.");
        reset.mutate({ token, password });
      }}
      className="amk-auth-form"
    >
      <Field
        name="reset-password"
        label="New password"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="new-password"
      />
      <Field
        name="reset-confirm-password"
        label="Confirm password"
        value={confirm}
        onChange={setConfirm}
        type="password"
        autoComplete="new-password"
      />
      <button
        type="submit"
        disabled={reset.isPending}
        className="amk-auth__primary"
      >
        {reset.isPending ? "Updating…" : "Update password"}
      </button>
      <Fineprint />
    </form>
  );
}

function Field({
  name,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="amk-auth-field" htmlFor={name}>
      <span>{label}</span>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
      />
    </label>
  );
}

function Fineprint() {
  return (
    <p className="amk-auth__fineprint">
      By continuing, you agree to the Amarktai Network Terms and Privacy Policy.
    </p>
  );
}
