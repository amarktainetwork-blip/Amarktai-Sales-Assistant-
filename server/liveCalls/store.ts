import { and, eq } from "drizzle-orm";
import { callSessions } from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function requireLiveCallOwner(userId: number, callSessionId: number) {
  const db = await dbOrThrow();
  const session = (await db.select().from(callSessions).where(and(eq(callSessions.id, callSessionId), eq(callSessions.userId, userId))).limit(1))[0];
  if (!session) throw new Error("Live call session was not found.");
  return session;
}

export async function completeLiveCallExact(input: { userId: number; callSessionId: number; transcript: string; summary: string }) {
  const db = await dbOrThrow();
  await requireLiveCallOwner(input.userId, input.callSessionId);
  const transcript = input.transcript.trim().slice(-40_000);
  await db.update(callSessions).set({
    transcript,
    summary: input.summary.slice(0, 20_000),
    status: "ready_for_review",
  }).where(and(eq(callSessions.id, input.callSessionId), eq(callSessions.userId, input.userId)));
  await recordAudit({
    userId: input.userId,
    eventType: "live_call_completed",
    entityType: "call_session",
    entityId: String(input.callSessionId),
    summary: "Live Call Companion completed and prepared a reviewable post-call summary.",
    metadata: { transcriptChars: transcript.length, rawAudioRetained: false },
  });
}
