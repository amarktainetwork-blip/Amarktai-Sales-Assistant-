/**
 * Signal Garden style reminder: build an asymmetric sales-signal journey with joyful editorial color,
 * bold type, paper-cut overlaps, and direct, observant copy. Every detail should make automation feel human.
 */
import { useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Menu,
  MessageCircleMore,
  MoveUpRight,
  Play,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";

const heroImage = "/manus-storage/amarktai-hero-sales-signal_6cce2a2c.png";
const flowImage = "/manus-storage/amarktai-conversation-flow_71f75f8b.png";
const securityImage = "/manus-storage/amarktai-security-orbit_503e7f2b.png";

const navItems = [
  { label: "How it moves", target: "how-it-moves" },
  { label: "The assistant", target: "the-assistant" },
  { label: "Security", target: "security" },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);

  function scrollToSection(target: string) {
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  }

  return (
    <main className="site-shell">
      <div className="announce-bar">
        <span className="announce-bar__spark">✦</span>
        <p>For teams who prefer moving leads to moving tabs.</p>
        <button onClick={() => scrollToSection("how-it-moves")}>See the rhythm <ArrowDownRight size={15} /></button>
      </div>

      <header className="site-header">
        <BrandMark />
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.target} onClick={() => scrollToSection(item.target)}>{item.label}</button>
          ))}
        </nav>
        <div className="site-header__actions">
          <Link className="login-link" href="/auth">Sign in</Link>
          <button className="button button--lime button--nav" onClick={() => scrollToSection("start")}>Meet your assistant <ArrowRight size={16} /></button>
          <button
            className="menu-button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
        {menuOpen && (
          <div className="mobile-nav">
            {navItems.map((item) => <button key={item.target} onClick={() => scrollToSection(item.target)}>{item.label} <ChevronRight size={16} /></button>)}
            <Link href="/auth" onClick={() => setMenuOpen(false)}>Sign in <ArrowRight size={16} /></Link>
          </div>
        )}
      </header>

      <section className="hero-section" id="start">
        <div className="hero-curve hero-curve--coral" aria-hidden="true" />
        <div className="hero-curve hero-curve--blue" aria-hidden="true" />
        <div className="hero-copy">
          <div className="eyebrow eyebrow--ink"><Sparkles size={14} /> Your all-day sales sidekick</div>
          <h1>Your pipeline called. <em>It wants momentum.</em></h1>
          <p className="hero-copy__lead">Amarktai Sales Assistant turns every warm signal into a well-timed, human-sounding next move.</p>
          <div className="hero-copy__buttons">
            <button className="button button--ink" onClick={() => scrollToSection("how-it-moves")}>Give every lead a next move <ArrowRight size={18} /></button>
            <button className="play-button" onClick={() => scrollToSection("the-assistant")}><span><Play size={14} fill="currentColor" /></span> See it in motion</button>
          </div>
          <div className="hero-copy__proof">
            <div className="mini-bloom"><span /><span /><span /><span /></div>
            <p><strong>Less chasing.</strong> More showing up for the moments that matter.</p>
          </div>
        </div>

        <div className="hero-art" aria-label="Amarktai sales assistant in action">
          <div className="hero-art__frame">
            <img src={heroImage} alt="Sales professional surrounded by colorful automation signals" />
            <span className="frame-signal-bud frame-signal-bud--one" aria-hidden="true" />
            <span className="frame-signal-bud frame-signal-bud--two" aria-hidden="true" />
          </div>
          <div className="hero-art__track hero-art__track--one" aria-hidden="true"><i /><i /><i /></div>
          <div className="hero-art__status status-card status-card--top"><span className="status-card__dot" /> Hot signal caught <MoveUpRight size={16} /></div>
          <div className="hero-art__status status-card status-card--bottom"><div className="avatar-stack"><b>Y</b><b>A</b><b>M</b></div><span>Three good next moves</span></div>
          <div className="hero-art__brief" aria-label="Assistant brief preview">
            <span><Sparkles size={13} /> Assistant brief</span>
            <strong>Yara replied after the pricing note.</strong>
            <small>Suggested next move: offer a 15-min walk-through.</small>
          </div>
          <div className="hero-art__burst" aria-hidden="true">✦</div>
        </div>
      </section>

      <section className="signal-rail" aria-label="Sales assistant benefits">
        <div><Zap size={22} /><span>Spot the warmth</span><small>Catch conversation momentum before it cools.</small></div>
        <div><MessageCircleMore size={22} /><span>Sound like you</span><small>Draft the thoughtful reply, then keep it yours.</small></div>
        <div><Clock3 size={22} /><span>Make space</span><small>Give your team back the time for real conversations.</small></div>
      </section>

      <div className="journey-connector journey-connector--from-hero" aria-hidden="true"><span /><i /><b>follow the warm signals</b></div>

      <section id="how-it-moves" className="movement-section">
        <div className="section-intro section-intro--offset">
          <div>
            <p className="eyebrow eyebrow--orange">How it moves</p>
            <h2>Every conversation has a pulse. We help you keep it.</h2>
          </div>
          <p>The assistant listens for useful context, suggests a thoughtful next move, and leaves the real relationship building to your team.</p>
        </div>

        <div className="movement-grid">
          <article className="process-card process-card--ink process-card--start">
            <span className="process-card__number">01</span>
            <div className="process-card__icon"><Sparkles size={23} /></div>
            <h3>Spot the signal.</h3>
            <p>From a warm reply to a quiet gap, the assistant brings the useful moments to the surface.</p>
            <div className="signal-line"><i /><i /><i /><b /></div>
          </article>
          <article className="process-card process-card--lime process-card--mid">
            <span className="process-card__number">02</span>
            <div className="process-card__icon"><MessageCircleMore size={23} /></div>
            <h3>Shape the reply.</h3>
            <p>Build a message with the right context and a tone that still sounds like your team.</p>
            <div className="message-snippet"><span>Draft ready</span><b>“Sounds good — how does Thursday look?”</b><i>send with care <ArrowRight size={13} /></i></div>
          </article>
          <article className="process-card process-card--orange process-card--end">
            <span className="process-card__number">03</span>
            <div className="process-card__icon"><Check size={23} /></div>
            <h3>Keep moving.</h3>
            <p>Small, timely follow-through adds up to a pipeline that actually feels alive.</p>
            <div className="check-trail"><span><Check size={13} /> context saved</span><span><Check size={13} /> next move queued</span></div>
          </article>
        </div>
        <div className="journey-connector journey-connector--within" aria-hidden="true"><span /><i /><i /><span /></div>
      </section>

      <section id="the-assistant" className="assistant-section">
        <div className="assistant-section__art">
          <div className="image-stamp image-stamp--one">Right time. Right tone.</div>
          <img src={flowImage} alt="Colorful conceptual illustration of a conversation becoming a confirmed next step" />
          <div className="image-stamp image-stamp--two"><Sparkles size={17} /> context, carried forward</div>
          <div className="context-fragment">
            <span><span className="context-fragment__dot" /> Warm signal</span>
            <strong>Asked about onboarding time</strong>
            <small>Context note saved · 2 minutes ago</small>
          </div>
        </div>
        <div className="assistant-section__copy">
          <p className="eyebrow eyebrow--coral">The assistant</p>
          <h2>It remembers the thread, so you can keep the spark.</h2>
          <p>From first hello to “let’s do this”, Amarktai helps your team pick up a conversation without losing the human details that make it matter.</p>
          <ul className="check-list">
            <li><span><Check size={15} /></span> A clear brief before each follow-up.</li>
            <li><span><Check size={15} /></span> Thoughtful drafts that invite a response.</li>
            <li><span><Check size={15} /></span> Small prompts that keep no lead forgotten.</li>
          </ul>
          <button className="text-link" onClick={() => scrollToSection("security")}>See how we protect the pace <ArrowRight size={16} /></button>
        </div>
      </section>

      <div className="journey-connector journey-connector--between" aria-hidden="true"><span /><i /><i /><i /><span /></div>

      <section id="security" className="security-section">
        <div className="security-section__content">
          <p className="eyebrow eyebrow--lime"><ShieldCheck size={14} /> Security, with a softer edge</p>
          <h2>Strong protection. No scary theatre.</h2>
          <p>Sign in with a second signal and keep your customer relationships, notes, and conversations where they belong: with your team.</p>
          <Link href="/auth" className="button button--cream">Preview the two-factor sign-in <ArrowRight size={18} /></Link>
        </div>
        <div className="security-section__visual">
          <div className="security-section__ring" aria-hidden="true" />
          <img src={securityImage} alt="Abstract colorful security orbit" />
          <div className="security-section__badge"><ShieldCheck size={18} /> one more layer, made simple</div>
        </div>
      </section>

      <section className="closing-section">
        <div className="closing-section__burst" aria-hidden="true">✦</div>
        <p className="eyebrow eyebrow--ink">Ready when the next signal lands</p>
        <h2>Give every good lead its best next move.</h2>
        <p>Bring a little more rhythm, context, and care to every conversation in your pipeline.</p>
        <Link href="/auth" className="button button--ink">Meet the assistant <ArrowRight size={18} /></Link>
      </section>

      <footer className="site-footer">
        <BrandMark inverse />
        <div className="site-footer__links">
          <button onClick={() => scrollToSection("how-it-moves")}>How it moves</button>
          <button onClick={() => scrollToSection("security")}>Security</button>
          <Link href="/auth">Sign in</Link>
        </div>
        <p>© 2026 Amarktai Sales Assistant. <strong>Part of Amarktai Network.</strong></p>
      </footer>
    </main>
  );
}
