import { marketingImagery } from "./imagery";

type MarketingArtworkProps = {
  variant?: "context" | "team" | "workflow" | "contact" | "knowledge";
  inverse?: boolean;
  compact?: boolean;
};

const content = {
  context: { image: marketingImagery.customerCall, label: "Customer context" },
  team: { image: marketingImagery.aboutTeam, label: "Team workspace" },
  workflow: { image: marketingImagery.howHero, label: "Sales day" },
  contact: {
    image: marketingImagery.contact,
    label:
      "BUILT AROUND YOUR PROCESS — Show us where the sales day gets stuck.",
  },
  knowledge: { image: marketingImagery.aboutHero, label: "Company knowledge" },
} as const;

export function MarketingArtwork({
  variant = "workflow",
  inverse = false,
  compact = false,
}: MarketingArtworkProps) {
  const item = content[variant];
  return (
    <figure
      className={[
        "amk-brand-art",
        "amk-brand-art--photo",
        inverse ? "amk-brand-art--inverse" : "",
        compact ? "amk-brand-art--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img src={item.image.src} alt={item.image.alt} loading="lazy" />
      <figcaption className="sr-only">{item.label}</figcaption>
    </figure>
  );
}
