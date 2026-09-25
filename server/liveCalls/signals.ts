[Reading 160 lines from start (total: 160 lines, 0 remaining)]

export type LiveSignal = {
  type:
    | "price_objection"
    | "funding_question"
    | "eligibility_question"
    | "course_question"
    | "timing_objection"
    | "trust_objection"
    | "competitor"
    | "question"
    | "commitment"
    | "customer_callback"
    | "buying_signal"
    | "interest"
    | "next_step";
  label: string;
  evidence: string;
  priority: "normal" | "important";
};

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return compact(match[0]).slice(0, 260);
  }
  return undefined;
}
export function isRoutineCallSpeech(value: string) {
  const text = compact(value)
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  return /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how are you|how're you|thanks|thank you|okay|ok|great|perfect|bye|goodbye)(?:\s+(?:there|today|sir|ma'am|madam))?$/.test(
    text
  );
}
export function detectLiveSignals(transcript: string): LiveSignal[] {
  const text = compact(transcript);
  if (!text || isRoutineCallSpeech(text)) return [];
  const signals: LiveSignal[] = [];
  const add = (
    type: LiveSignal["type"],
    label: string,
    evidence: string | undefined,
    priority: LiveSignal["priority"] = "normal"
  ) => {
    if (evidence && !signals.some(signal => signal.type === type))
      signals.push({ type, label, evidence, priority });
  };
  add(
    "price_objection",
    "Price / budget",
    firstMatch(text, [
      /(?:too|very|quite) expensive[^.!?]*/i,
      /(?:can't|cannot|can’t) afford[^.!?]*/i,
      /(?:price|cost|budget|fee|fees) (?:is|are|seems?|feels?) (?:too )?(?:high|much|expensive)[^.!?]*/i,
      /(?:cheaper|discount|afford)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "funding_question",
    "Funding / payment",
    firstMatch(text, [
      /(?:funding|finance|payment plan|instalments?|installments?|monthly payments?|elcas|loan|pay monthly)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "eligibility_question",
    "Eligibility / entry requirements",
    firstMatch(text, [
      /(?:eligible|eligibility|qualify|qualification|requirements?|entry requirements?|prerequisites?|experience required|accredited|accreditation)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "course_question",
    "Product / course question",
    firstMatch(text, [
      /(?:cyber\s*security|it support|project management|course|programme|program|training|certification)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "timing_objection",
    "Timing",
    firstMatch(text, [
      /not (?:the )?right time[^.!?]*/i,
      /(?:call|contact) me (?:later|next|after)[^.!?]*/i,
      /need (?:more )?time[^.!?]*/i,
      /(?:too busy|busy right now)[^.!?]*/i,
    ])
  );
  add(
    "trust_objection",
    "Trust / proof",
    firstMatch(text, [
      /(?:not sure|unsure|worried|concerned) (?:about|if|whether)[^.!?]*/i,
      /(?:is this|are you) (?:legit|legitimate|accredited|registered)[^.!?]*/i,
      /(?:proof|guarantee|reviews?|references?)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "competitor",
    "Competitor / alternative",
    firstMatch(text, [
      /(?:another|other) (?:company|provider|supplier|course|service)[^.!?]*/i,
      /(?:competitor|alternative|elsewhere)[^.!?]*/i,
    ])
  );
  add(
    "commitment",
    "Commitment — confirm speaker",
    firstMatch(text, [
      /(?:i(?:'ll| will)|we(?:'ll| will)) (?:send|email|call|phone|message|follow up|check|confirm|come back|review|decide|let you know|pay|enrol|enroll)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "customer_callback",
    "Callback requested",
    firstMatch(text, [
      /(?:call|phone|contact|message) me (?:back )?(?:on|at|after|tomorrow|later|next)[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "buying_signal",
    "Buying intent",
    firstMatch(text, [
      /(?:how do i|how can i|where do i) (?:sign up|pay|start|enrol|enroll|buy|order)[^.!?]*/i,
      /(?:i(?:'m| am) interested|sounds good|let(?:'s| us) do it|i want to (?:start|enrol|enroll|buy|go ahead)|ready to (?:start|pay|enrol|enroll|go ahead))[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "interest",
    "Interest / need",
    firstMatch(text, [
      /(?:i(?:'m| am) (?:looking for|interested in|considering)|i want to (?:learn|study|do)|i need (?:a|to)|looking (?:at|for|into))[^.!?]*/i,
    ]),
    "important"
  );
  add(
    "next_step",
    "Next step",
    firstMatch(text, [
      /(?:next step|what happens next|send me|email me|book (?:it|me)|start (?:on|in)|speak again)[^.!?]*/i,
    ]),
    "important"
  );
  const questionEvidence = firstMatch(text, [
    /(?:^|[.!]\s+)(?:what|when|where|why|how|which|who|can|could|would|will|is|are|do|does|have|has|tell me|explain)\b[^?]{2,220}(?:\?|$)/i,
    /[^?]{3,220}\?/,
  ]);
  add("question", "Customer question", questionEvidence, "important");
  return signals.slice(0, 10);
}

[executed on device: amarktaisal (60c82bca-dc19-41e6-8ff8-d16e682f865e)]