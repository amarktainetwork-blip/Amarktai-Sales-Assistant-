export type LiveSignal = {
  type: "price_objection" | "timing_objection" | "trust_objection" | "competitor" | "question" | "salesperson_commitment" | "customer_callback" | "buying_signal";
  label: string;
  evidence: string;
  priority: "normal" | "important";
};

const compact = (value: string) => value.replace(/\s+/g, " ").trim();

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return compact(match[0]).slice(0, 220);
  }
  return undefined;
}

export function detectLiveSignals(transcript: string): LiveSignal[] {
  const text = compact(transcript);
  if (!text) return [];
  const signals: LiveSignal[] = [];
  const add = (type: LiveSignal["type"], label: string, evidence: string | undefined, priority: LiveSignal["priority"] = "normal") => {
    if (evidence && !signals.some(signal => signal.type === type)) signals.push({ type, label, evidence, priority });
  };

  add("price_objection", "Price / budget objection", firstMatch(text, [/(?:too|very) expensive[^.!?]*/i, /(?:can't|cannot|can’t) afford[^.!?]*/i, /(?:price|cost|budget) (?:is|seems|feels) (?:too )?high[^.!?]*/i, /(?:cheaper|discount|afford)[^.!?]*/i]), "important");
  add("timing_objection", "Timing objection", firstMatch(text, [/not (?:the )?right time[^.!?]*/i, /(?:call|contact) me (?:later|next|after)[^.!?]*/i, /need (?:more )?time[^.!?]*/i, /(?:too busy|busy right now)[^.!?]*/i]));
  add("trust_objection", "Trust / proof concern", firstMatch(text, [/(?:not sure|unsure) (?:about|if|whether)[^.!?]*/i, /(?:is this|are you) (?:legit|legitimate|accredited|registered)[^.!?]*/i, /(?:proof|guarantee|reviews?|references?)[^.!?]*/i]));
  add("competitor", "Competitor mentioned", firstMatch(text, [/(?:another|other) (?:company|provider|supplier|course|service)[^.!?]*/i, /(?:competitor|alternative|elsewhere)[^.!?]*/i]));
  add("salesperson_commitment", "Salesperson commitment", firstMatch(text, [/(?:i(?:'ll| will)|we(?:'ll| will)) (?:send|email|call|phone|message|follow up|check|confirm|come back)[^.!?]*/i]), "important");
  add("customer_callback", "Callback requested", firstMatch(text, [/(?:call|phone|contact|message) me (?:back )?(?:on|at|after|tomorrow|later|next)[^.!?]*/i]), "important");
  add("buying_signal", "Buying signal", firstMatch(text, [/(?:how do i|how can i|where do i) (?:sign up|pay|start|enrol|enroll|buy|order)[^.!?]*/i, /(?:i(?:'m| am) interested|sounds good|let(?:'s| us) do it|i want to)[^.!?]*/i]), "important");

  const questionEvidence = firstMatch(text, [/(?:^|[.!]\s+)(?:what|when|where|why|how|which|who|can|could|would|will|is|are|do|does|have|has)\b[^?]{2,180}\?/i, /[^?]{3,180}\?/]);
  add("question", "Customer question", questionEvidence);

  return signals.slice(0, 8);
}
