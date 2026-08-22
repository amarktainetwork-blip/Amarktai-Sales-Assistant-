import { runGenxAgent, type GenxBillingContext } from "./genx";

export async function prepareLiveCoachingTip(input: { leadLabel: string; transcript: string; approvedContext?: string; billing?: GenxBillingContext }) {
  const context = input.approvedContext ? `\nApproved context:\n${input.approvedContext.slice(0, 8_000)}` : "";
  const result = await runGenxAgent({
    agentKey: "conversation_coach",
    modelTier: "fast",
    billing: input.billing ? { ...input.billing, feature: "live_call_coaching" } : undefined,
    messages: [{ role: "user", content: `Live call context for ${input.leadLabel}:\n${input.transcript.slice(-12_000)}${context}\n\nProvide a short factual coaching tip with: 1) what you heard, 2) a suggested question or response, and 3) a safe next step. If the transcript is insufficient, ask the rep to clarify rather than infer.` }],
  });
  return { ...result, mode: "live_coaching" as const };
}

export async function preparePostCallSummary(input: { leadLabel: string; transcript: string; billing?: GenxBillingContext }) {
  const result = await runGenxAgent({
    agentKey: "notes_agent",
    billing: input.billing ? { ...input.billing, feature: "post_call_summary" } : undefined,
    messages: [{ role: "user", content: `Create CRM-ready notes for ${input.leadLabel} using only this transcript:\n${input.transcript.slice(-20_000)}\n\nReturn concise sections: Facts, Questions or objections, Interest and timing, Next agreed step, and Missing information. Do not invent content.` }],
  });
  return { ...result, mode: "post_call_summary" as const };
}
