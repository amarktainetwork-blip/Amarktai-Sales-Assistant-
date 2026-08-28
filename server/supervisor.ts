import type { WorkflowKey } from "./agentCatalog";

export type SupervisorRoute = {
  intent: "workflow" | "coaching" | "knowledge" | "analytics" | "clarification";
  agentKey: string;
  workflowKey?: WorkflowKey;
  summary: string;
  requiredInputs: string[];
  guardrails: string[];
};

export function routeSalesCommand(command: string): SupervisorRoute {
  const normalized = command.trim().toLowerCase();
  const guardrails = ["No external CRM or communication action runs from a command alone.", "Every missing or ambiguous fact requires human clarification.", "Any external action must be prepared as an owned, reviewable proposal."];
  if (/first call|first contact|new uncontacted|initial outreach/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "first_contact", summary: "Route to the first-contact workflow and verify contact readiness before proposing outreach.", requiredInputs: ["Contact name"], guardrails };
  if (/final.*(close|follow.?up)|close.*(final|file|record)|last try/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "final_close", summary: "Route to the final-close workflow; current records must be separated from historical closed records.", requiredInputs: ["Contact name"], guardrails };
  if (/post.?consultation|follow.?up.*(call|consultation)|call outcome/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "post_consultation_follow_up", summary: "Route to the post-consultation workflow and require the actual call outcome before preparing actions.", requiredInputs: ["Contact name", "Call outcome", "Factual notes when answered"], guardrails };
  if (/manager watchtower|team watchtower|who (?:is|isn't|is not) following up|which reps?|sales reps?|response sla|team.*(?:overdue|stale|performance|follow.?up)|manager.*(?:sales|pipeline|attention)/.test(normalized)) return { intent: "analytics", agentKey: "manager_watchtower", summary: "Route to Manager Watchtower for an authorised team-level exception view backed by synchronized CRM evidence.", requiredInputs: [], guardrails };
  if (/revenue leakage|losing (?:money|revenue)|money (?:being )?lost|revenue at risk|dropped lead|unanswered lead|missed opportunity/.test(normalized)) return { intent: "analytics", agentKey: "revenue_leakage", summary: "Route to Revenue Leakage to identify evidence-backed sales opportunities and customer responses that are at risk of being lost.", requiredInputs: [], guardrails };
  if (/pipeline hygiene|crm hygiene|stale pipeline|missing next step|wrong stage|missing stage|missing owner/.test(normalized)) return { intent: "analytics", agentKey: "pipeline_hygiene", summary: "Route to Pipeline Hygiene to identify stale, incomplete, or operationally inconsistent active pipeline records.", requiredInputs: [], guardrails };
  if (/deal health|customer health|relationship health|which (?:deals?|customers?) are at risk|at.risk (?:deals?|customers?)/.test(normalized)) return { intent: "analytics", agentKey: "relationship_health", summary: "Route to Customer & Deal Health for explainable risk scoring from synchronized CRM evidence.", requiredInputs: [], guardrails };
  if (/promise|commitment|what (?:did|have) we promise|what (?:did|has) (?:the )?customer promise|promised to|committed to/.test(normalized)) return { intent: "analytics", agentKey: "promise_tracker", summary: "Route to Promise & Commitment Tracker to extract only explicit commitments from verified CRM communication evidence.", requiredInputs: [], guardrails };
  if (/who (?:has been )?waiting for us|who (?:needs|is waiting for) (?:a )?reply|unanswered (?:customer|message|reply)|communications? tracker|comms tracker|last (?:email|message|contact)|what did we last tell|response gap|preferred channel/.test(normalized)) return { intent: "analytics", agentKey: "sales_comms_tracker", summary: "Route to Sales & Comms Tracker for the evidence-backed communication timeline and unanswered-customer state.", requiredInputs: [], guardrails };
  if (/next best action|what should i do (?:next|first|today)|who should i (?:contact|help|follow up with) first|attention queue|top priorit|who needs attention|prioriti[sz]e my/.test(normalized)) return { intent: "analytics", agentKey: "attention_engine", summary: "Route to Attention & Next-Best-Action to collapse CRM risk signals into one ranked work queue.", requiredInputs: [], guardrails };
  if (/call|objection|coach|conversation|script/.test(normalized)) return { intent: "coaching", agentKey: "conversation_coach", summary: "Route to the Conversation Coach for factual, next-step guidance. No candidate facts will be invented.", requiredInputs: ["Transcript or factual notes"], guardrails };
  if (/product|service|pricing|policy|requirement|knowledge/.test(normalized)) return { intent: "knowledge", agentKey: "knowledge_guide", summary: "Route to the Knowledge Agent and answer only from approved sources.", requiredInputs: ["Question"], guardrails };
  if (/report|analytics|conversion|overdue|performance|pipeline/.test(normalized)) return { intent: "analytics", agentKey: "analytics", summary: "Route to the Analytics Agent to surface measured workspace activity and pending operations.", requiredInputs: [], guardrails };
  return { intent: "clarification", agentKey: "supervisor", summary: "The request is not specific enough to choose a workflow safely. Ask for the candidate, intended outcome, or approved workflow.", requiredInputs: ["Clarified goal and relevant candidate or record"], guardrails };
}
