export const marketingNavigation = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

export const accountLinks = {
  signIn: "/auth",
  getStarted: "/auth?mode=register",
} as const;

export const publicPageMetadata: Record<
  string,
  { title: string; description: string }
> = {
  "/": {
    title: "Amarktai Network Sales Assistant | A better sales day around your CRM",
    description:
      "Amarktai Network Sales Assistant learns the business, works beside the CRM and helps salespeople prepare, call, follow through and keep customer records accurate.",
  },
  "/how-it-works": {
    title: "How It Works | Amarktai Network Sales Assistant",
    description:
      "See how Amarktai Network learns approved business context, connects each salesperson to the CRM and turns it into a focused daily sales workflow.",
  },
  "/pricing": {
    title: "Pricing in ZAR | Amarktai Network Sales Assistant",
    description:
      "South African Rand pricing for individual salespeople and teams, including AI credits and optional top-ups.",
  },
  "/about": {
    title: "About | Amarktai Network Sales Assistant",
    description:
      "Why Amarktai Network built Sales Assistant and how it helps sales teams work better without replacing the CRM.",
  },
  "/contact": {
    title: "Contact | Amarktai Network Sales Assistant",
    description:
      "Talk to Amarktai Network about Sales Assistant, CRM compatibility, onboarding, demos or support.",
  },
  "/product": {
    title: "Amarktai Network Sales Assistant",
    description: "Explore the Amarktai Network Sales Assistant product.",
  },
  "/individuals": {
    title: "Amarktai Network Sales Assistant for Individuals",
    description: "Sales Assistant for individual salespeople and business owners.",
  },
  "/teams": {
    title: "Amarktai Network Sales Assistant for Teams",
    description: "Sales Assistant for teams with shared business knowledge and personal workspaces.",
  },
  "/integrations": {
    title: "CRM Connections | Amarktai Network Sales Assistant",
    description: "Connect Sales Assistant to the CRM your business already uses.",
  },
  "/404": {
    title: "Page Not Found | Amarktai Network",
    description: "Return to the Amarktai Network Sales Assistant website.",
  },
};
