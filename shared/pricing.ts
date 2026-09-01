export const AI_CREDIT_ECONOMICS = {
  upstreamUnitsPerPack: 1000,
  upstreamCostUsdCentsPerPack: 1000,
  retailPackUsdCents: 3500,
  retailPackZarCents: 59900,
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
    includedAiCredits: 50,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: [
      "14-day workspace trial",
      "One salesperson",
      "One CRM connection",
      "Today workspace and Assistant",
      "50 AI credits",
      "Review important customer updates before they are made",
    ],
  },
  {
    key: "starter",
    name: "Solo",
    monthlyUsdCents: 2900,
    monthlyZarCents: 49900,
    includedAiCredits: 500,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: [
      "One salesperson",
      "One CRM connection",
      "Today, Assistant and Calls",
      "500 AI credits each month",
      "CRM sync and approved follow-through",
      "Visible action history and CRM readback",
    ],
  },
  {
    key: "professional",
    name: "Growth",
    monthlyUsdCents: 7900,
    monthlyZarCents: 129900,
    includedAiCredits: 2000,
    includedUsers: 3,
    crmConnections: "launch-crms",
    managementIntelligence: false,
    features: [
      "Up to three users",
      "Supported CRM connections",
      "2,000 AI credits each month",
      "Conversation assistance and post-call follow-through",
      "Pipeline priorities and deal-risk signals",
      "Advanced sales playbooks and missed-opportunity recovery",
    ],
  },
  {
    key: "team",
    name: "Team",
    monthlyUsdCents: 19900,
    monthlyZarCents: 299900,
    includedAiCredits: 5000,
    includedUsers: 10,
    crmConnections: "launch-crms",
    managementIntelligence: true,
    features: [
      "Up to ten users",
      "Supported CRM connections",
      "5,000 AI credits each month",
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
