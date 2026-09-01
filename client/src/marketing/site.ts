export const marketingNavigation = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Why Amarktai", href: "/about" },
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
    title: "Amarktai Sales Assistant | Keep your CRM. Build a better sales day.",
    description:
      "Amarktai learns your business, works with the customer context in your CRM, supports sales conversations and carries confirmed next steps into follow-through.",
  },
  "/how-it-works": {
    title: "How Amarktai Sales Assistant Works | Keep Your CRM",
    description:
      "See how Amarktai combines approved company knowledge, CRM customer context, sales conversations and follow-through in one personal sales workspace.",
  },
  "/pricing": {
    title: "Amarktai Sales Assistant Pricing | South African Rand",
    description:
      "Simple ZAR pricing for individual salespeople and teams, with included AI credits and optional top-ups when deeper AI work is needed.",
  },
  "/about": {
    title: "Why Amarktai | Sales Assistant Around the CRM You Already Use",
    description:
      "Learn why Amarktai Sales Assistant is built around the CRM you already use and the real work salespeople do before, during and after customer conversations.",
  },
  "/contact": {
    title: "Talk to Amarktai | Sales Assistant Demo and CRM Fit",
    description:
      "Tell Amarktai how your sales team works today, which CRM you use and where the sales day needs to improve.",
  },
  "/product": {
    title: "Amarktai Sales Assistant | The Working Layer Around Your CRM",
    description: "Understand the business, the customer, the conversation and the next action in one sales workspace.",
  },
  "/individuals": {
    title: "Amarktai Sales Assistant for Individual Salespeople",
    description: "A personal sales workspace for customer context, preparation, conversations and follow-through around the CRM you already use.",
  },
  "/teams": {
    title: "Amarktai Sales Assistant for Sales Teams",
    description: "Share approved company knowledge while every salesperson keeps a personal workspace, CRM identity and customer context.",
  },
  "/integrations": {
    title: "CRM Connections | Amarktai Sales Assistant",
    description: "Keep the CRM your business already trusts and add Amarktai as the working layer around the sales day.",
  },
  "/404": {
    title: "Page Not Found | Amarktai Network",
    description: "Return to the Amarktai Sales Assistant website.",
  },
};
