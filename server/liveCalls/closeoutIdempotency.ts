import { randomUUID } from "node:crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { actionProposals, workflowRuns } from "../../drizzle/schema";
import { getDb } from "../db";
import type { ProposedAction } from "../workflowRules";

const CLAIM_LEASE_MS = 5 * 60_000;
export type CanonicalCloseoutResult = Record<string, unknown>;
export type CloseoutClaim =
  | {
      state: "claimed";
      workflowRunId: number;
      claimToken: string;
      input: Record<string, unknown>;
    }
  | {
      state: "completed";
      workflowRunId: number;
      result: CanonicalCloseoutResult;
    }
  | { state: "processing"; workflowRunId: number };

function closeoutKey(organisationId: number, callSessionId: number) {
  return `live-call-closeout:${organisationId}:${callSessionId}`;
}

async function dbOrThrow() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function claimCallCloseout(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
  leadLabel: string;
}): Promise<CloseoutClaim> {
  const db = await dbOrThrow();
  const claimToken = randomUUID();
  const idempotencyKey = closeoutKey(input.organisationId, input.callSessionId);
  const claimExpiresAt = new Date(Date.now() + CLAIM_LEASE_MS);
  await db
    .insert(workflowRuns)
    .values({
      userId: input.userId,
      organisationId: input.organisationId,
      workflowKey: "post_call_closeout",
      idempotencyKey,
      leadLabel: input.leadLabel,
      status: "prepared",
      input: {
        sourceCallSessionId: input.callSessionId,
        closeoutStatus: "processing",
      },
      claimToken,
      claimExpiresAt,
      verificationSummary:
        "Canonical post-call closeout claimed; deterministic preparation is in progress.",
    })
    .onDuplicateKeyUpdate({ set: { idempotencyKey } });
  let workflow = (
    await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.userId, input.userId),
          eq(workflowRuns.organisationId, input.organisationId),
          eq(workflowRuns.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1)
  )[0];
  if (!workflow)
    throw new Error("Canonical call closeout workflow could not be claimed.");
  if (workflow.status === "completed" && workflow.result)
    return {
      state: "completed",
      workflowRunId: workflow.id,
      result: workflow.result,
    };
  if (workflow.claimToken === claimToken)
    return {
      state: "claimed",
      workflowRunId: workflow.id,
      claimToken,
      input: workflow.input,
    };
  await db
    .update(workflowRuns)
    .set({
      status: "prepared",
      claimToken,
      claimExpiresAt,
      input: { ...workflow.input, closeoutStatus: "processing" },
    })
    .where(
      and(
        eq(workflowRuns.id, workflow.id),
        or(
          eq(workflowRuns.status, "failed"),
          lt(workflowRuns.claimExpiresAt, new Date())
        )
      )
    );
  workflow = (
    await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflow.id))
      .limit(1)
  )[0];
  if (workflow?.claimToken === claimToken)
    return {
      state: "claimed",
      workflowRunId: workflow.id,
      claimToken,
      input: workflow.input,
    };
  if (workflow?.status === "completed" && workflow.result)
    return {
      state: "completed",
      workflowRunId: workflow.id,
      result: workflow.result,
    };
  return { state: "processing", workflowRunId: workflow.id };
}

export async function readCallCloseout(workflowRunId: number) {
  const db = await dbOrThrow();
  return (
    await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId))
      .limit(1)
  )[0];
}

export async function saveCallCloseoutSummary(input: {
  workflowRunId: number;
  claimToken: string;
  summaryResult: Record<string, unknown>;
}) {
  const db = await dbOrThrow();
  const workflow = (
    await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, input.workflowRunId),
          eq(workflowRuns.claimToken, input.claimToken)
        )
      )
      .limit(1)
  )[0];
  if (!workflow) throw new Error("CLOSEOUT_CLAIM_LOST");
  await db
    .update(workflowRuns)
    .set({
      input: { ...workflow.input, summaryResult: input.summaryResult },
      claimExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
    })
    .where(
      and(
        eq(workflowRuns.id, input.workflowRunId),
        eq(workflowRuns.claimToken, input.claimToken)
      )
    );
}

export async function prepareClaimedCloseoutWorkflow(input: {
  workflowRunId: number;
  claimToken: string;
  payload: Record<string, unknown>;
  verificationSummary: string;
  actions: ProposedAction[];
}) {
  const db = await dbOrThrow();
  await db.transaction(async tx => {
    const claimed = (
      await tx
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, input.workflowRunId),
            eq(workflowRuns.claimToken, input.claimToken),
            eq(workflowRuns.status, "prepared")
          )
        )
        .limit(1)
    )[0];
    if (!claimed) throw new Error("CLOSEOUT_CLAIM_LOST");
    await tx
      .update(workflowRuns)
      .set({
        input: input.payload,
        verificationSummary: input.verificationSummary,
        claimExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
      })
      .where(eq(workflowRuns.id, input.workflowRunId));
    if (input.actions.length)
      await tx
        .insert(actionProposals)
        .values(
          input.actions.map(action => ({
            userId: Number(input.payload.userId),
            organisationId: Number(input.payload.organisationId),
            workflowRunId: input.workflowRunId,
            actionType: action.actionType,
            title: action.title,
            targetLabel: action.targetLabel,
            idempotencyKey: action.idempotencyKey,
            payload: action.payload,
            state: ((
              action.payload.crmRoute as { routable?: boolean } | undefined
            )?.routable === false
              ? "blocked"
              : "review_required") as "blocked" | "review_required",
          }))
        )
        .onDuplicateKeyUpdate({
          set: { idempotencyKey: sql`${actionProposals.idempotencyKey}` },
        });
  });
}

export async function completeCallCloseout(input: {
  workflowRunId: number;
  claimToken: string;
  result: CanonicalCloseoutResult;
}) {
  const db = await dbOrThrow();
  await db
    .update(workflowRuns)
    .set({
      status: "completed",
      result: input.result,
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(workflowRuns.id, input.workflowRunId),
        eq(workflowRuns.claimToken, input.claimToken)
      )
    );
}

export async function failCallCloseout(input: {
  workflowRunId: number;
  claimToken: string;
  error: string;
}) {
  const db = await dbOrThrow();
  const workflow = (
    await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.id, input.workflowRunId),
          eq(workflowRuns.claimToken, input.claimToken)
        )
      )
      .limit(1)
  )[0];
  if (!workflow) return;
  await db
    .update(workflowRuns)
    .set({
      status: "failed",
      input: {
        ...workflow.input,
        closeoutStatus: "failed",
        lastError: input.error.slice(0, 500),
      },
      claimToken: null,
      claimExpiresAt: null,
    })
    .where(
      and(
        eq(workflowRuns.id, input.workflowRunId),
        eq(workflowRuns.claimToken, input.claimToken)
      )
    );
}

export type CloseoutStore = {
  claim: typeof claimCallCloseout;
  read: typeof readCallCloseout;
  complete: typeof completeCallCloseout;
  fail: typeof failCallCloseout;
};

const durableStore: CloseoutStore = {
  claim: claimCallCloseout,
  read: readCallCloseout,
  complete: completeCallCloseout,
  fail: failCallCloseout,
};

export async function runCanonicalCallCloseout<
  T extends CanonicalCloseoutResult,
>(
  input: {
    userId: number;
    organisationId: number;
    callSessionId: number;
    leadLabel: string;
  },
  work: (claim: Extract<CloseoutClaim, { state: "claimed" }>) => Promise<T>,
  store: CloseoutStore = durableStore
): Promise<T> {
  const claim = await store.claim(input);
  if (claim.state === "completed") return claim.result as T;
  if (claim.state === "processing") {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const workflow = await store.read(claim.workflowRunId);
      if (workflow?.status === "completed" && workflow.result)
        return workflow.result as T;
      if (workflow?.status === "failed")
        throw new Error(
          String(
            (workflow.input as Record<string, unknown>)?.lastError ||
              "Canonical call closeout failed; retry is safe."
          )
        );
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(
      "CLOSEOUT_PROCESSING: canonical closeout is still processing; retry safely."
    );
  }
  try {
    const result = await work(claim);
    await store.complete({
      workflowRunId: claim.workflowRunId,
      claimToken: claim.claimToken,
      result,
    });
    return result;
  } catch (error) {
    await store.fail({
      workflowRunId: claim.workflowRunId,
      claimToken: claim.claimToken,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
