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
      "Review-first actions",
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
      "Today workspace, Assistant and Calls",
      "500 AI credits each month",
      "CRM sync and deterministic automation",
      "Audit and execution evidence",
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
      "Available launch CRM connectors",
      "2,000 AI credits each month",
      "Conversation assistance and post-call closeout",
      "Pipeline intelligence",
      "Advanced playbooks and Revenue Recovery",
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
      "Available launch CRM connectors",
      "5,000 AI credits each month",
      "Team and Management Intelligence",
      "Targets, exception reporting and team playbooks",
      "Manager analytics and controls",
    ],
  },
] as const;

export const ZERO_AI_CREDIT_FEATURES = [
  "CRM synchronisation",
  "deterministic CRM reads and approved writes",
  "Today prioritisation rules",
  "overdue and stale-work detection",
  "Revenue Recovery rules",
  "standard analytics and KPI arithmetic",
  "audit and evidence capture",
  "connection health checks",
] as const;

export const AI_CREDIT_FEATURES = [
  "website understanding and re-analysis",
  "personalised message drafting",
  "conversation and transcript reasoning",
  "objection coaching",
  "complex deal guidance",
  "unstructured information extraction",
  "management narrative summaries",
] as const;
