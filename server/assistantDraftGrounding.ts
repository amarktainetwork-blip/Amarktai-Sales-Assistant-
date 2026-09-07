export type GroundedDraftContext = {
  request: string;
  contactName: string;
  companyName?: string;
  emailSubject?: string;
  inboundMessage?: string;
  opportunityName?: string;
  stage?: string;
  lastInteraction?: string;
  outstandingCommitment?: string;
  approvedKnowledge?: string;
};

export function buildGroundedDraftInstruction(context: GroundedDraftContext) {
  return [
    "Prepare only the customer-facing message body.",
    "Treat CURRENT THREAD, CRM CONTEXT and APPROVED COMPANY KNOWLEDGE as authoritative evidence.",
    "Never ask for information already explicit in the current thread or CRM context.",
    "Never invent a price, availability, finance term, guarantee, outcome or commitment.",
    "When a requested commercial fact is unavailable, say that it is not available in the approved information and offer to confirm it without guessing.",
    "Keep continuity with the existing subject and use concise, natural salesperson language.",
    `USER REQUEST:\n${context.request}`,
    `CURRENT THREAD:\nSubject: ${context.emailSubject || "Not available"}\nInbound: ${context.inboundMessage || "Not available"}`,
    `CRM CONTEXT:\nCustomer: ${context.contactName}\nCompany: ${context.companyName || "Not available"}\nOpportunity: ${context.opportunityName || "Not available"}\nStage: ${context.stage || "Not available"}\nLatest activity: ${context.lastInteraction || "Not available"}\nOutstanding follow-up: ${context.outstandingCommitment || "Not available"}`,
    `APPROVED COMPANY KNOWLEDGE:\n${context.approvedKnowledge || "No approved company-specific facts matched this request."}`,
  ].join("\n\n");
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9£$€%]+/g, " ").trim();
}

function protectedClaims(value: string) {
  const claims = normalized(value).match(
    /(?:£|\$|€)\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*%|\b(?:finance (?:is )?available|guaranteed?|money back|in stock|available now)\b/g
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
  const knownProgramme = [
    "cyber security",
    "cybersecurity",
    "job programme",
    "career programme",
    "course",
  ].some(term => thread.includes(term));
  if (
    knownProgramme &&
    /\b(?:which|what)\b.{0,100}\b(?:course|programme|program|career path)\b/i.test(
      draft
    )
  )
    issues.push("asks_for_known_thread_topic");

  const evidence = normalized(
    `${context.emailSubject || ""} ${context.inboundMessage || ""} ${context.opportunityName || ""} ${context.lastInteraction || ""} ${context.outstandingCommitment || ""} ${context.approvedKnowledge || ""}`
  );
  for (const claim of protectedClaims(output))
    if (!evidence.includes(claim)) issues.push(`unsupported_commercial_claim:${claim}`);
  return issues;
}
