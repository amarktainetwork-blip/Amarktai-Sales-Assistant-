export const AI_CREDIT_ECONOMICS = {
  upstreamUnitsPerPack: 1000,
  upstreamCostUsdCentsPerPack: 1000,
  retailPackUsdCents: 3500,
} as const;

export type PlanKey = "trial" | "starter" | "professional" | "team";

export type PricingPlan = {
  key: PlanKey;
  name: string;
  monthlyUsdCents: number;
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
    includedAiCredits: 50,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: ["One salesperson", "One CRM connection", "Today workspace", "Revenue Recovery preview", "Review-first actions"],
  },
  {
    key: "starter",
    name: "Starter",
    monthlyUsdCents: 2900,
    includedAiCredits: 500,
    includedUsers: 1,
    crmConnections: 1,
    managementIntelligence: false,
    features: ["One salesperson", "One CRM connection", "Today workspace", "Revenue Recovery", "CRM sync and deterministic automation", "Audit and execution evidence"],
  },
  {
    key: "professional",
    name: "Professional",
    monthlyUsdCents: 7900,
    includedAiCredits: 2000,
    includedUsers: 3,
    crmConnections: "launch-crms",
    managementIntelligence: false,
    features: ["Up to three users", "Genie and HubSpot capability", "Advanced playbooks", "Conversation assistance", "Post-call closeout", "Pipeline intelligence", "Advanced Revenue Recovery"],
  },
  {
    key: "team",
    name: "Team",
    monthlyUsdCents: 19900,
    includedAiCredits: 5000,
    includedUsers: 10,
    crmConnections: "launch-crms",
    managementIntelligence: true,
    features: ["Up to ten users", "Genie and HubSpot capability", "Team Intelligence", "Management Intelligence", "Targets and exception reporting when enabled", "Team playbooks", "Manager analytics"],
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
  "personalised message drafting",
  "conversation and transcript reasoning",
  "objection coaching",
  "complex deal guidance",
  "unstructured information extraction",
  "management narrative summaries",
] as const;
