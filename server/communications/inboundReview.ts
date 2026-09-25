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

  // Safe acknowledgements and automated mailbox notices do not need to occupy
  // the salesperson action queue. Everything else from a matched customer is
  // treated conservatively as a real reply: a statement can change timing,
  // funding, intent or the agreed next step even when it contains no question.
  const acknowledgement = latestBody
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(?:ok|okay|ok thanks|okay thanks|thanks|thanks a lot|thank you|thank you very much|great|perfect|got it|understood|noted|cheers|cool|all good|no problem|sounds good|that(?:'s| is) fine)$/.test(
      acknowledgement
    ) ||
    /\b(?:automatic reply|out of office|delivery (?:failed|failure)|undeliverable|mailer-daemon)\b/.test(
      text
    )
  )
    return {
      category: "information",
      reasons: ["message is a simple acknowledgement or automated notice"],
    };

  if (latestBody)
    return {
      category: "reply_needed",
      reasons: ["substantive customer reply needs salesperson review"],
    };

  return {
    category: "information",
    reasons: ["message contains no current customer text"],
  };
}

export function canSendReviewedReply(
  status: "draft" | "approved" | "rejected" | "sent" | "cancelled"
) {
  return status === "approved";
}
