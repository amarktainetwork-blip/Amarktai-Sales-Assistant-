export const AI_CREDIT_ECONOMICS = {
  upstreamUnitsPerPack: 250,
  upstreamCostUsdCentsPerPack: 250,
  retailPackUsdCents: 1200,
  retailPackZarCents: 19900,
} as const;

export type PlanKey = "trial" | "starter" | "professional" | "team";

export type PricingPlan = {
  key: PlanKey;
  name: string;
  monthlyUsdCents: number;
  monthlyZarCents: number;
  includedAiCredits: number;
  includedUsers: number;
  crmConnections: number | "launch-crms";
  managementIntelligence: boolean;
  features: string[];
};

export const PRICING_PLANS: readonly PricingPlan[] = [
  {
    key: "trial",
    name: "Trial",
    monthlyUsdCents: 0,
    monthlyZarCents: 0,
    includedAiCredits: 25,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: [
      "14-day workspace trial",
      "One salesperson",
      "One CRM connection",
      "Today workspace and Assistant",
      "25 AI-assisted tasks",
      "Review important customer updates before they are made",
    ],
  },
  {
    key: "starter",
    name: "Solo",
    monthlyUsdCents: 2300,
    monthlyZarCents: 39900,
    includedAiCredits: 100,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: [
      "One salesperson",
      "One CRM connection",
      "Today, Assistant and Calls",
      "100 AI-assisted tasks each month",
      "CRM sync and approved follow-through",
      "Visible action history and CRM readback",
    ],
  },
  {
    key: "professional",
    name: "Growth",
    monthlyUsdCents: 5800,
    monthlyZarCents: 99900,
    includedAiCredits: 300,
    includedUsers: 3,
    crmConnections: "launch-crms",
    managementIntelligence: false,
    features: [
      "Up to three users",
      "Supported CRM connections",
      "300 AI-assisted tasks each month",
      "Conversation assistance and post-call follow-through",
      "Pipeline priorities and deal-risk signals",
      "Advanced sales playbooks and missed-opportunity recovery",
    ],
  },
  {
    key: "team",
    name: "Team",
    monthlyUsdCents: 11600,
    monthlyZarCents: 199900,
    includedAiCredits: 750,
    includedUsers: 10,
    crmConnections: "launch-crms",
    managementIntelligence: true,
    features: [
      "Up to ten users",
      "Supported CRM connections",
      "750 AI-assisted tasks shared by the team",
      "Team coaching and manager insight",
      "Targets, exception alerts and team playbooks",
      "Manager reporting and controls",
    ],
  },
] as const;

export const ZERO_AI_CREDIT_FEATURES = [
  "CRM synchronisation",
  "CRM reads and approved updates",
  "Today priorities",
  "overdue and stale-work detection",
  "missed-opportunity recovery",
  "standard reporting calculations",
  "action history and CRM readback",
  "connection health checks",
] as const;

export const AI_CREDIT_FEATURES = [
  "website learning and re-analysis",
  "personalised message drafting",
  "conversation and transcript understanding",
  "objection coaching",
  "complex deal guidance",
  "information extraction from unstructured content",
  "manager summaries",
] as const;
