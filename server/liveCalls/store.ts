import { and, eq } from "drizzle-orm";
import { callSessions } from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import { createAssistantMemory, isSafeAssistantMemory } from "../memory";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function requireLiveCallOwner(
  userId: number,
  organisationId: number,
  callSessionId: number
) {
  const db = await dbOrThrow();
  const session = (
    await db
      .select()
      .from(callSessions)
      .where(
        and(
          eq(callSessions.id, callSessionId),
          eq(callSessions.userId, userId),
          eq(callSessions.organisationId, organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!session) throw new Error("Live call session was not found.");
  return session;
}

export async function completeLiveCallExact(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
  transcript: string;
  summary: string;
  structuredOutcome: Record<string, unknown>;
}) {
  const db = await dbOrThrow();
  const session = await requireLiveCallOwner(
    input.userId,
    input.organisationId,
    input.callSessionId
  );
  const transcript = input.transcript.trim().slice(-40_000);
  const summary = input.summary.trim().slice(0, 20_000);
  await db
    .update(callSessions)
    .set({
      transcript,
      summary,
      structuredOutcome: input.structuredOutcome,
      status: "ready_for_review",
    })
    .where(
      and(
        eq(callSessions.id, input.callSessionId),
        eq(callSessions.userId, input.userId),
        eq(callSessions.organisationId, input.organisationId)
      )
    );

  const memorySubject = session.leadLabel?.trim() || `Call ${input.callSessionId}`;
  const outcome = JSON.stringify(input.structuredOutcome).slice(0, 4_000);
  const memoryContent = `${summary}${outcome && outcome !== "{}" ? `\nConfirmed outcome: ${outcome}` : ""}`.trim();
  if (memoryContent && isSafeAssistantMemory(`${memorySubject}\n${memoryContent}`))
    await createAssistantMemory({
      userId: input.userId,
      organisationId: input.organisationId,
      memoryType: "conversation_reference",
      subject: memorySubject,
      content: memoryContent,
      provenance: "call",
      trust: "inferred",
      sourceReference: `call:${input.callSessionId}:summary`,
      occurredAt: new Date(),
    });

  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "live_call_completed",
    entityType: "call_session",
    entityId: String(input.callSessionId),
    summary:
      "Live Call Companion completed and prepared a reviewable post-call summary.",
    metadata: {
      transcriptChars: transcript.length,
      rawAudioRetained: false,
      safeAssistantMemoryRetained: Boolean(
        memoryContent &&
          isSafeAssistantMemory(`${memorySubject}\n${memoryContent}`)
      ),
    },
  });
}