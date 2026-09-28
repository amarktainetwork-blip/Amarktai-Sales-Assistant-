import { and, eq } from "drizzle-orm";
import { callSessions } from "../../drizzle/schema";
import { getDb, recordAudit } from "../db";
import { createAssistantMemory, isSafeAssistantMemory } from "../memory";

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export const LIVE_CALL_ABANDON_GRACE_MS = 15 * 60_000;

export function shouldCheckpointAbandonedLiveCall(input: {
  status: string;
  updatedAt: Date | string;
  nowMs?: number;
  graceMs?: number;
}) {
  if (input.status !== "in_progress") return false;
  const updatedAtMs = new Date(input.updatedAt).valueOf();
  if (!Number.isFinite(updatedAtMs)) return false;
  return (
    (input.nowMs ?? Date.now()) - updatedAtMs >=
    (input.graceMs ?? LIVE_CALL_ABANDON_GRACE_MS)
  );
}

export async function reconcileAbandonedLiveCallsForUser(input: {
  userId: number;
  organisationId: number;
  nowMs?: number;
  graceMs?: number;
}) {
  const db = await dbOrThrow();
  const candidates = await db
    .select({
      id: callSessions.id,
      status: callSessions.status,
      transcript: callSessions.transcript,
      coachNotes: callSessions.coachNotes,
      updatedAt: callSessions.updatedAt,
    })
    .from(callSessions)
    .where(
      and(
        eq(callSessions.userId, input.userId),
        eq(callSessions.organisationId, input.organisationId),
        eq(callSessions.status, "in_progress")
      )
    )
    .limit(200);
  const stale = candidates.filter(session =>
    shouldCheckpointAbandonedLiveCall({
      status: session.status,
      updatedAt: session.updatedAt,
      nowMs: input.nowMs,
      graceMs: input.graceMs,
    })
  );
  for (const session of stale) {
    await db
      .update(callSessions)
      .set({ status: "ready_for_review" })
      .where(
        and(
          eq(callSessions.id, session.id),
          eq(callSessions.userId, input.userId),
          eq(callSessions.organisationId, input.organisationId),
          eq(callSessions.status, "in_progress")
        )
      );
  }
  if (stale.length) {
    await recordAudit({
      userId: input.userId,
      organisationId: input.organisationId,
      eventType: "live_call_abandoned_checkpointed",
      entityType: "call_session_batch",
      summary:
        "Inactive live call sessions were checkpointed for review without inventing customer outcomes.",
      metadata: {
        sessionIds: stale.map(session => session.id),
        checkpointed: stale.length,
        withTranscript: stale.filter(session => Boolean(session.transcript?.trim()))
          .length,
        withCoachNotes: stale.filter(session => Boolean(session.coachNotes?.trim()))
          .length,
        graceMs: input.graceMs ?? LIVE_CALL_ABANDON_GRACE_MS,
      },
    });
  }
  return {
    checkpointed: stale.length,
    withContent: stale.filter(
      session => Boolean(session.transcript?.trim()) || Boolean(session.coachNotes?.trim())
    ).length,
  };
}

export async function reconcileAllAbandonedLiveCalls(input: {
  nowMs?: number;
  graceMs?: number;
} = {}) {
  const db = await dbOrThrow();
  const candidates = await db
    .select({
      userId: callSessions.userId,
      organisationId: callSessions.organisationId,
      status: callSessions.status,
      updatedAt: callSessions.updatedAt,
    })
    .from(callSessions)
    .where(eq(callSessions.status, "in_progress"))
    .limit(500);
  const groups = new Map<string, { userId: number; organisationId: number }>();
  for (const session of candidates) {
    if (
      session.userId == null ||
      session.organisationId == null ||
      !shouldCheckpointAbandonedLiveCall({
        status: session.status,
        updatedAt: session.updatedAt,
        nowMs: input.nowMs,
        graceMs: input.graceMs,
      })
    )
      continue;
    groups.set(`${session.userId}:${session.organisationId}`, {
      userId: session.userId,
      organisationId: session.organisationId,
    });
  }
  let checkpointed = 0;
  let withContent = 0;
  for (const group of Array.from(groups.values())) {
    const result = await reconcileAbandonedLiveCallsForUser({
      ...group,
      nowMs: input.nowMs,
      graceMs: input.graceMs,
    });
    checkpointed += result.checkpointed;
    withContent += result.withContent;
  }
  return { checkpointed, withContent, userOrganisationGroups: groups.size };
}

export function checkpointTranscript(
  existing: string | null | undefined,
  incoming: string
) {
  const current = (existing || "").trim().slice(-40_000);
  const candidate = incoming.trim().slice(-40_000);
  return candidate.length >= current.length ? candidate : current;
}

export function assertLiveCallState(
  status: string,
  allowed: readonly string[],
  action: string
) {
  if (!allowed.includes(status))
    throw new Error(
      `LIVE_CALL_STATE: ${action} is not allowed while the call is ${status}.`
    );
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

export async function markLiveCallReadyForReview(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
  transcript: string;
  manualNotes?: string;
}) {
  const db = await dbOrThrow();
  const session = await requireLiveCallOwner(
    input.userId,
    input.organisationId,
    input.callSessionId
  );
  const transcript = checkpointTranscript(session.transcript, input.transcript);
  const manualNotes = input.manualNotes?.trim().slice(0, 12_000) || "";
  const previousOutcome =
    session.structuredOutcome &&
    typeof session.structuredOutcome === "object" &&
    !Array.isArray(session.structuredOutcome)
      ? session.structuredOutcome
      : {};
  if (session.status === "completed")
    return {
      status: "completed" as const,
      transcriptChars: session.transcript?.trim().length ?? transcript.length,
    };
  await db
    .update(callSessions)
    .set({
      transcript,
      structuredOutcome: manualNotes
        ? { ...previousOutcome, draftManualNotes: manualNotes }
        : previousOutcome,
      status: "ready_for_review",
    })
    .where(
      and(
        eq(callSessions.id, input.callSessionId),
        eq(callSessions.userId, input.userId),
        eq(callSessions.organisationId, input.organisationId)
      )
    );
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "live_call_ready_for_review",
    entityType: "call_session",
    entityId: String(input.callSessionId),
    summary:
      "Live call capture stopped and the current transcript was checkpointed for review.",
    metadata: {
      transcriptChars: transcript.length,
      salespersonNoteChars: manualNotes.length,
      rawAudioRetained: false,
    },
  });
  return { status: "ready_for_review" as const, transcriptChars: transcript.length };
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
  const transcript = checkpointTranscript(session.transcript, input.transcript);
  const summary = input.summary.trim().slice(0, 20_000);
  await db
    .update(callSessions)
    .set({
      transcript,
      summary,
      structuredOutcome: input.structuredOutcome,
      status: "completed",
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