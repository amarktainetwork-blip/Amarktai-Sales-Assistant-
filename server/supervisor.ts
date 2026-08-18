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
  if (/first call|first contact|new uncontacted|call 2|call 3|call 4/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "first_contact", summary: "Route to the first-contact workflow and verify candidate eligibility before proposing outreach.", requiredInputs: ["Candidate or contact name"], guardrails };
  if (/final.*(cyber|close)|close.*(cyber|file)|last try/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "cyber_final_close", summary: "Route to the Cyber final-close workflow; current records must be separated from historical closed records.", requiredInputs: ["Candidate or contact name"], guardrails };
  if (/post.?consultation|yes.?no cyber|follow.?up.*cyber/.test(normalized)) return { intent: "workflow", agentKey: "supervisor", workflowKey: "cyber_post_consultation", summary: "Route to the Cyber post-consultation workflow and require the actual call outcome before preparing actions.", requiredInputs: ["Candidate or contact name", "Call outcome", "Factual notes when answered"], guardrails };
  if (/call|objection|coach|conversation|script/.test(normalized)) return { intent: "coaching", agentKey: "conversation_coach", summary: "Route to the Conversation Coach for factual, next-step guidance. No candidate facts will be invented.", requiredInputs: ["Transcript or factual notes"], guardrails };
  if (/course|programme|pricing|funding|entry|requirement|knowledge/.test(normalized)) return { intent: "knowledge", agentKey: "knowledge_guide", summary: "Route to the Programme Knowledge Agent and answer only from approved sources.", requiredInputs: ["Question"], guardrails };
  if (/report|analytics|conversion|overdue|performance|pipeline/.test(normalized)) return { intent: "analytics", agentKey: "analytics", summary: "Route to the Analytics Agent to surface measured workspace activity and pending operations.", requiredInputs: [], guardrails };
  return { intent: "clarification", agentKey: "supervisor", summary: "The request is not specific enough to choose a workflow safely. Ask for the candidate, intended outcome, or approved workflow.", requiredInputs: ["Clarified goal and relevant candidate or record"], guardrails };
}
