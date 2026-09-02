import {
  CheckCircle2,
  Database,
  MessageSquareText,
  PhoneCall,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export function MarketingVisual({
  variant,
}: {
  variant: "hero" | "knowledge" | "call" | "about";
}) {
  if (variant === "knowledge") {
    return (
      <div className="amk-product-visual amk-product-visual--knowledge" aria-label="Company knowledge review example">
        <div className="amk-product-visual__topline">
          <span className="amk-visual-kicker">COMPANY KNOWLEDGE</span>
          <span className="amk-visual-status"><ShieldCheck size={14} /> Manager reviewed</span>
        </div>
        <h3>Your team should not have to teach the Assistant the business one person at a time.</h3>
        <div className="amk-knowledge-grid">
          {[
            ["Products & services", "What you sell and how you describe it"],
            ["Customer fit", "Who the offer is right for"],
            ["Proof & credentials", "Facts the team can safely rely on"],
            ["Policies", "What can and cannot be promised"],
          ].map(([title, body]) => (
            <div className="amk-knowledge-card" key={title}>
              <CheckCircle2 size={17} />
              <div><strong>{title}</strong><span>{body}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "call") {
    return (
      <div className="amk-product-visual amk-product-visual--call" aria-label="Before during and after the call workflow">
        <div className="amk-product-visual__topline">
          <span className="amk-visual-kicker">ONE CUSTOMER STORY</span>
          <span className="amk-visual-status"><PhoneCall size={14} /> Call workflow</span>
        </div>
        <div className="amk-call-flow">
          <div className="amk-call-step">
            <span>BEFORE</span>
            <strong>Know the customer</strong>
            <p>CRM history, open tasks, opportunity and useful business context.</p>
          </div>
          <div className="amk-call-step is-live">
            <span>DURING</span>
            <strong>Stay in the conversation</strong>
            <p>Consented transcription and timely help without hunting across screens.</p>
          </div>
          <div className="amk-call-step">
            <span>AFTER</span>
            <strong>Finish what was agreed</strong>
            <p>Notes, callback, message or CRM update prepared for Review.</p>
          </div>
        </div>
      </div>
    );
  }

  if (variant === "about") {
    return (
      <div className="amk-product-visual amk-product-visual--about" aria-label="AmarktAI connects the gaps between sales tools">
        <div className="amk-about-stack">
          <div><Database size={18} /><span><strong>Your CRM</strong><small>Customer record</small></span></div>
          <div><Sparkles size={18} /><span><strong>Company knowledge</strong><small>What the team can trust</small></span></div>
          <div><PhoneCall size={18} /><span><strong>Conversation</strong><small>What is happening now</small></span></div>
          <div className="is-highlight"><CheckCircle2 size={18} /><span><strong>AmarktAI follow-through</strong><small>The agreed next action gets finished</small></span></div>
        </div>
      </div>
    );
  }

  return (
    <div className="amk-product-visual amk-product-visual--hero" aria-label="AmarktAI Sales Assistant product example">
      <div className="amk-product-window">
        <div className="amk-product-window__bar">
          <div><span></span><span></span><span></span></div>
          <strong>Sales Assistant</strong>
          <span className="amk-visual-status"><ShieldCheck size={14} /> Review everything</span>
        </div>
        <div className="amk-product-window__body">
          <aside className="amk-product-window__context">
            <span className="amk-visual-kicker">THIS CUSTOMER</span>
            <h3>Sarah Morgan</h3>
            <p>Existing customer · Renewal conversation</p>
            <dl>
              <div><dt>CRM</dt><dd>History ready</dd></div>
              <div><dt>Open task</dt><dd>Follow-up call</dd></div>
              <div><dt>Opportunity</dt><dd>Active</dd></div>
            </dl>
          </aside>
          <div className="amk-product-window__assistant">
            <div className="amk-assistant-bubble">
              <MessageSquareText size={18} />
              <div>
                <span>AMARKTAI ASSISTANT</span>
                <p>Sarah asked about timing last time. The current opportunity is still active and today’s task is the follow-up call.</p>
              </div>
            </div>
            <div className="amk-next-action">
              <span>NEXT USEFUL ACTION</span>
              <strong>Prepare the call with the current customer context</strong>
              <p>After the conversation, the confirmed outcome can become the notes and follow-through.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
