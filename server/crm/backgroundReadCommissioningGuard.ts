import { and, eq, inArray, ne } from "drizzle-orm";
import { crmCommissioningJobs } from "../../drizzle/schema";
import { getDb } from "../db";

export const ACTIVE_COMMISSIONING_STATUSES = ["queued", "running"] as const;

export function commissioningBlocksBackgroundReads(
  status: string | null | undefined,
  state?: string | null
) {
  return state !== "READY" && (status === "queued" || status === "running");
}

export async function connectedSystemHasActiveCommissioning(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const active = (
    await db
      .select({ id: crmCommissioningJobs.id })
      .from(crmCommissioningJobs)
      .where(
        and(
          eq(crmCommissioningJobs.organisationId, input.organisationId),
          eq(crmCommissioningJobs.connectedSystemId, input.connectedSystemId),
          inArray(crmCommissioningJobs.status, [
            ...ACTIVE_COMMISSIONING_STATUSES,
          ]),
          ne(crmCommissioningJobs.state, "READY")
        )
      )
      .limit(1)
  )[0];
  return Boolean(active);
}
