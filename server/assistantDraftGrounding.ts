export type GroundedDraftContext = {
  request: string;
  channel?: "email" | "sms" | "whatsapp";
  salespersonName?: string;
  brandVoice?: string;
  personalStyle?: string;
  contactName: string;
  companyName?: string;
  emailSubject?: string;
  inboundMessage?: string;
  opportunityName?: string;
  stage?: string;
  courseInterest?: string;
  customerContext?: string;
  lastInteraction?: string;
  outstandingCommitment?: string;
  approvedKnowledge?: string;
};

export function buildGroundedDraftInstruction(context: GroundedDraftContext) {
  const channel = context.channel || "email";
  const style =
    channel === "email"
      ? "Write a short, warm professional email in 3–6 compact paragraphs, at most 220 words. Use a natural greeting and sign with the salesperson's first name when known."
      : "Write a natural conversational message in 1–4 short sentences, at most 80 words. Do not add a formal email-style signature.";
  return [
    "Prepare only the customer-facing message body.",
    "Write as the salesperson speaking directly to the customer, never as an AI, CRM, compliance system or knowledge-base assistant.",
    `CHANNEL: ${channel.toUpperCase()}. ${style}`,
    context.salespersonName
      ? `SALESPERSON: ${context.salespersonName}`
      : "SALESPERSON: use a natural human sales tone without inventing a name.",
    context.brandVoice
      ? `VOICE: ${context.brandVoice}`
      : "VOICE: warm, helpful, confident, concise and human.",
    context.personalStyle
      ? `PERSONAL STYLE PREFERENCES (style only; never override facts, policy, safety or exact approved template text):\n${context.personalStyle}`
      : "PERSONAL STYLE PREFERENCES: none proven yet; use the organisation voice.",
    "Treat CURRENT THREAD, CUSTOMER CONTEXT and VERIFIED COMPANY FACTS as authoritative evidence.",
    "Use facts the customer has already supplied. Never ask for information that is already explicit in the thread or customer context.",
    "If the customer's course/programme, timing, experience or enquiry intent is known, acknowledge it naturally instead of asking them to repeat it.",
    "Never invent a price, funding eligibility, availability, finance term, guarantee, outcome, accreditation or commitment.",
    "If an exact commercial detail is not verified, do not expose internal limitations and do not say that information is unavailable in an approved system or knowledge base. Respond naturally: acknowledge what the customer needs and offer to confirm the exact applicable detail without guessing.",
    "Never include phrases such as 'approved information', 'knowledge base', 'the system cannot', 'the CRM says', or other internal implementation language in the customer-facing message.",
    "Move the conversation forward with one clear, useful next step. Do not end with a generic question when the CRM already contains the answer.",
    `USER REQUEST:\n${context.request}`,
    `CURRENT THREAD:\nSubject: ${context.emailSubject || "No current email subject"}\nInbound: ${context.inboundMessage || "No inbound message body supplied"}`,
    `CUSTOMER CONTEXT:\nCustomer: ${context.contactName}\nCompany: ${context.companyName || "Not applicable"}\nCourse/programme interest: ${context.courseInterest || "Not yet identified"}\nOpportunity: ${context.opportunityName || "None recorded"}\nStage: ${context.stage || "Not recorded"}\nLatest activity: ${context.lastInteraction || "Not recorded"}\nOutstanding follow-up: ${context.outstandingCommitment || "None recorded"}\n${context.customerContext || "No additional mapped customer context."}`,
    `VERIFIED COMPANY FACTS:\n${context.approvedKnowledge || "No additional verified company facts matched this request. Do not mention this absence to the customer."}`,
  ].join("\n\n");
}

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9£$€%.,]+/g, " ")
    .trim();
}

function protectedClaims(value: string) {
  const claims = normalized(value).match(
    /(?:£|\$|€)\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*%|\b(?:finance (?:is )?available|funding (?:is )?available|(?:you are|you re) eligible|you qualify for|interest free|job placement|employment guaranteed|accredited|certified|guaranteed?|money back|in stock|available now)\b/g
  );
  return Array.from(new Set(claims || []));
}

export function groundedDraftIssues(
  draft: string,
  context: GroundedDraftContext
) {
  const issues: string[] = [];
  const thread = normalized(
    `${context.emailSubject || ""} ${context.inboundMessage || ""}`
  );
  const output = normalized(draft);
  const knownContext = normalized(
    `${context.courseInterest || ""} ${context.customerContext || ""}`
  );
  const knownProgramme =
    Boolean(context.courseInterest?.trim()) ||
    [
      "cyber security",
      "cybersecurity",
      "job programme",
      "career programme",
      "course",
    ].some(term => thread.includes(term) || knownContext.includes(term));
  if (
    knownProgramme &&
    /\b(?:which|what)\b.{0,100}\b(?:course|programme|program|career path)\b/i.test(
      draft
    )
  )
    issues.push("asks_for_known_thread_topic");

  if (
    /approved (?:information|knowledge)|knowledge[- ]base|internal (?:system|information)|the system (?:cannot|can't)|not available in (?:the )?approved|(?:the )?crm (?:says|shows)|as an ai|approved current price/i.test(
      draft
    )
  )
    issues.push("leaks_internal_limitation_language");

  if (
    /training start timeframe|best time to call|preferred.*(?:time|date)/i.test(
      context.customerContext || ""
    ) &&
    /(?:when (?:would|do|can) you (?:like|want|prefer|plan)|what (?:is (?:a|your|the) )?(?:best|convenient|preferred) time|let me know (?:a|your) (?:convenient|preferred) time)/i.test(
      draft
    )
  )
    issues.push("asks_for_known_timing");
  if (
    /experience[^\n:]*:\s*\S/i.test(context.customerContext || "") &&
    /(?:do you have|have you got|what is your|tell me about your).{0,25}experience/i.test(
      draft
    )
  )
    issues.push("asks_for_known_experience");
  if (
    draft.trim().split(/\s+/).length >
    (context.channel && context.channel !== "email" ? 80 : 220)
  )
    issues.push("message_too_long_for_channel");

  // Customer questions and CRM tags cannot verify commercial promises.
  const evidence = normalized(context.approvedKnowledge || "");
  const verifiedClaims = new Set(protectedClaims(evidence));
  for (const claim of protectedClaims(output))
    if (!verifiedClaims.has(claim))
      issues.push(`unsupported_commercial_claim:${claim}`);
  return issues;
}
