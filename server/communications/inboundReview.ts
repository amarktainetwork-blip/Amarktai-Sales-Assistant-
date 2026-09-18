export type InboundClassification = {
  category:
    | "sale_intent"
    | "reply_needed"
    | "meeting_request"
    | "objection"
    | "unsubscribe"
    | "information";
  reasons: string[];
};

function latestInboundText(body: string) {
  return body
    .replace(/<blockquote[\s\S]*$/i, " ")
    .replace(
      /<div[^>]+class=["'][^"']*gmail_quote[^"']*["'][\s\S]*$/i,
      " "
    )
    .replace(/\bon\s+.{0,220}\bwrote:\s*[\s\S]*$/i, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyInboundMessage(input: {
  subject?: string | null;
  body: string;
}): InboundClassification {
  const latestBody = latestInboundText(input.body);
  const text = `${input.subject ?? ""}\n${latestBody}`.toLowerCase();

  if (/unsubscribe|stop\s+(sending|emailing)|remove me/.test(text))
    return {
      category: "unsubscribe",
      reasons: ["message includes an opt-out request"],
    };

  // Possible-sale priority is deliberately based on the customer's newest
  // message only. Quoted invoice/payment history must not turn an ordinary
  // reschedule or support reply into a false sale alert.
  if (
    /\b(move forward|moving forward|ready to (?:proceed|enrol|enroll|start)|want to (?:proceed|enrol|enroll|join)|secure (?:my|the) (?:place|seat)|payment plan|deposit|otp)\b/.test(
      latestBody
    )
  )
    return {
      category: "sale_intent",
      reasons: ["message includes enrolment, payment, or proceed language"],
    };

  if (/meeting|calendar|availability|available (on|this)/.test(text))
    return {
      category: "meeting_request",
      reasons: ["message includes meeting or availability language"],
    };
  if (/too expensive|budget|not interested|already use/.test(text))
    return {
      category: "objection",
      reasons: ["message includes an objection signal"],
    };
  if (/\?|please|could you|can you/.test(text))
    return {
      category: "reply_needed",
      reasons: ["message includes a question or request"],
    };
  return {
    category: "information",
    reasons: ["no deterministic reply trigger was found"],
  };
}

export function canSendReviewedReply(
  status: "draft" | "approved" | "rejected" | "sent" | "cancelled"
) {
  return status === "approved";
}
