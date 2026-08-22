import { operationalEvents } from "../../drizzle/schema";
import { getDb } from "../db";

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
  await db.insert(operationalEvents).values({
    organisationId: input.organisationId ?? null,
    connectedSystemId: input.connectedSystemId ?? null,
    severity: input.severity ?? "info",
    category: input.category.slice(0, 100),
    eventKey: input.eventKey.slice(0, 180),
    summary: input.summary.slice(0, 8_000),
    detail: input.detail ?? {},
  });
  return { recorded: true as const };
}
