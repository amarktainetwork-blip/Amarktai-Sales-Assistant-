export const WORKFLOW_KEYS = ["first_contact", "call_2_followup", "call_3_followup", "call_4_final_attempt", "callback_requested", "booking_confirmation", "reschedule_requested", "no_show_followup", "information_request", "manager_escalation", "post_call_outcome", "cyber_final_close", "cyber_post_consultation"] as const;
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
    name: "Human Communications Agent",
    purpose: "Prepares natural, company-aware email replies and template-bound email, SMS, and WhatsApp proposals that retain approved wording, subject lines, facts, and human review.",
    category: "communications",
    requiresModel: true,
    modelRole: "GenX human-style controlled-drafting model",
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
    key: "manager_assurance",
    name: "Manager Assurance Agent",
    purpose: "Checks retained workflow evidence, blocked actions, ageing review decisions, overdue callbacks, failed work, and unreviewed call outcomes; it raises findings but never alters CRM records or approves work itself.",
    category: "governance",
    requiresModel: false,
    modelRole: "Deterministic operational-quality evaluator",
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
    name: "Course Recommendation Agent",
    purpose: "Maps verified prospect needs to approved programme information, while escalating eligibility and suitability decisions for human review.",
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

export const WORKFLOW_LABELS: Record<WorkflowKey, string> = {
  first_contact: "First contact sequence",
  call_2_followup: "Call 2 follow-up",
  call_3_followup: "Call 3 follow-up",
  call_4_final_attempt: "Call 4 / final attempt",
  callback_requested: "Callback requested",
  booking_confirmation: "Booking confirmation",
  reschedule_requested: "Reschedule requested",
  no_show_followup: "No-show follow-up",
  information_request: "Information request",
  manager_escalation: "Manager escalation",
  post_call_outcome: "Post-call outcome capture",
  cyber_final_close: "Cyber Security final close",
  cyber_post_consultation: "Cyber post-consultation follow-up",
};
