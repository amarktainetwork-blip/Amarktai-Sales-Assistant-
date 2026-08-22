import { operationalAlertDeliveries, operationalAlertRules, operationalEvents } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { shouldRouteOperationalAlert } from "./alerts";

export type OperationalEventInput = {
  organisationId?: number | null;
  connectedSystemId?: number | null;
  severity?: "info" | "warning" | "error" | "critical";
  category: string;
  eventKey: string;
  summary: string;
  detail?: Record<string, unknown>;
};

/** Best-effort observability must never turn a completed business operation into a failed one. */
export async function recordOperationalEvent(input: OperationalEventInput) {
  const db = await getDb();
  if (!db) return { recorded: false, reason: "database_unavailable" as const };
  const result = await db.insert(operationalEvents).values({
    organisationId: input.organisationId ?? null,
    connectedSystemId: input.connectedSystemId ?? null,
    severity: input.severity ?? "info",
    category: input.category.slice(0, 100),
    eventKey: input.eventKey.slice(0, 180),
    summary: input.summary.slice(0, 8_000),
    detail: input.detail ?? {},
  });
  if (input.organisationId) {
    const rules = await db.select().from(operationalAlertRules).where(eq(operationalAlertRules.organisationId, input.organisationId));
    const event = { severity: input.severity ?? "info", category: input.category } as const;
    const eligibleRules = rules.filter(rule => shouldRouteOperationalAlert(rule, event));
    if (eligibleRules.length) await db.insert(operationalAlertDeliveries).values(eligibleRules.map(rule => ({ operationalEventId: Number(result[0].insertId), alertRuleId: rule.id })));
  }
  return { recorded: true as const };
}
