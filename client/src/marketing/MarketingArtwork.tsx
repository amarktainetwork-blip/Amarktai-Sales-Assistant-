import { marketingImagery } from "./imagery";

type MarketingArtworkProps = {
  variant:
    | "howHero"
    | "howCrm"
    | "aboutHero"
    | "aboutTeam"
    | "pricing"
    | "contact"
    | "authLogin"
    | "authRegister";
  inverse?: boolean;
  compact?: boolean;
};

const content = {
  howHero: { image: marketingImagery.howHero, label: "How AmarktAI works" },
  howCrm: { image: marketingImagery.howCrm, label: "Works around your CRM" },
  aboutHero: { image: marketingImagery.aboutHero, label: "Built for salespeople" },
  aboutTeam: { image: marketingImagery.aboutTeam, label: "One company playbook" },
  pricing: { image: marketingImagery.pricing, label: "Start with the team you have" },
  contact: { image: marketingImagery.contact, label: "Show us your sales day" },
  authLogin: { image: marketingImagery.authLogin, label: "Secure sign in" },
  authRegister: {
    image: marketingImagery.authRegister,
    label: "Create your AmarktAI account",
  },
} as const;

export function MarketingArtwork({
  variant,
  inverse = false,
  compact = false,
}: MarketingArtworkProps) {
  const item = content[variant];
  return (
    <figure
      className={[
        "amk-brand-art",
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
