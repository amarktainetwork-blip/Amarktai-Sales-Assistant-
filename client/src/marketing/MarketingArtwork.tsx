import {
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

type MarketingArtworkProps = {
  variant?: "context" | "team" | "workflow" | "contact" | "knowledge";
  inverse?: boolean;
  compact?: boolean;
};

const content = {
  context: {
    eyebrow: "CUSTOMER CONTEXT",
    title: "The useful story, already assembled.",
    rows: [
      ["Interest", "IT Support Technician"],
      ["Latest reply", "Funding question · 8 min ago"],
      ["Next action", "Call today · 14:30"],
    ],
  },
  team: {
    eyebrow: "TEAM COVERAGE",
    title: "Every salesperson gets their own safety net.",
    rows: [
      ["Personal queue", "Right owner · right customer"],
      ["Shared knowledge", "Approved once · available everywhere"],
      ["Review", "Consequential actions stay visible"],
    ],
  },
  workflow: {
    eyebrow: "SALES DAY",
    title: "Know what needs you. Then move.",
    rows: [
      ["Now", "Customer reply waiting"],
      ["Next", "Callback in 27 minutes"],
      ["After", "Follow-up prepared for Review"],
    ],
  },
  contact: {
    eyebrow: "BUILT AROUND YOUR PROCESS",
    title: "Show us where the sales day gets stuck.",
    rows: [
      ["CRM", "Keep the system you already trust"],
      ["People", "Personal workspaces and identities"],
      ["Controls", "Start review-first"],
    ],
  },
  knowledge: {
    eyebrow: "COMPANY KNOWLEDGE",
    title: "Teach the business once.",
    rows: [
      ["Products", "Approved offers and course details"],
      ["Process", "How your team actually sells"],
      ["Policies", "Trusted answers and boundaries"],
    ],
  },
} as const;

export function MarketingArtwork({
  variant = "workflow",
  inverse = false,
  compact = false,
}: MarketingArtworkProps) {
  const item = content[variant];
  return (
    <div
      className={[
        "amk-brand-art",
        inverse ? "amk-brand-art--inverse" : "",
        compact ? "amk-brand-art--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={item.title}
    >
      <div className="amk-brand-art__head">
        <span>
          <Sparkles size={14} /> {item.eyebrow}
        </span>
        <ShieldCheck size={18} />
      </div>
      <h3>{item.title}</h3>
      <div className="amk-brand-art__rows">
        {item.rows.map(([label, value], index) => {
          const Icon =
            index === 0
              ? MessageSquareText
              : index === 1
                ? Clock3
                : CheckCircle2;
          return (
            <div key={label}>
              <Icon size={17} />
              <span>
                <small>{label}</small>
                <strong>{value}</strong>
              </span>
            </div>
          );
        })}
      </div>
      <div className="amk-brand-art__rail">
        <span>
          <Users size={14} /> Context
        </span>
        <span>
          <FileText size={14} /> Prepare
        </span>
        <span>
          <CheckCircle2 size={14} /> Review
        </span>
      </div>
    </div>
  );
}
