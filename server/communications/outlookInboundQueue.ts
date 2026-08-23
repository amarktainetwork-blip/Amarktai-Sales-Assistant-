import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { outlookInboundQueue } from "../../drizzle/schema";
import { getDb } from "../db";
import { recordOperationalEvent } from "../observability/events";
import { readOutlookInboundMessage } from "../outlook";
import { ingestInboundMessage } from "./inboundPipeline";

export const OUTLOOK_INBOUND_MAX_ATTEMPTS = 5;

export async function enqueueOutlookInbound(input: {
  organisationId: number;
  messageId: string;
  subscriptionId?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const messageId = input.messageId.trim().slice(0, 512);
  if (!messageId || /[\u0000-\u001f]/.test(messageId))
    throw new Error("A valid Outlook message ID is required.");
  await db
    .insert(outlookInboundQueue)
    .values({
      organisationId: input.organisationId,
      messageId,
      subscriptionId: input.subscriptionId?.trim().slice(0, 180) || null,
      status: "queued",
      nextAttemptAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        subscriptionId: input.subscriptionId?.trim().slice(0, 180) || null,
      },
    });
  return { accepted: true as const, messageId };
}

export async function enqueueOutlookInboundBatch(
  items: Array<{
    organisationId: number;
    messageId: string;
    subscriptionId?: string;
  }>
) {
  if (!items.length) return { accepted: 0 };
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const values = items.slice(0, 100).map(item => {
    const messageId = item.messageId.trim().slice(0, 512);
    if (!messageId || /[\u0000-\u001f]/.test(messageId))
      throw new Error("A valid Outlook message ID is required.");
    return {
      organisationId: item.organisationId,
      messageId,
      subscriptionId: item.subscriptionId?.trim().slice(0, 180) || null,
      status: "queued" as const,
      nextAttemptAt: new Date(),
    };
  });
  await db
    .insert(outlookInboundQueue)
    .values(values)
    .onDuplicateKeyUpdate({
      set: { updatedAt: new Date() },
    });
  return { accepted: values.length };
}

async function claimOutlookInbound() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const stale = new Date(now.valueOf() - 5 * 60_000);
  const candidate = (
    await db
      .select()
      .from(outlookInboundQueue)
      .where(
        or(
          and(
            eq(outlookInboundQueue.status, "queued"),
            lte(outlookInboundQueue.nextAttemptAt, now)
          ),
          and(
            eq(outlookInboundQueue.status, "processing"),
            lt(outlookInboundQueue.claimedAt, stale)
          )
        )
      )
      .limit(1)
  )[0];
  if (!candidate) return undefined;
  const claimed = await db
    .update(outlookInboundQueue)
    .set({
      status: "processing",
      claimedAt: now,
      attempts: sql`${outlookInboundQueue.attempts} + 1`,
    })
    .where(
      and(
        eq(outlookInboundQueue.id, candidate.id),
        eq(outlookInboundQueue.status, candidate.status),
        eq(outlookInboundQueue.attempts, candidate.attempts)
      )
    );
  if (claimed[0].affectedRows !== 1) return undefined;
  return { ...candidate, attempts: candidate.attempts + 1 };
}

export async function processOutlookQueuePayload(input: {
  organisationId: number;
  messageId: string;
  readMessage?: typeof readOutlookInboundMessage;
  ingest?: typeof ingestInboundMessage;
}) {
  const readMessage = input.readMessage || readOutlookInboundMessage;
  const ingest = input.ingest || ingestInboundMessage;
  const envelope = await readMessage(input.messageId);
  return ingest({ organisationId: input.organisationId, envelope });
}

export function outlookRetryDecision(attempts: number, now = new Date()) {
  if (attempts >= OUTLOOK_INBOUND_MAX_ATTEMPTS)
    return { status: "dead_letter" as const, nextAttemptAt: now };
  const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return {
    status: "queued" as const,
    nextAttemptAt: new Date(now.valueOf() + delayMs),
  };
}

export async function processNextOutlookInbound() {
  const item = await claimOutlookInbound();
  if (!item) return { processed: false as const };
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  try {
    const result = await processOutlookQueuePayload(item);
    await db
      .update(outlookInboundQueue)
      .set({
        status: "processed",
        processedAt: new Date(),
        claimedAt: null,
        lastError: null,
      })
      .where(eq(outlookInboundQueue.id, item.id));
    return { processed: true as const, id: item.id, result };
  } catch (error) {
    const decision = outlookRetryDecision(item.attempts);
    const detail =
      error instanceof Error
        ? error.message.slice(0, 8_000)
        : String(error).slice(0, 8_000);
    await db
      .update(outlookInboundQueue)
      .set({
        status: decision.status,
        nextAttemptAt: decision.nextAttemptAt,
        claimedAt: null,
        lastError: detail,
      })
      .where(eq(outlookInboundQueue.id, item.id));
    if (decision.status === "dead_letter")
      await recordOperationalEvent({
        organisationId: item.organisationId,
        severity: "error",
        category: "outlook_inbound",
        eventKey: "outlook_inbound_dead_letter",
        summary:
          "An Outlook inbound notification exhausted bounded retries and requires operator attention.",
        detail: {
          queueId: item.id,
          attempts: item.attempts,
          error: detail.slice(0, 800),
        },
      });
    return {
      processed: false as const,
      id: item.id,
      status: decision.status,
      attempts: item.attempts,
    };
  }
}
