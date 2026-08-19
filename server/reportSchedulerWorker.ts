import "dotenv/config";
import { eq } from "drizzle-orm";
import { dailyReports } from "../drizzle/schema";
import { getAssistantDashboard, getDb, markDailyReportDelivery, releaseDailyReportDelivery } from "./db";
import { loadManagementReportSettings } from "./managementSettings";
import { ensureDefaultOrganisation } from "./organisation";
import { canManageOrganisation } from "./organisationAccess";
import { sendDailyWorkspaceReport, sendManagementTeamReport } from "./smtp";
import { getTeamIntelligence } from "./teamIntelligence";

const pollMs = Math.max(10_000, Number(process.env.REPORT_SCHEDULER_POLL_MS || 30_000));
let running = false;

function parseAtom(atom: string, value: number, min: number, max: number) {
  if (atom === "*") return true;
  const step = atom.match(/^\*\/(\d+)$/);
  if (step) { const amount = Number(step[1]); return amount > 0 && value % amount === 0; }
  const range = atom.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
  if (range) { const from = Number(range[1]); const to = Number(range[2]); const amount = Number(range[3] || 1); return from >= min && to <= max && from <= value && value <= to && amount > 0 && (value - from) % amount === 0; }
  const exact = Number(atom);
  return Number.isInteger(exact) && exact >= min && exact <= max && exact === value;
}

function fieldMatches(field: string, value: number, min: number, max: number) { return field.split(",").some(atom => parseAtom(atom.trim(), value, min, max)); }

export function cronMatchesUtc(expression: string, now: Date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 6) return false;
  const [second, minute, hour, day, month, weekday] = fields;
  return fieldMatches(second, now.getUTCSeconds(), 0, 59) && fieldMatches(minute, now.getUTCMinutes(), 0, 59) && fieldMatches(hour, now.getUTCHours(), 0, 23) && fieldMatches(day, now.getUTCDate(), 1, 31) && fieldMatches(month, now.getUTCMonth() + 1, 1, 12) && fieldMatches(weekday, now.getUTCDay(), 0, 6);
}

function deliveryKey(reportId: number, now: Date) { return `${reportId}:${now.toISOString().slice(0, 16)}`; }

async function deliver(report: typeof dailyReports.$inferSelect) {
  const membership = await ensureDefaultOrganisation(report.userId);
  if (!canManageOrganisation(membership.role)) {
    const dashboard = await getAssistantDashboard(report.userId);
    await sendDailyWorkspaceReport({ to: report.recipientEmail, ...dashboard.metrics });
    return { kind: "workspace" as const, sent: true, exceptions: 0 };
  }

  const [team, settings] = await Promise.all([
    getTeamIntelligence({ userId: report.userId, organisationId: membership.organisationId }),
    loadManagementReportSettings(membership.organisationId),
  ]);
  const breaches = team.people.filter(person =>
    (settings.overdueTaskThreshold > 0 && person.overdueTasks >= settings.overdueTaskThreshold)
    || (settings.staleOpportunityThreshold > 0 && person.staleOpportunities >= settings.staleOpportunityThreshold)
    || (settings.noNextStepThreshold > 0 && person.noNextStep >= settings.noNextStepThreshold),
  );
  if (settings.reportMode === "exceptions_only" && breaches.length === 0) return { kind: "management" as const, sent: false, exceptions: 0 };
  const people = settings.reportMode === "daily_full" && settings.includeHealthyPeople ? team.people : breaches;
  await sendManagementTeamReport({
    to: report.recipientEmail,
    organisationName: membership.organisationName,
    mappedSalespeople: team.summary.mappedSalespeople,
    overdueTasks: team.summary.overdueTasks,
    staleOpportunities: team.summary.staleOpportunities,
    pipelineAtRiskMinor: team.summary.pipelineAtRiskMinor,
    people,
  });
  return { kind: "management" as const, sent: true, exceptions: breaches.length };
}

async function runDueReports() {
  if (running) return;
  running = true;
  try {
    const db = await getDb();
    if (!db) throw new Error("Database connection is unavailable.");
    const reports = await db.select().from(dailyReports).where(eq(dailyReports.isEnabled, true));
    const now = new Date();
    for (const report of reports) {
      if (!cronMatchesUtc(report.cronExpression, now)) continue;
      const key = deliveryKey(report.id, now);
      if (report.lastDeliveryKey === key) continue;
      await markDailyReportDelivery(report.id, key);
      try {
        const outcome = await deliver(report);
        console.log(JSON.stringify({ event: outcome.sent ? "daily_report_delivered" : "daily_report_suppressed_no_exceptions", reportId: report.id, userId: report.userId, deliveryKey: key, reportKind: outcome.kind, exceptions: outcome.exceptions }));
      } catch (error) {
        await releaseDailyReportDelivery(report.id, key);
        console.error(JSON.stringify({ event: "daily_report_failed", reportId: report.id, detail: error instanceof Error ? error.message : String(error) }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "report_scheduler_error", detail: error instanceof Error ? error.message : String(error) }));
  } finally {
    running = false;
  }
}

void runDueReports();
const timer = setInterval(() => void runDueReports(), pollMs);
function shutdown() { clearInterval(timer); process.exit(0); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
