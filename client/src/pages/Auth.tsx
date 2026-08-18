/**
 * Signal Garden style reminder: security should feel optimistic and focused—deep ink, vivid signal accents,
 * tactile shapes, clear hierarchy, and no intimidating cyber-security clichés.
 */
import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronLeft, KeyRound, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";

const securityImage = "/manus-storage/amarktai-security-orbit_503e7f2b.png";

export default function Auth() {
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);

  function updateCode(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
    setVerified(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === 6) setVerified(true);
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="Secure access information">
        <div className="auth-story__texture texture-dots" aria-hidden="true" />
        <div className="auth-story__topline">
          <Link href="/" className="auth-back">
            <ChevronLeft size={16} /> Back to the signal
          </Link>
          <BrandMark inverse />
        </div>

        <div className="auth-story__copy">
          <div className="eyebrow eyebrow--lime">
            <ShieldCheck size={14} /> A quieter kind of secure
          </div>
          <h1>Good sales work deserves a safe home.</h1>
          <p>
            Your assistant can handle the momentum. Two-factor sign-in keeps your conversations and relationships in the right hands.
          </p>
          <div className="auth-story__trust">
            <span><CheckCircle2 size={17} /> A short code, a stronger gate.</span>
            <span><CheckCircle2 size={17} /> Clear by design, not by accident.</span>
          </div>
        </div>

        <div className="auth-story__art-wrap">
          <div className="signal-chip signal-chip--left"><Sparkles size={15} /> private workspace</div>
          <img className="auth-story__art" src={securityImage} alt="Abstract orbiting security shield illustration" />
          <div className="signal-chip signal-chip--right"><KeyRound size={15} /> one more signal</div>
        </div>

        <p className="auth-story__footer">Part of Amarktai Network</p>
      </section>

      <section className="auth-action">
        <div className="auth-action__grain" aria-hidden="true" />
        <div className="auth-card">
          <div className="auth-card__icon"><Mail size={20} /></div>
          <p className="eyebrow eyebrow--ink">Nearly there</p>
          <h2>Check your inbox.</h2>
          <p className="auth-card__intro">We sent a six-digit sign-in code to <strong>hello@amarktai.co.za</strong>.</p>

          <form onSubmit={handleSubmit} className="auth-form">
            <label htmlFor="two-factor-code">Your verification code</label>
            <input
              id="two-factor-code"
              className="auth-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => updateCode(event.target.value)}
              placeholder="000000"
              aria-describedby="code-help"
            />
            <p id="code-help" className="auth-form__help">Enter the six digits exactly as they appear in your email.</p>
            <button type="submit" className="button button--ink button--wide" disabled={code.length !== 6}>
              Continue securely <ArrowRight size={18} />
            </button>
          </form>

          {verified ? (
            <div className="verification-notice" role="status">
              <CheckCircle2 size={20} />
              <span><strong>Code recognised.</strong> This presentation screen is ready to connect to your preferred identity provider.</span>
            </div>
          ) : (
            <button type="button" className="text-button" onClick={() => setCode("")}>I need a fresh code</button>
          )}

          <p className="auth-card__fineprint">By continuing, you agree to protect access to your team’s customer conversations.</p>
        </div>
      </section>
    </main>
  );
}

