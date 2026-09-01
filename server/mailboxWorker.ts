import { and, eq } from "drizzle-orm";
import { userMailboxConnections } from "../drizzle/schema";
import { getDb } from "./db";
import { syncDelegatedMailbox } from "./delegatedMailbox";

const MAX_MAILBOXES_PER_CYCLE = 50;

/**
 * Refresh connected personal mailboxes without relying on an organisation-wide
 * application mailbox. Each sync re-enters the delegated mailbox boundary with
 * the owning user + organisation so membership/isolation checks remain active.
 */
export async function syncReadyDelegatedMailboxes() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");

  const connections = await db
    .select({
      id: userMailboxConnections.id,
      userId: userMailboxConnections.userId,
      organisationId: userMailboxConnections.organisationId,
      provider: userMailboxConnections.provider,
    })
    .from(userMailboxConnections)
    .where(
      and(
        eq(userMailboxConnections.provider, "microsoft"),
        eq(userMailboxConnections.status, "ready")
      )
    )
    .limit(MAX_MAILBOXES_PER_CYCLE);

  let synced = 0;
  let failed = 0;
  let received = 0;
  let draftsPrepared = 0;

  for (const connection of connections) {
    try {
      const result = await syncDelegatedMailbox({
        userId: connection.userId,
        organisationId: connection.organisationId,
      });
      synced += 1;
      received += result.received;
      draftsPrepared += result.draftsPrepared;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          event: "personal_mailbox_sync_failed",
          connectionId: connection.id,
          provider: connection.provider,
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
    }
  }

  return {
    checked: connections.length,
    synced,
    failed,
    received,
    draftsPrepared,
    boundedAt: MAX_MAILBOXES_PER_CYCLE,
  };
}
