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
    title: "AmarktAI Sales Assistant | Sell More. Admin Less.",
    description:
      "AmarktAI learns how your company sells, works around the CRM you already use, prepares customer conversations and gets the follow-through ready while the salesperson stays in control.",
  },
  "/how-it-works": {
    title: "How AmarktAI Works | Teach It How Your Company Sells",
    description:
      "Connect the CRM you already use, teach AmarktAI your sales process in plain English, prove the skill and carry the work from priority to conversation to follow-through.",
  },
  "/pricing": {
    title: "AmarktAI Sales Assistant Pricing | Start Small and Prove the Value",
    description:
      "Simple South African pricing for one salesperson or a team. Keep your CRM, prove the saved time and scale when the sales operation is ready.",
  },
  "/about": {
    title: "Why AmarktAI | Put the Salesperson Back in Sales",
    description:
      "AmarktAI removes the preparation, remembering and follow-through that turns salespeople into administrators while keeping the customer system and the salesperson in control.",
  },
  "/contact": {
    title: "Book an AmarktAI Demo | Show Us Your Sales Day",
    description:
      "Bring the CRM, the sales process and one repetitive workflow. We will show you what AmarktAI can learn and take off the salesperson.",
  },
  "/product": {
    title: "AmarktAI Sales Assistant | The Working Layer Around Your CRM",
    description:
      "A sales assistant that learns company skills, keeps customer context current and prepares the work before and after every conversation.",
  },
  "/individuals": {
    title: "AmarktAI for Individual Salespeople",
    description:
      "A personal sales assistant for priorities, customer context, calls, reminders and follow-through around the CRM you already use.",
  },
  "/teams": {
    title: "AmarktAI for Sales Teams",
    description:
      "Teach the company process once while every salesperson keeps their own workspace, CRM identity, customer context and control.",
  },
  "/integrations": {
    title: "CRM Connections | AmarktAI Sales Assistant",
    description:
      "Keep the CRM your business already trusts and add AmarktAI as the working layer around the salesperson.",
  },
  "/404": {
    title: "Page Not Found | AmarktAI Network",
    description: "Return to the AmarktAI Sales Assistant website.",
  },
};
