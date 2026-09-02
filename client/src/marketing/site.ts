export const marketingNavigation = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Why AmarktAI", href: "/about" },
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
    title: "AmarktAI Sales Assistant | Keep your CRM. Make the sales day easier.",
    description:
      "AmarktAI learns your business, works with the customer context in your CRM, helps before and during sales conversations and carries confirmed next steps into follow-through.",
  },
  "/how-it-works": {
    title: "How AmarktAI Sales Assistant Works | Keep Your CRM",
    description:
      "See how AmarktAI connects approved company knowledge, CRM customer context, sales conversations, Review and follow-through in one personal sales workspace.",
  },
  "/pricing": {
    title: "AmarktAI Sales Assistant Pricing | South African Rand",
    description:
      "Simple ZAR pricing for individual salespeople and teams, with included AI credits and optional top-ups for deeper AI work.",
  },
  "/about": {
    title: "Why AmarktAI | The Sales Assistant Around Your Existing CRM",
    description:
      "See why AmarktAI is built around the real work salespeople do before, during and after customer conversations instead of replacing the CRM.",
  },
  "/contact": {
    title: "Talk to AmarktAI | Sales Assistant Demo and CRM Fit",
    description:
      "Tell us how your sales team works today, which CRM you use and where the sales day needs to improve.",
  },
  "/product": {
    title: "AmarktAI Sales Assistant | The Working Layer Around Your CRM",
    description:
      "Understand the business, the customer, the conversation and the next action in one sales workspace.",
  },
  "/individuals": {
    title: "AmarktAI Sales Assistant for Individual Salespeople",
    description:
      "A personal sales workspace for customer context, preparation, conversations and follow-through around the CRM you already use.",
  },
  "/teams": {
    title: "AmarktAI Sales Assistant for Sales Teams",
    description:
      "Share approved company knowledge while every salesperson keeps a personal workspace, CRM identity and customer context.",
  },
  "/integrations": {
    title: "CRM Connections | AmarktAI Sales Assistant",
    description:
      "Keep the CRM your business already trusts and add AmarktAI as the working assistant around the sales day.",
  },
  "/404": {
    title: "Page Not Found | AmarktAI Network",
    description: "Return to the AmarktAI Sales Assistant website.",
  },
};
