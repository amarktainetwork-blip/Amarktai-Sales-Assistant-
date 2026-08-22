export type InboundClassification = { category: "reply_needed" | "meeting_request" | "objection" | "unsubscribe" | "information"; reasons: string[] };

export function classifyInboundMessage(input: { subject?: string | null; body: string }) : InboundClassification {
  const text = `${input.subject ?? ""}\n${input.body}`.toLowerCase();
  if (/unsubscribe|stop\s+(sending|emailing)|remove me/.test(text)) return { category: "unsubscribe", reasons: ["message includes an opt-out request"] };
  if (/meeting|calendar|availability|available (on|this)/.test(text)) return { category: "meeting_request", reasons: ["message includes meeting or availability language"] };
  if (/too expensive|budget|not interested|already use/.test(text)) return { category: "objection", reasons: ["message includes an objection signal"] };
  if (/\?|please|could you|can you/.test(text)) return { category: "reply_needed", reasons: ["message includes a question or request"] };
  return { category: "information", reasons: ["no deterministic reply trigger was found"] };
}

export function canSendReviewedReply(status: "draft" | "approved" | "rejected" | "sent" | "cancelled") {
  return status === "approved";
}
