import "dotenv/config";
import { organisationCompliancePolicies } from "../../drizzle/schema";
import { getDb } from "../db";
import { recordOperationalEvent } from "../observability/events";
import { buildRetentionPlan } from "./retention";

/**
 * Run once from the VPS scheduler. This intentionally emits dry-run evidence only:
 * a future destructive executor must be separately approved per organisation and
 * should never be enabled merely by an environment variable or timer.
 */
export async function runRetentionSweep(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable for retention sweep.");
  const policies = await db.select().from(organisationCompliancePolicies);
  const outcomes = await Promise.all(policies.map(async policy => {
    const plan = buildRetentionPlan(policy, now);
    await recordOperationalEvent({
      organisationId: policy.organisationId,
      severity: "info",
      category: "compliance",
      eventKey: "retention_dry_run_completed",
      summary: "Retention policy was evaluated in dry-run mode; no records were deleted.",
      detail: { cutoffs: Object.fromEntries(Object.entries(plan.cutoffs).map(([name, cutoff]) => [name, cutoff.toISOString()])), dryRun: true },
    });
    return { organisationId: policy.organisationId, dryRun: plan.dryRun, cutoffs: plan.cutoffs };
  }));
  return outcomes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runRetentionSweep().then(outcomes => console.log(JSON.stringify({ event: "retention_sweep_complete", outcomes }))).catch(error => {
    console.error(JSON.stringify({ event: "retention_sweep_failed", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
