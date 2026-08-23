export type AlertSeverity = "info" | "warning" | "error" | "critical";
export type AlertRule = { severityThreshold: "warning" | "error" | "critical"; category?: string | null; isActive: boolean };

const rank: Record<AlertSeverity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

export function shouldRouteOperationalAlert(rule: AlertRule, event: { severity: AlertSeverity; category: string }) {
  if (!rule.isActive || rank[event.severity] < rank[rule.severityThreshold]) return false;
  return !rule.category || rule.category === event.category;
}

export function boundedDeliveryAttempt(attempts: number, maximumAttempts = 3) {
  if (!Number.isInteger(attempts) || attempts < 0 || !Number.isInteger(maximumAttempts) || maximumAttempts < 1) throw new Error("Invalid alert delivery attempt state.");
  return attempts + 1 >= maximumAttempts ? "dead_letter" as const : "retrying" as const;
}
