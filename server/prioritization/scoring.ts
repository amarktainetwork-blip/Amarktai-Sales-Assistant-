export type LeadPriorityEvidence = {
  overdueTasks: number;
  dueCallbacks: number;
  openOpportunities: number;
  staleOpportunityDays: number;
  missedCallSignals: number;
  hasNextStep: boolean;
};

export type LeadPriority = { score: number; band: "urgent" | "high" | "normal"; reasons: string[] };

export function scoreLeadPriority(evidence: LeadPriorityEvidence, settings = { overdueTaskWeight: 15, callbackWeight: 12, staleDayWeight: 2, missedCallWeight: 8, missingNextStepWeight: 18 }) : LeadPriority {
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { if (points > 0) reasons.push(reason); return points; };
  const score = Math.min(100,
    add(Math.max(0, evidence.overdueTasks) * settings.overdueTaskWeight, `${Math.max(0, evidence.overdueTasks)} overdue task(s)`) +
    add(Math.max(0, evidence.dueCallbacks) * settings.callbackWeight, `${Math.max(0, evidence.dueCallbacks)} callback(s) due`) +
    add(Math.max(0, evidence.openOpportunities) > 0 ? Math.min(20, evidence.openOpportunities * 5) : 0, `${Math.max(0, evidence.openOpportunities)} open opportunity record(s)`) +
    add(Math.max(0, evidence.staleOpportunityDays) * settings.staleDayWeight, `${Math.max(0, evidence.staleOpportunityDays)} stale opportunity day(s)`) +
    add(Math.max(0, evidence.missedCallSignals) * settings.missedCallWeight, `${Math.max(0, evidence.missedCallSignals)} missed call signal(s)`) +
    add(!evidence.hasNextStep ? settings.missingNextStepWeight : 0, "no recorded next step"),
  );
  return { score, band: score >= 65 ? "urgent" : score >= 35 ? "high" : "normal", reasons };
}
