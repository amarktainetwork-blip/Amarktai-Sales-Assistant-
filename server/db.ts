import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import bcrypt from "bcryptjs";
import {
  actionProposals,
  auditEntries,
  callbackTasks,
  callSessions,
  dailyReports,
  integrationProfiles,
  knowledgeSources,
  twoFactorChallenges,
  type InsertUser,
  users,
  workflowRuns,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { ProposedAction } from "./workflowRules";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
}

export async function createLocalAdminIfMissing() {
  const email = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD are required for Webdock local authentication.");
  const db = await requireDb();
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    openId: `local:${email}`,
    email,
    name: process.env.LOCAL_ADMIN_NAME || "Amarktai Administrator",
    loginMethod: "local",
    passwordHash,
    role: "admin",
    lastSignedIn: new Date(),
  });
  return getUserByEmail(email);
}

export async function getAssistantDashboard(userId: number) {
  const db = await requireDb();
  const [reviewCount, openTaskCount, knowledgeCount, runs, proposals] = await Promise.all([
    db.select({ value: count() }).from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "review_required"))),
    db.select({ value: count() }).from(callbackTasks).where(and(eq(callbackTasks.userId, userId), eq(callbackTasks.state, "open"))),
    db.select({ value: count() }).from(knowledgeSources).where(eq(knowledgeSources.userId, userId)),
    db.select().from(workflowRuns).where(eq(workflowRuns.userId, userId)).orderBy(desc(workflowRuns.createdAt)).limit(6),
    db.select().from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "review_required"))).orderBy(desc(actionProposals.createdAt)).limit(8),
  ]);

  return {
    metrics: {
      actionsAwaitingReview: reviewCount[0]?.value ?? 0,
      openCallbackTasks: openTaskCount[0]?.value ?? 0,
      knowledgeSources: knowledgeCount[0]?.value ?? 0,
    },
    runs,
    proposals,
  };
}

export async function createWorkflowRun(input: {
  userId: number;
  workflowKey: string;
  leadLabel: string;
  payload: Record<string, unknown>;
  verificationSummary: string;
  actions: ProposedAction[];
}) {
  const db = await requireDb();
  const inserted = await db.insert(workflowRuns).values({
    userId: input.userId,
    workflowKey: input.workflowKey,
    leadLabel: input.leadLabel,
    input: input.payload,
    verificationSummary: input.verificationSummary,
  });
  const workflowRunId = Number(inserted[0].insertId);

  if (input.actions.length > 0) {
    await db.insert(actionProposals).values(
      input.actions.map(action => ({
        userId: input.userId,
        workflowRunId,
        actionType: action.actionType,
        title: action.title,
        targetLabel: action.targetLabel,
        idempotencyKey: action.idempotencyKey,
        payload: action.payload,
      })),
    );
  }

  await recordAudit({
    userId: input.userId,
    eventType: "workflow_prepared",
    entityType: "workflow_run",
    entityId: String(workflowRunId),
    summary: `${input.workflowKey} prepared for review.`,
    metadata: { actionCount: input.actions.length, leadLabel: input.leadLabel },
  });

  return workflowRunId;
}

export async function listActionProposals(userId: number, workflowRunId?: number) {
  const db = await requireDb();
  const whereClause = workflowRunId
    ? and(eq(actionProposals.userId, userId), eq(actionProposals.workflowRunId, workflowRunId))
    : eq(actionProposals.userId, userId);
  return db.select().from(actionProposals).where(whereClause).orderBy(desc(actionProposals.createdAt)).limit(40);
}

export async function reviewActionProposal(userId: number, proposalId: number, state: "approved" | "skipped") {
  const db = await requireDb();
  await db
    .update(actionProposals)
    .set({ state, reviewedAt: new Date() })
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId), eq(actionProposals.state, "review_required")));
  await recordAudit({
    userId,
    eventType: `action_${state}`,
    entityType: "action_proposal",
    entityId: String(proposalId),
    summary: `Action proposal marked ${state}; no external execution was attempted.`,
    metadata: {},
  });
}

export async function getApprovedActionProposal(userId: number, proposalId: number) {
  const db = await requireDb();
  return (await db
    .select()
    .from(actionProposals)
    .where(and(eq(actionProposals.id, proposalId), eq(actionProposals.userId, userId), eq(actionProposals.state, "approved")))
    .limit(1))[0];
}

export async function recordActionExecution(input: { userId: number; proposalId: number; success: boolean; result: Record<string, unknown> }) {
  const db = await requireDb();
  const state: "executed" | "blocked" = input.success ? "executed" : "blocked";
  await db
    .update(actionProposals)
    .set({ state, executedAt: new Date(), executionResult: input.result })
    .where(and(eq(actionProposals.id, input.proposalId), eq(actionProposals.userId, input.userId), eq(actionProposals.state, "approved")));
  await recordAudit({
    userId: input.userId,
    eventType: input.success ? "genie_action_executed" : "genie_action_blocked",
    entityType: "action_proposal",
    entityId: String(input.proposalId),
    summary: input.success ? "Approved Genie saved script completed." : "Approved Genie saved script failed and was blocked.",
    metadata: input.result,
  });
}

export async function listIntegrationProfiles(userId: number) {
  const db = await requireDb();
  return db.select().from(integrationProfiles).where(eq(integrationProfiles.userId, userId)).orderBy(desc(integrationProfiles.updatedAt));
}

export async function createIntegrationProfile(input: {
  userId: number;
  provider: "genie" | "outlook" | "genx";
  displayName: string;
  scopeSummary?: string;
}) {
  const db = await requireDb();
  const result = await db.insert(integrationProfiles).values({ ...input, status: "needs_credentials" });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    eventType: "integration_profile_created",
    entityType: "integration_profile",
    entityId: String(id),
    summary: `${input.provider} profile saved without secrets.`,
    metadata: { provider: input.provider },
  });
  return id;
}

export async function listKnowledgeSources(userId: number) {
  const db = await requireDb();
  return db.select().from(knowledgeSources).where(eq(knowledgeSources.userId, userId)).orderBy(desc(knowledgeSources.updatedAt));
}

export async function createKnowledgeSource(input: {
  userId: number;
  title: string;
  sourceType: "note" | "url" | "document";
  sourceUrl?: string;
  content?: string;
}) {
  const db = await requireDb();
  const result = await db.insert(knowledgeSources).values({ ...input, status: "ready" });
  return Number(result[0].insertId);
}

export async function createCallSession(input: {
  userId: number;
  leadLabel: string;
  transcript?: string;
  coachNotes?: string;
}) {
  const db = await requireDb();
  const result = await db.insert(callSessions).values({ ...input, status: "ready_for_review" });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    eventType: "call_note_saved",
    entityType: "call_session",
    entityId: String(id),
    summary: "Call note saved for review.",
    metadata: { leadLabel: input.leadLabel },
  });
  return id;
}

export async function recordAudit(input: {
  userId: number;
  eventType: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata: Record<string, unknown>;
}) {
  const db = await requireDb();
  await db.insert(auditEntries).values(input);
}

export async function createTwoFactorChallenge(input: { userId: number; codeHash: string; expiresAt: Date }) {
  const db = await requireDb();
  await db.insert(twoFactorChallenges).values(input);
}

export async function consumeValidTwoFactorChallenge(input: { userId: number; isValid: (hash: string) => boolean }) {
  const db = await requireDb();
  const challenge = (await db.select().from(twoFactorChallenges).where(and(eq(twoFactorChallenges.userId, input.userId), isNull(twoFactorChallenges.consumedAt), gt(twoFactorChallenges.expiresAt, new Date()))).orderBy(desc(twoFactorChallenges.createdAt)).limit(1))[0];
  if (!challenge || challenge.attempts >= 5 || !input.isValid(challenge.codeHash)) {
    if (challenge) await db.update(twoFactorChallenges).set({ attempts: challenge.attempts + 1 }).where(eq(twoFactorChallenges.id, challenge.id));
    return false;
  }
  await db.update(twoFactorChallenges).set({ consumedAt: new Date() }).where(eq(twoFactorChallenges.id, challenge.id));
  return true;
}

export async function createDailyReport(input: { userId: number; recipientEmail: string; cronExpression: string }) {
  const db = await requireDb();
  const result = await db.insert(dailyReports).values(input);
  return Number(result[0].insertId);
}

export async function attachDailyReportTask(input: { reportId: number; userId: number; taskUid: string }) {
  const db = await requireDb();
  await db.update(dailyReports).set({ scheduleCronTaskUid: input.taskUid }).where(and(eq(dailyReports.id, input.reportId), eq(dailyReports.userId, input.userId)));
}

export async function listDailyReports(userId: number) {
  const db = await requireDb();
  return db.select().from(dailyReports).where(eq(dailyReports.userId, userId)).orderBy(desc(dailyReports.createdAt));
}

export async function getDailyReportByTaskUid(taskUid: string) {
  const db = await requireDb();
  return (await db.select().from(dailyReports).where(eq(dailyReports.scheduleCronTaskUid, taskUid)).limit(1))[0];
}

export async function markDailyReportDelivery(reportId: number, deliveryKey: string) {
  const db = await requireDb();
  await db.update(dailyReports).set({ lastDeliveryKey: deliveryKey, lastSentAt: new Date() }).where(eq(dailyReports.id, reportId));
}

export async function releaseDailyReportDelivery(reportId: number, deliveryKey: string) {
  const db = await requireDb();
  await db.update(dailyReports).set({ lastDeliveryKey: null }).where(and(eq(dailyReports.id, reportId), eq(dailyReports.lastDeliveryKey, deliveryKey)));
}
