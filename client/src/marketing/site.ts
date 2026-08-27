export const marketingNavigation = [
  { label: "Product", href: "/product" },
  { label: "How it works", href: "/how-it-works" },
  { label: "For individuals", href: "/individuals" },
  { label: "For teams", href: "/teams" },
  { label: "CRM connections", href: "/integrations" },
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
    title: "Amarktai Sales Assistant | AI beside your sales team",
    description:
      "Amarktai learns the business, works beside the CRM and helps salespeople prepare, call, follow through and keep the customer record accurate.",
  },
  "/product": {
    title: "Product | Amarktai Sales Assistant",
    description:
      "See the complete Amarktai sales workspace: priorities, customer context, live calls, follow-up, CRM actions, readback and manager visibility.",
  },
  "/how-it-works": {
    title: "How It Works | Amarktai Sales Assistant",
    description:
      "From company learning and CRM setup to the daily sales workflow, see how Amarktai becomes useful without replacing your CRM.",
  },
  "/individuals": {
    title: "For Individuals | Amarktai Sales Assistant",
    description:
      "A focused AI sales workspace for independent salespeople, consultants and business owners who need the next move to stay clear.",
  },
  "/teams": {
    title: "For Teams | Amarktai Sales Assistant",
    description:
      "Shared company knowledge, personal salesperson workspaces and manager visibility without shared passwords or private-chat leakage.",
  },
  "/integrations": {
    title: "CRM Connections | Amarktai Sales Assistant",
    description:
      "Amarktai is designed to work beside Genie, HubSpot, Salesforce, Pipedrive, Zoho CRM and suitable authorised browser CRMs.",
  },
  "/pricing": {
    title: "Pricing in ZAR | Amarktai Sales Assistant",
    description:
      "South African Rand pricing for individuals and teams, with included AI credits and optional AI-credit top-ups.",
  },
  "/about": {
    title: "About | Amarktai Sales Assistant",
    description:
      "Why Amarktai Sales Assistant exists, what it changes in the sales day, and how it fits into the wider Amarktai Network.",
  },
  "/contact": {
    title: "Contact | Amarktai Sales Assistant",
    description:
      "Talk to Amarktai about product questions, demos, CRM compatibility, onboarding, team setup or support.",
  },
  "/404": {
    title: "Page Not Found | Amarktai Sales Assistant",
    description: "Return to the Amarktai Sales Assistant website.",
  },
};
