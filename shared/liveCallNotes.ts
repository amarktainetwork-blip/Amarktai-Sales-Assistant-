[Reading 151 lines from start (total: 151 lines, 0 remaining)]

export type LiveSignalLike = {
  type: string;
  evidence: string;
};

export type LiveStructuredNotes = {
  goals: string[];
  facts: string[];
  questions: string[];
  objections: string[];
  buyingSignals: string[];
  commitments: string[];
  callbackRequests: string[];
  datesTimes: string[];
  nextSteps: string[];
  unresolvedItems: string[];
  topics: string[];
};

export function emptyLiveStructuredNotes(): LiveStructuredNotes {
  return {
    goals: [],
    facts: [],
    questions: [],
    objections: [],
    buyingSignals: [],
    commitments: [],
    callbackRequests: [],
    datesTimes: [],
    nextSteps: [],
    unresolvedItems: [],
    topics: [],
  };
}

function uniqueBounded(values: string[], limit = 8) {
  const seen = new Set<string>();
  return values
    .map(value => value.replace(/\s+/g, " ").trim())
    .filter(value => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function utterances(value: string) {
  return value
    .split(/\n+|(?<=[.!?])\s+/)
    .map(item => item.replace(/\s+/g, " ").trim())
    .filter(item => item.length >= 4)
    .slice(-30);
}

export function structuredNotesFromSignals(
  signals: LiveSignalLike[],
  transcript = ""
): LiveStructuredNotes {
  const lines = utterances(transcript);
  const questions = signals
    .filter(signal => signal.type === "question")
    .map(signal => signal.evidence);
  const objections = signals
    .filter(
      signal => /_objection$/.test(signal.type) || signal.type === "competitor"
    )
    .map(signal => signal.evidence);
  const buyingSignals = signals
    .filter(signal => signal.type === "buying_signal")
    .map(signal => signal.evidence);
  const commitments = signals
    .filter(signal => signal.type === "commitment")
    .map(signal => signal.evidence);
  const callbackRequests = signals
    .filter(signal => signal.type === "customer_callback")
    .map(signal => signal.evidence);
  const topics = signals
    .filter(signal =>
      [
        "course_question",
        "funding_question",
        "eligibility_question",
        "interest",
      ].includes(signal.type)
    )
    .map(signal => signal.evidence);
  const goals = lines.filter(line =>
    /\b(?:i|we)\s+(?:want|need|would like|hope|plan|aim|am looking|are looking|am trying|are trying)\b/i.test(
      line
    )
  );
  const facts = lines.filter(line =>
    /\b(?:i|we)\s+(?:am|are|have|haven't|have not|don't|do not|can't|cannot|work|worked|studied|completed|live|already)\b/i.test(
      line
    )
  );
  const datesTimes = lines.filter(line =>
    /\b(?:today|tomorrow|tonight|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i.test(
      line
    )
  );
  const nextSteps = [...callbackRequests, ...buyingSignals, ...commitments];
  const unresolvedItems = [...questions, ...objections];

  return {
    goals: uniqueBounded(goals),
    facts: uniqueBounded(facts),
    questions: uniqueBounded(questions),
    objections: uniqueBounded(objections),
    buyingSignals: uniqueBounded(buyingSignals),
    commitments: uniqueBounded(commitments),
    callbackRequests: uniqueBounded(callbackRequests),
    datesTimes: uniqueBounded(datesTimes),
    nextSteps: uniqueBounded(nextSteps),
    unresolvedItems: uniqueBounded(unresolvedItems),
    topics: uniqueBounded(topics),
  };
}

export function mergeLiveStructuredNotes(
  current: LiveStructuredNotes,
  incoming: LiveStructuredNotes
): LiveStructuredNotes {
  return {
    goals: uniqueBounded([...incoming.goals, ...current.goals]),
    facts: uniqueBounded([...incoming.facts, ...current.facts]),
    questions: uniqueBounded([...incoming.questions, ...current.questions]),
    objections: uniqueBounded([...incoming.objections, ...current.objections]),
    buyingSignals: uniqueBounded([
      ...incoming.buyingSignals,
      ...current.buyingSignals,
    ]),
    commitments: uniqueBounded([
      ...incoming.commitments,
      ...current.commitments,
    ]),
    callbackRequests: uniqueBounded([
      ...incoming.callbackRequests,
      ...current.callbackRequests,
    ]),
    datesTimes: uniqueBounded([...incoming.datesTimes, ...current.datesTimes]),
    nextSteps: uniqueBounded([...incoming.nextSteps, ...current.nextSteps]),
    unresolvedItems: uniqueBounded([
      ...incoming.unresolvedItems,
      ...current.unresolvedItems,
    ]),
    topics: uniqueBounded([...incoming.topics, ...current.topics]),
  };
}

[executed on device: amarktaisal (60c82bca-dc19-41e6-8ff8-d16e682f865e)]