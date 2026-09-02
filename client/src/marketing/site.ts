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

export const publicPageMetadata: Record<string, { title: string; description: string }> = {
  "/": {
    title: "AmarktAI Sales Assistant | Sell with more confidence. Follow up without the scramble.",
    description: "AmarktAI helps salespeople prepare for customers, handle conversations and finish the follow-up around the CRM they already use.",
  },
  "/how-it-works": {
    title: "How AmarktAI Sales Assistant Works | Keep Your CRM",
    description: "See how AmarktAI brings company knowledge, CRM customer context, conversation help, Review and follow-through into one sales workflow.",
  },
  "/pricing": {
    title: "AmarktAI Sales Assistant Pricing | Simple ZAR Plans",
    description: "Simple South African pricing for individual salespeople and teams, with included AI credits and optional top-ups when more intelligence is needed.",
  },
  "/about": {
    title: "Why AmarktAI | A Better Way to Work Around Your CRM",
    description: "AmarktAI helps salespeople use the customer, company and conversation context they already have instead of copying everything into another system.",
  },
  "/contact": {
    title: "Book an AmarktAI Sales Assistant Demo | CRM and Sales Workflow Fit",
    description: "Tell us which CRM your team uses and where the sales day gets stuck. We will show you how AmarktAI fits around the way you already sell.",
  },
  "/product": {
    title: "AmarktAI Sales Assistant | The Working Layer Around Your CRM",
    description: "Prepare, sell and follow through with the customer and company context your salespeople need.",
  },
  "/individuals": {
    title: "AmarktAI Sales Assistant for Individual Salespeople",
    description: "A personal sales workspace for preparation, customer context, conversations and follow-through around the CRM you already use.",
  },
  "/teams": {
    title: "AmarktAI Sales Assistant for Sales Teams",
    description: "Share approved company knowledge while every salesperson keeps a personal workspace, CRM identity and customer context.",
  },
  "/integrations": {
    title: "CRM Connections | AmarktAI Sales Assistant",
    description: "Keep the CRM your business already trusts and add AmarktAI as the working assistant around the sales day.",
  },
  "/404": {
    title: "Page Not Found | AmarktAI Network",
    description: "Return to the AmarktAI Sales Assistant website.",
  },
};
