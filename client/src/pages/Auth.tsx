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
import "./final-auth.css";

const AUTH_PHOTO =
  "https://images.pexels.com/photos/7679563/pexels-photo-7679563.jpeg?cs=srgb&dl=pexels-mikhail-nilov-7679563.jpg&fm=jpg";

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
          alt="Sales professionals collaborating with technology in a bright office"
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
                <CheckCircle2 size={16} /> CRM sign-in stays between you and your CRM
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
          {pending ? "Activating…" : "Activate account"} <ArrowRight size={17} />
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
      toast.success("Account created. Complete email verification to continue.");
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
        label="Name"
        value={name}
        onChange={setName}
        autoComplete="name"
      />
      <Field
        name="register-email"
        label="Email"
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
      <button disabled={register.isPending} className="amk-auth__primary">
        {register.isPending ? "Creating…" : "Create account"}{" "}
        <ArrowRight size={17} />
      </button>
      <button
        type="button"
        onClick={() => navigate("/auth")}
        className="amk-auth__link"
      >
        Already have an account? Sign in
      </button>
      <Fineprint />
    </form>
  );
}

function PasswordRecoveryForm() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const request = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => {
      toast.success(
        "If that account is eligible, a recovery link has been sent."
      );
      navigate("/auth");
    },
    onError: () => {
      toast.success(
        "If that account is eligible, a recovery link has been sent."
      );
      navigate("/auth");
    },
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        request.mutate({ email });
      }}
      className="amk-auth-form"
    >
      <p className="amk-auth__muted">
        Enter your email. If the account is eligible, a short-lived recovery
        link will be sent.
      </p>
      <Field
        name="recovery-email"
        label="Email"
        value={email}
        onChange={setEmail}
        type="email"
        autoComplete="email"
      />
      <button disabled={request.isPending} className="amk-auth__primary">
        {request.isPending ? "Requesting…" : "Send recovery link"}{" "}
        <ArrowRight size={17} />
      </button>
      <button
        type="button"
        onClick={() => navigate("/auth")}
        className="amk-auth__link"
      >
        Back to sign in
      </button>
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
      toast.success("Password reset. Complete access verification to continue.");
      navigate("/dashboard");
    },
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "Your password could not be reset. The recovery link may have expired; request a new one and try again."
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
      <p className="amk-auth__muted">
        Choose a new password. This recovery link expires after 30 minutes and
        becomes invalid once used.
      </p>
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
      <button disabled={reset.isPending} className="amk-auth__primary">
        {reset.isPending ? "Resetting…" : "Reset password"}{" "}
        <ArrowRight size={17} />
      </button>
      <Fineprint />
    </form>
  );
}

function LocalLoginForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const login = trpc.auth.localLogin.useMutation({
    onSuccess: () => {
      toast.success("Signed in. Complete access verification to continue.");
      navigate("/dashboard");
    },
    onError: error =>
      toast.error(
        friendlyError(
          error,
          "Sign-in was not successful. Check your email and password and try again."
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
        label="Email"
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
      <button
        type="submit"
        disabled={login.isPending}
        className="amk-auth__primary"
      >
        {login.isPending ? "Signing in…" : "Open Amarktai Sales Assistant"}{" "}
        <ArrowRight size={17} />
      </button>
      <div className="amk-auth__links">
        <button
          type="button"
          onClick={() => navigate("/auth?mode=forgot")}
          className="amk-auth__link"
        >
          Forgot password?
        </button>
        <button
          type="button"
          onClick={() => navigate("/auth?mode=register")}
          className="amk-auth__link"
        >
          Create account
        </button>
      </div>
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
  const id = `auth-${name}`;
  return (
    <label className="amk-auth-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        minLength={type === "password" ? 12 : undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

function Fineprint() {
  return (
    <p className="amk-auth__fineprint">
      Your Amarktai account is protected separately from any CRM sign-in.
    </p>
  );
}
