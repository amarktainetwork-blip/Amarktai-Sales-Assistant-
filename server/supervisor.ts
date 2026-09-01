import type { WorkflowKey } from "./agentCatalog";

export type SupervisorRoute = {
  intent:
    | "workflow"
    | "coaching"
    | "knowledge"
    | "analytics"
    | "communications"
    | "crm"
    | "clarification";
  agentKey: string;
  workflowKey?: WorkflowKey;
  summary: string;
  requiredInputs: string[];
  guardrails: string[];
  suggestedPath?: string;
  suggestedLabel?: string;
};

const guardrails = [
  "Do not claim an external action happened unless execution evidence confirms it.",
  "Do not invent customer, company, pricing, policy, product, or commitment facts.",
  "Any external change must use the existing review and execution controls.",
];

export function routeSalesCommand(command: string): SupervisorRoute {
  const normalized = command.trim().toLowerCase();

  if (
    /(?:take|keep|write|capture).*(?:notes?|minutes?)|(?:notes?|summary).*(?:next|this|my).*(?:call|conversation)|summari[sz]e.*(?:call|conversation|meeting)/.test(
      normalized
    )
  )
    return {
      intent: "coaching",
      agentKey: "notes_agent",
      summary:
        "Use the call companion and Notes agent to capture factual notes, summary, next steps and missing information.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/calls",
      suggestedLabel: "Open call companion",
    };

  if (
    /objection|pushback|hesitation|concern|handle.*(?:no|price|cost|think about it|not interested)/.test(
      normalized
    )
  )
    return {
      intent: "coaching",
      agentKey: "objection_handler",
      summary:
        "Use the Objection Handling specialist with approved company knowledge and the available customer context.",
      requiredInputs: [],
      guardrails,
    };

  if (
    /prepare me.*(?:call|meeting)|next call|coach me|call prep|talking points|conversation plan/.test(
      normalized
    )
  )
    return {
      intent: "coaching",
      agentKey: "conversation_coach",
      summary:
        "Use the Conversation Coach with the selected customer, recent activity and approved company knowledge.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/calls",
      suggestedLabel: "Open call companion",
    };

  if (
    /who should i (?:contact|call|follow up with) (?:next|first)|what should i do (?:next|first|today)|next best action|attention queue|top priorit|who needs attention|prioriti[sz]e my/.test(
      normalized
    )
  )
    return {
      intent: "analytics",
      agentKey: "attention_engine",
      summary:
        "Use the attention engine to rank the salesperson's current work from synchronized evidence.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/today",
      suggestedLabel: "Open today's work",
    };

  if (/overdue.*task|task.*overdue|what.*overdue|late task/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "attention_engine",
      summary: "Return the signed-in user's overdue CRM tasks from today's work.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/today",
      suggestedLabel: "Open overdue tasks",
    };

  if (/due today|today.*task|tasks? (?:for|due) today/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "attention_engine",
      summary: "Return the signed-in user's tasks and follow-ups due today.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/today",
      suggestedLabel: "Open today's work",
    };

  if (/remind|reminder|what.*reminder/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "attention_engine",
      summary: "Use the user's current reminder queue.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/today",
      suggestedLabel: "Open reminders",
    };

  if (/callback|call back|callbacks/.test(normalized) && !/prepare|notes?|coach/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "attention_engine",
      summary: "Use the user's current callback queue.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/today",
      suggestedLabel: "Open callbacks",
    };

  if (
    /who (?:has been )?waiting for us|who (?:needs|is waiting for) (?:a )?reply|unanswered (?:customer|message|reply)|last (?:email|message|contact)|what did we last tell|response gap|preferred channel/.test(
      normalized
    )
  )
    return {
      intent: "analytics",
      agentKey: "sales_comms_tracker",
      summary:
        "Use the communication tracker to answer from the customer timeline and unanswered-message evidence.",
      requiredInputs: [],
      guardrails,
    };

  if (
    /promise|commitment|what (?:did|have) we promise|what (?:did|has) (?:the )?customer promise|promised to|committed to/.test(
      normalized
    )
  )
    return {
      intent: "analytics",
      agentKey: "promise_tracker",
      summary:
        "Use the Promise and Commitment tracker to surface explicit commitments only.",
      requiredInputs: [],
      guardrails,
    };

  if (
    /revenue leakage|losing (?:money|revenue)|money (?:being )?lost|revenue at risk|dropped lead|missed opportunity/.test(
      normalized
    )
  )
    return {
      intent: "analytics",
      agentKey: "revenue_leakage",
      summary: "Use revenue-risk evidence from synchronized sales activity.",
      requiredInputs: [],
      guardrails,
    };

  if (/pipeline hygiene|crm hygiene|stale pipeline|missing next step|wrong stage|missing stage|missing owner/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "pipeline_hygiene",
      summary: "Use synchronized pipeline evidence to find records needing attention.",
      requiredInputs: [],
      guardrails,
    };

  if (/deal health|customer health|relationship health|which (?:deals?|customers?) are at risk|at.risk (?:deals?|customers?)/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "relationship_health",
      summary: "Use customer and deal evidence to explain current risk.",
      requiredInputs: [],
      guardrails,
    };

  if (/manager watchtower|team watchtower|which reps?|sales reps?|team.*(?:overdue|stale|performance|follow.?up)|manager.*(?:sales|pipeline|attention)/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "manager_watchtower",
      summary: "Use the manager-only team exception view.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/team",
      suggestedLabel: "Open team view",
    };

  if (/product|service|pricing|price|policy|requirement|course|programme|offering|what do we sell|company knowledge/.test(normalized))
    return {
      intent: "knowledge",
      agentKey: "knowledge_guide",
      summary: "Answer from approved organisation knowledge only.",
      requiredInputs: [],
      guardrails,
    };

  if (/recommend|which (?:product|service|course|programme)|best fit|suitable|solution for/.test(normalized))
    return {
      intent: "knowledge",
      agentKey: "recommendation_agent",
      summary: "Match verified prospect needs to approved offerings without inventing suitability facts.",
      requiredInputs: [],
      guardrails,
    };

  if (/email|sms|whatsapp|message|follow.?up (?:message|email)|write.*(?:email|message)|draft.*(?:email|message)/.test(normalized))
    return {
      intent: "communications",
      agentKey: "communications",
      summary: "Prepare communication wording from approved context; sending still uses the review path.",
      requiredInputs: [],
      guardrails,
    };

  if (/open.*crm|show.*crm|go to.*crm/.test(normalized))
    return {
      intent: "crm",
      agentKey: "crm_context",
      summary: "Open the user's private CRM workspace.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/crm",
      suggestedLabel: "Open CRM",
    };

  if (/first call|first contact|new uncontacted|initial outreach/.test(normalized))
    return {
      intent: "workflow",
      agentKey: "supervisor",
      workflowKey: "first_contact",
      summary: "Prepare first-contact work for review.",
      requiredInputs: ["Contact name"],
      guardrails,
    };

  if (/final.*(close|follow.?up)|close.*(final|file|record)|last try/.test(normalized))
    return {
      intent: "workflow",
      agentKey: "supervisor",
      workflowKey: "final_close",
      summary: "Prepare a final-close follow-up for review.",
      requiredInputs: ["Contact name"],
      guardrails,
    };

  if (/post.?consultation|follow.?up.*(call|consultation)|call outcome/.test(normalized))
    return {
      intent: "workflow",
      agentKey: "supervisor",
      workflowKey: "post_consultation_follow_up",
      summary: "Prepare post-call follow-up from the actual call outcome and notes.",
      requiredInputs: ["Contact name", "Call outcome"],
      guardrails,
    };

  if (/report|analytics|conversion|performance|pipeline/.test(normalized))
    return {
      intent: "analytics",
      agentKey: "analytics",
      summary: "Use measured workspace activity and CRM context.",
      requiredInputs: [],
      guardrails,
    };

  if (/call|coach|conversation|script/.test(normalized))
    return {
      intent: "coaching",
      agentKey: "conversation_coach",
      summary: "Use the Conversation Coach with factual context.",
      requiredInputs: [],
      guardrails,
      suggestedPath: "/calls",
      suggestedLabel: "Open call companion",
    };

  return {
    intent: "clarification",
    agentKey: "supervisor",
    summary:
      "Use the Supervisor to interpret the request from current workspace context and ask only for information that is genuinely missing.",
    requiredInputs: [],
    guardrails,
  };
}
