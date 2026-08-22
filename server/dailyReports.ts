import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { claimDailyReportDelivery, getAssistantDashboard, listEnabledDailyReports, markDailyReportDelivery, releaseDailyReportDelivery } from "./db";
import { sendDailyWorkspaceReport } from "./smtp";

type CronDate = { second: number; minute: number; hour: number; day: number; month: number; weekday: number };

function matchesCronField(expression: string, value: number, minimum: number, maximum: number) {
  const matchesPart = (part: string) => {
    const [range, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    const [startText, endText] = range === "*" ? [String(minimum), String(maximum)] : range.split("-");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    return Number.isInteger(start) && Number.isInteger(end) && start >= minimum && end <= maximum && start <= end && value >= start && value <= end && (value - start) % step === 0;
  };
  return expression.split(",").some(matchesPart);
}

export function isUtcCronDue(cronExpression: string, date: Date) {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 6) return false;
  const values: CronDate = { second: date.getUTCSeconds(), minute: date.getUTCMinutes(), hour: date.getUTCHours(), day: date.getUTCDate(), month: date.getUTCMonth() + 1, weekday: date.getUTCDay() };
  return matchesCronField(fields[0], values.second, 0, 59)
    && matchesCronField(fields[1], values.minute, 0, 59)
    && matchesCronField(fields[2], values.hour, 0, 23)
    && matchesCronField(fields[3], values.day, 1, 31)
    && matchesCronField(fields[4], values.month, 1, 12)
    && matchesCronField(fields[5], values.weekday, 0, 6);
}

function authorisedWorker(req: Request) {
  const configured = process.env.INTERNAL_SCHEDULER_TOKEN;
  const candidate = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || candidate.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(configured));
}

export async function runDueDailyReports(now = new Date()) {
  const reports = await listEnabledDailyReports();
  const deliveryKey = now.toISOString().slice(0, 10);
  const outcomes: Array<{ reportId: number; state: "sent" | "skipped" | "failed" }> = [];
  for (const report of reports) {
    if (!report.isEnabled) continue;
    if (!isUtcCronDue(report.cronExpression, now)) continue;
    const claimed = await claimDailyReportDelivery(report.id, deliveryKey);
    if (!claimed) { outcomes.push({ reportId: report.id, state: "skipped" }); continue; }
    try {
      const dashboard = await getAssistantDashboard(report.userId);
      await sendDailyWorkspaceReport({ to: report.recipientEmail, ...dashboard.metrics });
      await markDailyReportDelivery(report.id, deliveryKey);
      outcomes.push({ reportId: report.id, state: "sent" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      await releaseDailyReportDelivery(report.id, deliveryKey, reason);
      console.warn("[Daily reports] delivery failed", { reportId: report.id, reason });
      outcomes.push({ reportId: report.id, state: "failed" });
    }
  }
  return outcomes;
}

export function registerDailyReportRoutes(app: Express) {
  app.post("/internal/scheduler/daily-reports", async (req: Request, res: Response) => {
    if (!authorisedWorker(req)) return res.status(403).json({ error: "forbidden" });
    try {
      const outcomes = await runDueDailyReports();
      return res.json({ ok: true, processed: outcomes.length, sent: outcomes.filter(item => item.state === "sent").length, failed: outcomes.filter(item => item.state === "failed").length });
    } catch (error) {
      console.error("[Daily reports] scheduler run failed", error instanceof Error ? error.message : "unknown");
      return res.status(503).json({ error: "scheduler_unavailable" });
    }
  });
}
