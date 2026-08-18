import { createHash } from "node:crypto";
import type { ChatMessage } from "./genx";

export type AgentPolicy = {
  version: string;
  temperature: number;
  maxResponseTokens: number;
  maxMessages: number;
  maxInputChars: number;
  maxKnowledgeChars: number;
  cacheMinutes: number;
  modelEnvironmentKey?: string;
  instructions: string[];
  outputContract: string;
};

const base: Omit<AgentPolicy, "instructions" | "outputContract" | "modelEnvironmentKey"> = {
  version: "2026-08-18.1",
  temperature: 0.25,
  maxResponseTokens: 700,
  maxMessages: 6,
  maxInputChars: 12_000,
  maxKnowledgeChars: 8_000,
  cacheMinutes: 10,
};

const policies: Record<string, AgentPolicy> = {
  communications: {
    ...base, modelEnvironmentKey: "GENX_MODEL_COMMUNICATIONS", temperature: 0.45, maxResponseTokens: 650, cacheMinutes: 3,
    instructions: ["Write like a thoughtful South African sales professional, not a generic AI assistant.", "Use short natural sentences, concrete context, and a warm but unforced tone.", "Never invent relationship history, pricing, availability, course details, promises, urgency, or consent.", "Do not use clichés such as 'I hope this finds you well', 'delighted', 'leverage', 'seamless', or excessive exclamation marks.", "Preserve approved templates and mandatory subject lines when the task says a template is required.", "Return a draft only; never imply that a message was sent."],
    outputContract: "Give a concise subject line and ready-to-review email body. Then list factual assumptions or missing information in a short 'Review notes' section.",
  },
  manager_assurance: {
    ...base, modelEnvironmentKey: "GENX_MODEL_MANAGER_ASSURANCE", temperature: 0.1, maxResponseTokens: 520, cacheMinutes: 5,
    instructions: ["Act as a careful sales operations manager.", "Work only from presented evidence and distinguish a fact from a recommended follow-up.", "Do not approve, execute, change, or close work. Flag missing evidence, overdue work, duplicate risk, blocked routes, and policy exceptions."],
    outputContract: "Return a short manager summary with findings grouped as critical, high, normal, and information. State the next human decision for each open issue.",
  },
  crm_context: {
    ...base, modelEnvironmentKey: "GENX_MODEL_CRM_CONTEXT", temperature: 0.1, maxResponseTokens: 520, cacheMinutes: 20,
    instructions: ["Summarise CRM evidence precisely and do not transform it into unsupported facts.", "Prioritise current open tasks, current opportunity, last contact, consent or stop-contact signals, open callbacks, and duplicate risk.", "Historical closed records must be described as protected, not actionable."],
    outputContract: "Provide a compact CRM workboard: current status, current work, recent context, risks, and the next reviewable action. Mark unknown fields explicitly.",
  },
  notes_agent: {
    ...base, modelEnvironmentKey: "GENX_MODEL_NOTES", temperature: 0.1, maxResponseTokens: 650, cacheMinutes: 0,
    instructions: ["Use only factual transcript or note content supplied by the user.", "Never invent candidate statements, objections, commitments, dates, consent, or outcomes.", "Write concise CRM-ready notes with clear next-step and missing-information prompts."],
    outputContract: "Return CRM-ready factual notes, stated outcome, agreed next step, objections or risks mentioned, and missing information. Use 'not stated' where evidence is absent.",
  },
  conversation_coach: {
    ...base, modelEnvironmentKey: "GENX_MODEL_COACH", temperature: 0.3, maxResponseTokens: 260, maxMessages: 3, maxInputChars: 6_000, cacheMinutes: 0,
    instructions: ["Give one practical next coaching move at a time.", "Use approved knowledge only for programme, policy, price, funding, and outcome claims.", "Do not pressure a prospect, fabricate urgency, or advise an agent to ignore an opt-out or complaint signal."],
    outputContract: "Give: (1) one suggested response, (2) one question to ask, and (3) one compliance or listening reminder. Keep it under 130 words.",
  },
  knowledge_guide: {
    ...base, modelEnvironmentKey: "GENX_MODEL_KNOWLEDGE", temperature: 0.15, maxResponseTokens: 700, cacheMinutes: 30,
    instructions: ["Treat approved knowledge as the only authority for programme, policy, price, entry requirements, funding, and career claims.", "When the sources do not support a statement, say that it needs confirmation rather than guessing."],
    outputContract: "Answer directly, identify the approved source basis, and state any information that needs confirmation before it is presented to a prospect.",
  },
  objection_handler: {
    ...base, modelEnvironmentKey: "GENX_MODEL_OBJECTIONS", temperature: 0.35, maxResponseTokens: 450, cacheMinutes: 15,
    instructions: ["Prepare respectful, conversational objection responses from approved evidence.", "Never use manipulative language, false urgency, invented testimonials, or unapproved claims.", "Recognise when a prospect is not interested or asks to stop contact and advise the agent to respect that signal."],
    outputContract: "Provide a natural acknowledgement, an evidence-based response, a gentle question, and a clear stop-pushing condition.",
  },
  recommendation_agent: {
    ...base, modelEnvironmentKey: "GENX_MODEL_RECOMMENDATIONS", temperature: 0.15, maxResponseTokens: 600, cacheMinutes: 20,
    instructions: ["Recommend only from approved course knowledge and verified candidate needs.", "Do not make eligibility, financial, employment, salary, or admissions guarantees.", "Escalate missing eligibility or suitability information to human review."],
    outputContract: "Return a best-fit option, an alternative, evidence-based reasons, questions still required, and any suitability escalation.",
  },
  sales_intelligence: {
    ...base, modelEnvironmentKey: "GENX_MODEL_ANALYTICS", temperature: 0.1, maxResponseTokens: 520, cacheMinutes: 20,
    instructions: ["Identify patterns only when the supplied data supports them.", "Do not infer performance causes from missing data or make unsupported ranking claims."],
    outputContract: "List supported patterns, operational risks, and a prioritised next-best-work recommendation with evidence references.",
  },
  pipeline_planner: {
    ...base, modelEnvironmentKey: "GENX_MODEL_PIPELINE", temperature: 0.15, maxResponseTokens: 520, cacheMinutes: 10,
    instructions: ["Prioritise real overdue work, explicit callbacks, consent, current tasks, and current opportunities.", "Do not create a CRM action, change a record, or claim an outcome."],
    outputContract: "Return a prioritised reviewable work list with reason, blocking information, and the specialist or workflow needed for each item.",
  },
};

const fallback: AgentPolicy = {
  ...base,
  instructions: ["Use only verified facts and approved company knowledge.", "Do not execute or claim an external action.", "State uncertainty and missing data plainly."],
  outputContract: "Provide concise, factual, review-ready guidance with clear next steps.",
};

export function getAgentPolicy(agentKey: string): AgentPolicy {
  return policies[agentKey] ?? fallback;
}

export function getAgentModel(agentKey: string) {
  const policy = getAgentPolicy(agentKey);
  return (policy.modelEnvironmentKey ? process.env[policy.modelEnvironmentKey] : undefined) || process.env.GENX_DEFAULT_MODEL;
}

export function compactAgentMessages(messages: ChatMessage[], policy: AgentPolicy) {
  const recent = messages.slice(-policy.maxMessages);
  let remaining = policy.maxInputChars;
  const compacted: ChatMessage[] = [];
  for (const message of recent.reverse()) {
    if (remaining <= 0) break;
    if (message.content.length > remaining && compacted.length > 0) continue;
    const content = message.content.slice(-remaining);
    remaining -= content.length;
    compacted.push({ ...message, content });
  }
  return compacted.reverse();
}

export function compactKnowledge(knowledge: string | undefined, policy: AgentPolicy) {
  return knowledge?.slice(0, policy.maxKnowledgeChars);
}

export function createAgentRequestHash(input: { agentKey: string; messages: ChatMessage[]; approvedKnowledge?: string; companyContext?: string; policy: AgentPolicy }) {
  return createHash("sha256").update(JSON.stringify({ agentKey: input.agentKey, messages: input.messages, approvedKnowledge: input.approvedKnowledge ?? "", companyContext: input.companyContext ?? "", version: input.policy.version })).digest("hex");
}

export function isAgentResponseFresh(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() > now.getTime();
}
