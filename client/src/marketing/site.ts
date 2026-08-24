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
      "Explore the future plan structure for individual salespeople, teams and organisations. Launch pricing is being finalised.",
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

export const futurePlans = [
  {
    name: "Individual",
    audience: "For one salesperson.",
    summary:
      "A focused workspace for organising prospects, calls and follow-up.",
    features: [
      "Personal Today view",
      "Call preparation and assistance",
      "Customer and follow-up workspace",
      "Approved business knowledge",
    ],
  },
  {
    name: "Team",
    audience: "For growing sales teams.",
    summary:
      "A shared sales rhythm with manager visibility and controlled actions.",
    features: [
      "Individual workspaces",
      "Shared company knowledge",
      "Team workload and manager views",
      "Approvals and reporting",
    ],
  },
  {
    name: "Business",
    audience: "For organisations needing advanced setup and support.",
    summary:
      "A supported rollout shaped around CRM requirements and operating processes.",
    features: [
      "Advanced CRM commissioning",
      "Custom workflow setup",
      "Organisation-wide controls",
      "Deployment and onboarding support",
    ],
  },
] as const;
