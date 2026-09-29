import { runGenxAgent, type GenxBillingContext } from "./genx";
import { streamGenxAgent } from "./genxStreaming";

export async function streamLiveCoachingTip(input: {
  leadLabel: string;
  transcript: string;
  approvedContext?: string;
  approvedKnowledge?: string;
  conversationState?: string;
  manualHelp?: boolean;
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
    maxOutputTokens: 90,
    messages: [
      {
        role: "user",
        content: [
          `Customer: ${input.leadLabel}`,
          "CURRENT SALES EVENT:",
          input.transcript.slice(-1_800),
          "",
          input.manualHelp
            ? "The salesperson explicitly asked for help. Give direct assistance now."
            : "Intervene only when there is something genuinely useful for the salesperson right now.",
          input.manualHelp
            ? "Return at most two short lines: SAY: one factual suggested response. NEXT: one useful next question only if it helps."
            : "Return at most two short lines: SAY: one factual response only if needed. NEXT: one question only if it materially advances this sale. If no intervention is useful, return exactly SILENT.",
          "Never coach greetings, pleasantries or generic rapport. Never narrate the conversation back to the salesperson.",
          "Use approved knowledge for product, pricing, funding and eligibility facts. If the available knowledge does not support an answer, say what must be checked instead of guessing.",
          "Do not repeat old coaching. Do not invent company facts, customer intent, promises or commitments.",
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

export async function preparePostCallReviewSummary(input: {
  leadLabel: string;
  transcript: string;
  manualNotes?: string;
  billing?: GenxBillingContext;
}) {
  const transcript = input.transcript.trim();
  const manualNotes = input.manualNotes?.trim().slice(0, 12_000) || "";
  if (!transcript && !manualNotes)
    return {
      content:
        "No conversation content was captured. Confirm the call outcome and any next step manually.",
      usage: {},
      creditsCharged: 0,
      mode: "deterministic_post_call_review" as const,
    };
  const result = await runGenxAgent({
    agentKey: "notes_agent",
    modelTier: "fast",
    billing: input.billing
      ? { ...input.billing, feature: "post_call_review" }
      : undefined,
    messages: [
      {
        role: "user",
        content: `Prepare a short post-call review draft for ${input.leadLabel}.
Salesperson-authored notes:
${manualNotes || "None"}
Transcript:
${transcript.slice(-20_000) || "No transcript available"}

Use only the evidence above. Return these concise sections:
What mattered
Questions / objections
Agreed or possible next step
Uncertain / needs confirmation

Do not invent speaker identity, customer intent, promises, commitments, dates or outcomes. Treat salesperson notes as deliberate notes, not as customer quotes. If something is unclear, put it under Uncertain / needs confirmation.`,
      },
    ],
  });
  return { ...result, mode: "post_call_review" as const };
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
  manualNotes?: string;
  billing?: GenxBillingContext;
  runAgent?: typeof runGenxAgent;
}) {
  const manualNotes = input.manualNotes?.trim().slice(0, 12_000) || "";
  const routine = deterministicOutcomeSummary[input.structured.outcome];
  if (routine)
    return {
      content: manualNotes
        ? `${routine} Salesperson note: ${manualNotes}`
        : routine,
      usage: {},
      creditsCharged: 0,
      mode: "deterministic_post_call_summary" as const,
      genxCalls: 0,
    };
  const transcript = input.transcript.trim();
  if (!transcript && !manualNotes) {
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
        content: `Create one factual CRM-ready post-call result for ${input.leadLabel}.\nConfirmed structured outcome:\n${JSON.stringify(input.structured)}\nSalesperson-authored notes (treat as deliberate notes, but do not turn them into customer quotes):\n${manualNotes || "None"}\nTranscript:\n${transcript.slice(-20_000) || "No transcript available"}\n\nReturn concise facts, objections/questions, interest/timing, and the confirmed next step. Prefer salesperson-confirmed details when they conflict with uncertain transcript text. Do not invent commitments.`,
      },
    ],
  });
  return { ...result, mode: "post_call_summary" as const, genxCalls: 1 };
}