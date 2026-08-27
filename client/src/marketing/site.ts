export const marketingNavigation = [
  { label: "Pricing", href: "/pricing" },
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
      "See how Amarktai turns CRM context, calls, follow-up and AI assistance into one focused sales workspace.",
  },
  "/how-it-works": {
    title: "How It Works | Amarktai Sales Assistant",
    description:
      "See how Amarktai connects approved business knowledge and your CRM to a clear daily sales workflow.",
  },
  "/individuals": {
    title: "For Individuals | Amarktai Sales Assistant",
    description:
      "A focused sales workspace for independent salespeople, consultants and business owners who sell.",
  },
  "/teams": {
    title: "For Teams | Amarktai Sales Assistant",
    description:
      "Give salespeople a consistent workspace while managers see where attention and support are needed.",
  },
  "/integrations": {
    title: "CRM Connections | Amarktai Sales Assistant",
    description:
      "Connect Amarktai to Genie, HubSpot, Salesforce, Pipedrive, Zoho CRM or another authorised web CRM.",
  },
  "/pricing": {
    title: "Pricing in ZAR | Amarktai Sales Assistant",
    description:
      "Simple South African Rand pricing for individuals and sales teams, with included AI credits and optional top-ups.",
  },
  "/contact": {
    title: "Contact | Amarktai Sales Assistant",
    description:
      "Talk to Amarktai about team setup, CRM compatibility, onboarding or support.",
  },
  "/404": {
    title: "Page Not Found | Amarktai Sales Assistant",
    description: "Return to the Amarktai Sales Assistant website.",
  },
};
