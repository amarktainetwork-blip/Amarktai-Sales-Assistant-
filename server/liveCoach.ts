[Reading 169 lines from start (total: 169 lines, 0 remaining)]

import { runGenxAgent, type GenxBillingContext } from "./genx";
import { streamGenxAgent } from "./genxStreaming";

export async function prepareLiveCoachingTip(input: {
  leadLabel: string;
  transcript: string;
  approvedContext?: string;
  billing?: GenxBillingContext;
}) {
  const context = input.approvedContext
    ? `\nApproved context:\n${input.approvedContext.slice(0, 8_000)}`
    : "";
  const result = await runGenxAgent({
    agentKey: "conversation_coach",
    modelTier: "fast",
    billing: input.billing
      ? { ...input.billing, feature: "live_call_coaching" }
      : undefined,
    messages: [
      {
        role: "user",
        content: `Live call context for ${input.leadLabel}:\n${input.transcript.slice(-12_000)}${context}\n\nProvide a short factual coaching tip with: 1) what you heard, 2) a suggested question or response, and 3) a safe next step. If the transcript is insufficient, ask the rep to clarify rather than infer.`,
      },
    ],
  });
  return { ...result, mode: "live_coaching" as const };
}

export async function streamLiveCoachingTip(input: {
  leadLabel: string;
  transcript: string;
  approvedContext?: string;
  approvedKnowledge?: string;
  conversationState?: string;
  billing: GenxBillingContext;
  signal?: AbortSignal;
  onDelta: (delta: string) => void | Promise<void>;
}) {
  const workingContext = [
    input.approvedContext ? input.approvedContext.slice(0, 8_000) : "",
    input.conversationState
      ? `LIVE CONVERSATION STATE:\n${input.conversationState.slice(0, 4_000)}`
      : "",
    input.approvedKnowledge
      ? `APPROVED PRODUCT KNOWLEDGE:\n${input.approvedKnowledge.slice(0, 6_000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await streamGenxAgent({
    agentKey: "conversation_coach",
    billing: { ...input.billing, feature: "live_call_coaching" },
    workingContext: workingContext || undefined,
    signal: input.signal,
    onDelta: input.onDelta,
    maxOutputTokens: 150,
    messages: [
      {
        role: "user",
        content: [
          `Customer: ${input.leadLabel}`,
          "CURRENT SALES EVENT:",
          input.transcript.slice(-1_800),
          "",
          "Help the salesperson SELL the product. Never coach greetings, pleasantries or generic rapport.",
          "Return only a compact live card:",
          "ANSWER NOW: If the customer asked a product/course/pricing/funding/eligibility question, give the factual answer from approved knowledge. If knowledge does not support an answer, say exactly what must be checked.",
          "SELLING MOVE: One specific next sentence or question that advances this customer's sale based on their need, objection or buying intent.",
          "WATCH: One unresolved sales fact, objection, commitment or next step only if material.",
          "Do not repeat old coaching. Prioritise the newest event and current topic. Do not invent company facts.",
        ].join("\n"),
      },
    ],
  });
  return { ...result, mode: "live_coaching_stream" as const };
}

export async function preparePostCallSummary(input: {
  leadLabel: string;
  transcript: string;
  billing?: GenxBillingContext;
}) {
  const result = await runGenxAgent({
    agentKey: "notes_agent",
    billing: input.billing
      ? { ...input.billing, feature: "post_call_summary" }
      : undefined,
    messages: [
      {
        role: "user",
        content: `Create CRM-ready notes for ${input.leadLabel} using only this transcript:\n${input.transcript.slice(-20_000)}\n\nReturn concise sections: Facts, Questions or objections, Interest and timing, Next agreed step, and Missing information. Do not invent content.`,
      },
    ],
  });
  return { ...result, mode: "post_call_summary" as const };
}

export type StructuredCallOutcome = {
  outcome: string;
  nextStep?: string;
  callbackAt?: string;
  templateName?: string;
  opportunityState?: string;
};

const deterministicOutcomeSummary: Record<string, string> = {
  no_answer: "Call attempt recorded. No customer conversation occurred.",
  voicemail: "Call reached voicemail. No customer conversation was completed.",
  wrong_number: "Call attempt recorded. The number was confirmed as incorrect.",
};

export async function prepareOutcomeAwarePostCallSummary(input: {
  leadLabel: string;
  transcript: string;
  structured: StructuredCallOutcome;
  billing?: GenxBillingContext;
  runAgent?: typeof runGenxAgent;
}) {
  const routine = deterministicOutcomeSummary[input.structured.outcome];
  if (routine)
    return {
      content: routine,
      usage: {},
      creditsCharged: 0,
      mode: "deterministic_post_call_summary" as const,
      genxCalls: 0,
    };
  const transcript = input.transcript.trim();
  if (!transcript) {
    const facts = [
      `Outcome: ${input.structured.outcome.replaceAll("_", " ")}.`,
      input.structured.nextStep
        ? `Next step: ${input.structured.nextStep}.`
        : "",
      input.structured.callbackAt
        ? `Callback: ${input.structured.callbackAt}.`
        : "",
      input.structured.templateName
        ? `Approved template requested: ${input.structured.templateName}.`
        : "",
      input.structured.opportunityState &&
      input.structured.opportunityState !== "unchanged"
        ? `Opportunity instruction: ${input.structured.opportunityState}.`
        : "",
    ].filter(Boolean);
    return {
      content: facts.join(" "),
      usage: {},
      creditsCharged: 0,
      mode: "deterministic_post_call_summary" as const,
      genxCalls: 0,
    };
  }
  const runAgent = input.runAgent || runGenxAgent;
  const result = await runAgent({
    agentKey: "notes_agent",
    modelTier: "fast",
    billing: input.billing
      ? { ...input.billing, feature: "post_call_summary" }
      : undefined,
    messages: [
      {
        role: "user",
        content: `Create one factual CRM-ready post-call result for ${input.leadLabel}.\nConfirmed structured outcome:\n${JSON.stringify(input.structured)}\nTranscript:\n${transcript.slice(-20_000)}\n\nReturn concise facts, objections/questions, interest/timing, and the confirmed next step. Do not invent commitments.`,
      },
    ],
  });
  return { ...result, mode: "post_call_summary" as const, genxCalls: 1 };
}

[executed on device: amarktaisal (60c82bca-dc19-41e6-8ff8-d16e682f865e)]