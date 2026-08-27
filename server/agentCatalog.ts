export const WORKFLOW_KEYS = ["first_contact", "final_close", "post_consultation_follow_up"] as const;
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
    name: "Knowledge Agent",
    purpose: "Answers sales questions only from approved organisation knowledge and policy sources.",
    category: "knowledge",
    requiresModel: true,
    modelRole: "GenX retrieval and explanation model",
  },
  {
    key: "company_intelligence_review",
    name: "Company Intelligence Review Agent",
    purpose: "Interprets public website extraction into evidence-backed human-review drafts, separates first-party offerings from comparisons, competitors, testimonials, examples, historical and ambiguous content, and keeps excluded material out of trusted company knowledge.",
    category: "knowledge",
    requiresModel: true,
    modelRole: "GenX evidence-grounded website interpretation model",
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
  {
    key: "sales_intelligence",
    name: "Sales Intelligence Agent",
    purpose: "Finds actionable patterns in approved CRM activity, call outcomes, callbacks, and review decisions so agents can prioritise the next best work.",
    category: "analysis",
    requiresModel: true,
    modelRole: "GenX evidence-led sales analysis model",
  },
  {
    key: "objection_handler",
    name: "Objection Handling Agent",
    purpose: "Prepares factual, source-grounded responses to objections and clearly identifies missing information for human review.",
    category: "conversation",
    requiresModel: true,
    modelRole: "GenX controlled response-planning model",
  },
  {
    key: "recommendation_agent",
    name: "Solution Recommendation Agent",
    purpose: "Maps verified prospect needs to approved organisation offerings, while escalating eligibility and suitability decisions for human review.",
    category: "knowledge",
    requiresModel: true,
    modelRole: "GenX grounded recommendation model",
  },
  {
    key: "crm_router",
    name: "Multi-CRM Router Agent",
    purpose: "Routes a proposed contact, task, note, opportunity, or activity action only to a connected CRM that has the required confirmed capability.",
    category: "orchestration",
    requiresModel: false,
    modelRole: "Deterministic provider and capability router",
  },
  {
    key: "pipeline_planner",
    name: "Pipeline Planner Agent",
    purpose: "Prepares prioritised pipeline actions, follow-up timing, and task proposals from approved organisation context and CRM evidence.",
    category: "analysis",
    requiresModel: true,
    modelRole: "GenX structured pipeline planning model",
  },
];

export type AgentRuntimeStatus = "READY" | "INTERNAL" | "NEEDS_CONNECTION" | "NOT_IMPLEMENTED";

export type AgentRuntimeDependencies = {
  databaseReady: boolean;
  genxReady: boolean;
  crmReadReady: boolean;
  crmRouteReady: boolean;
  communicationsReady: boolean;
  voiceReady: boolean;
};

/** Truthful runtime state derived from live dependencies, not catalogue presence. */
export function agentRuntimeStatus(key: string, dependencies: AgentRuntimeDependencies): AgentRuntimeStatus {
  if (["supervisor", "workflow_guardian", "qa_compliance"].includes(key)) return "READY";
  if (key === "analytics") return dependencies.databaseReady ? "READY" : "INTERNAL";
  if (key === "company_intelligence_review") return dependencies.genxReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "knowledge_guide") return dependencies.databaseReady && dependencies.genxReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "crm_context") return dependencies.genxReady && dependencies.crmReadReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "crm_router") return dependencies.crmReadReady || dependencies.crmRouteReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "communications") return dependencies.genxReady && dependencies.communicationsReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "conversation_coach" || key === "notes_agent") return dependencies.genxReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "sales_intelligence") return dependencies.databaseReady && dependencies.genxReady && dependencies.crmReadReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "objection_handler" || key === "recommendation_agent") return dependencies.databaseReady && dependencies.genxReady ? "READY" : "NEEDS_CONNECTION";
  if (key === "pipeline_planner") return dependencies.databaseReady && dependencies.genxReady && (dependencies.crmReadReady || dependencies.crmRouteReady) ? "READY" : "NEEDS_CONNECTION";
  return "NOT_IMPLEMENTED";
}

export const WORKFLOW_LABELS: Record<WorkflowKey, string> = {
  first_contact: "First contact sequence",
  final_close: "Final close review",
  post_consultation_follow_up: "Post-consultation follow-up",
};
