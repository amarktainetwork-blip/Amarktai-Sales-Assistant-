export const WORKFLOW_KEYS = ["first_contact", "cyber_final_close", "cyber_post_consultation"] as const;
export type WorkflowKey = (typeof WORKFLOW_KEYS)[number];

export type AgentDefinition = {
  key: string;
  name: string;
  purpose: string;
  category: "governance" | "context" | "conversation" | "knowledge" | "communications" | "analysis" | "orchestration";
  requiresModel: boolean;
  modelRole: string;
};

export const AGENT_CATALOG: AgentDefinition[] = [
  {
    key: "supervisor",
    name: "Supervisor Agent",
    purpose: "Interprets a sales instruction, routes it to the right specialist or governed workflow, identifies missing inputs, and never bypasses review-first controls.",
    category: "orchestration",
    requiresModel: false,
    modelRole: "Deterministic command router and safety coordinator",
  },
  {
    key: "workflow_guardian",
    name: "Workflow Guardian",
    purpose: "Validates contact sequence rules, prevents duplicates, and requires a reviewable plan before any external action.",
    category: "governance",
    requiresModel: false,
    modelRole: "Deterministic policy engine",
  },
  {
    key: "crm_context",
    name: "CRM Context Agent",
    purpose: "Collects a contact’s open tasks, opportunity history, and conversation context from a verified CRM connector.",
    category: "context",
    requiresModel: true,
    modelRole: "GenX context synthesis model",
  },
  {
    key: "conversation_coach",
    name: "Conversation Coach",
    purpose: "Turns live or post-call notes into concise next-step guidance without inventing customer facts.",
    category: "conversation",
    requiresModel: true,
    modelRole: "GenX low-latency coaching model",
  },
  {
    key: "knowledge_guide",
    name: "Programme Knowledge Agent",
    purpose: "Answers sales questions from approved Course2Career programme and policy sources.",
    category: "knowledge",
    requiresModel: true,
    modelRole: "GenX retrieval and explanation model",
  },
  {
    key: "communications",
    name: "Communications Agent",
    purpose: "Prepares template-bound email, SMS, and WhatsApp action proposals that retain approved wording and subject lines.",
    category: "communications",
    requiresModel: true,
    modelRole: "GenX controlled-drafting model",
  },
  {
    key: "notes_agent",
    name: "Notes & Summary Agent",
    purpose: "Converts a verified transcript or factual notes into concise CRM-ready summaries, next steps and missing-information prompts.",
    category: "conversation",
    requiresModel: true,
    modelRole: "GenX structured call-analysis model",
  },
  {
    key: "qa_compliance",
    name: "QA & Compliance Agent",
    purpose: "Checks eligibility, duplicate safeguards, template use, sender requirements and historical record protections before review.",
    category: "governance",
    requiresModel: false,
    modelRole: "Deterministic policy validation model",
  },
  {
    key: "analytics",
    name: "Analytics Agent",
    purpose: "Surfaces operational throughput, review volume, execution outcomes and blocked work from durable workspace records.",
    category: "analysis",
    requiresModel: false,
    modelRole: "Measured operational analytics",
  },
];

export const WORKFLOW_LABELS: Record<WorkflowKey, string> = {
  first_contact: "First contact sequence",
  cyber_final_close: "Cyber Security final close",
  cyber_post_consultation: "Cyber post-consultation follow-up",
};
