export const marketingNavigation = [
  { label: "Product", href: "/product" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "Individuals", href: "/individuals" },
  { label: "Teams", href: "/teams" },
  { label: "Integrations", href: "/integrations" },
  { label: "Pricing", href: "/pricing" },
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
    title: "Amarktai Sales Assistant | AI Sales Workspace",
    description:
      "Organise the sales day, prepare every conversation and keep CRM follow-up moving with Amarktai Sales Assistant.",
  },
  "/product": {
    title: "Product | Amarktai Sales Assistant",
    description:
      "Explore the connected sales workspace for next prospects, calls, follow-up, CRM administration and team visibility.",
  },
  "/how-it-works": {
    title: "How It Works | Amarktai Sales Assistant",
    description:
      "See how Amarktai connects your business knowledge and CRM to a clear daily sales workflow.",
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
    title: "Integrations | Amarktai Sales Assistant",
    description:
      "Connect Amarktai to Genie, HubSpot, Salesforce, Pipedrive, Zoho CRM or another authorised web CRM.",
  },
  "/pricing": {
    title: "Pricing | Amarktai Sales Assistant",
    description:
      "Compare Amarktai Sales Assistant subscriptions, included users, CRM connections and AI credits.",
  },
  "/contact": {
    title: "Contact | Amarktai Sales Assistant",
    description:
      "Talk to Amarktai about product questions, team setup, CRM compatibility, onboarding or support.",
  },
  "/404": {
    title: "Page Not Found | Amarktai Sales Assistant",
    description: "Return to the Amarktai Sales Assistant public website.",
  },
};
