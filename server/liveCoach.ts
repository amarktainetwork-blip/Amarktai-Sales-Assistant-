import { runGenxAgent, type GenxBillingContext } from "./genx";

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
