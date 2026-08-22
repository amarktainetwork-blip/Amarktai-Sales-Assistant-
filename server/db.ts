import { and, count, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import bcrypt from "bcryptjs";
import {
  actionProposals,
  auditEntries,
  callbackTasks,
  callSessions,
  companyProfiles,
  crmConnections,
  dailyReportExecutions,
  dailyReports,
  integrationProfiles,
  knowledgeSources,
  twoFactorChallenges,
  type InsertUser,
  users,
  websiteDiscoveries,
  automationPlaybooks,
  agentResponseCache,
  agentUsageEvents,
  communicationDrafts,
  crmContextSnapshots,
  managerFindings,
  workflowRuns,
} from "../drizzle/schema";
import type { ProposedAction } from "./workflowRules";
import { summarizeAgentUsageEvents } from "./agentUsage";

let _db: ReturnType<typeof drizzle> | null = null;

const publicConnectionLabels = {
  genie: "CRM workspace bridge",
  outlook: "Messaging and calendar link",
  genx: "Amarktai intelligence service",
} as const;

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

export async function checkDatabaseReadiness() {
  try {
    const db = await requireDb();
    await db.execute("SELECT 1");
    return { ready: true as const };
  } catch {
    return { ready: false as const };
  }
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

export async function getOrCreateDevelopmentPreviewUser() {
  if (process.env.NODE_ENV !== "development") throw new Error("Development preview access is unavailable outside development.");
  const email = "preview@amarktainetwork.local";
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  const db = await requireDb();
  await db.insert(users).values({ openId: "development-preview", email, name: "Amarktai Dashboard Preview", loginMethod: "local", role: "admin", lastSignedIn: new Date() });
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

export async function getOperationsDashboard(userId: number) {
  const db = await requireDb();
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const [proposals, callbacks, calls, runs, profiles, audit] = await Promise.all([
    db.select().from(actionProposals).where(eq(actionProposals.userId, userId)).orderBy(desc(actionProposals.createdAt)).limit(100),
    db.select().from(callbackTasks).where(eq(callbackTasks.userId, userId)).orderBy(desc(callbackTasks.createdAt)).limit(80),
    db.select().from(callSessions).where(eq(callSessions.userId, userId)).orderBy(desc(callSessions.updatedAt)).limit(40),
    db.select().from(workflowRuns).where(eq(workflowRuns.userId, userId)).orderBy(desc(workflowRuns.updatedAt)).limit(40),
    db.select().from(integrationProfiles).where(eq(integrationProfiles.userId, userId)).orderBy(desc(integrationProfiles.updatedAt)).limit(20),
    db.select().from(auditEntries).where(eq(auditEntries.userId, userId)).orderBy(desc(auditEntries.createdAt)).limit(30),
  ]);
  const openCallbacks = callbacks.filter(task => task.state === "open");
  const overdueCallbacks = openCallbacks.filter(task => task.dueAt && task.dueAt < now);
  const dueTodayCallbacks = openCallbacks.filter(task => task.dueAt && task.dueAt >= now && task.dueAt <= todayEnd);
  const reviewProposals = proposals.filter(proposal => proposal.state === "review_required");
  const approvedProposals = proposals.filter(proposal => proposal.state === "approved");
  const executedProposals = proposals.filter(proposal => proposal.state === "executed");
  const blockedProposals = proposals.filter(proposal => proposal.state === "blocked");
  const activeCalls = calls.filter(call => call.status === "in_progress");
  const reviewCalls = calls.filter(call => call.status === "ready_for_review");
  return {
    generatedAt: now,
    metrics: {
      reviewRequired: reviewProposals.length, approvedActions: approvedProposals.length,
      openCallbacks: openCallbacks.length, overdueCallbacks: overdueCallbacks.length, dueTodayCallbacks: dueTodayCallbacks.length,
      activeCalls: activeCalls.length, callsReadyForReview: reviewCalls.length,
      executedActions: executedProposals.length, blockedActions: blockedProposals.length,
      preparedWorkflows: runs.filter(run => run.status === "prepared").length,
    },
    queues: {
      reviewProposals: reviewProposals.slice(0, 8), approvedProposals: approvedProposals.slice(0, 6),
      overdueCallbacks: overdueCallbacks.slice(0, 8), dueTodayCallbacks: dueTodayCallbacks.slice(0, 8),
      activeCalls: activeCalls.slice(0, 6), callsReadyForReview: reviewCalls.slice(0, 6),
    },
    recent: {
      workflows: runs.slice(0, 8),
      audit: audit.slice(0, 10),
      connections: profiles.map(profile => ({ ...profile, provider: publicConnectionLabels[profile.provider] })),
      agentActivity: audit.filter(entry => ["workflow_prepared", "live_call_started", "live_call_completed", "genie_action_executed", "genie_action_blocked"].includes(entry.eventType)).slice(0, 8),
    },
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
        state: ((action.payload.crmRoute as { routable?: boolean } | undefined)?.routable === false ? "blocked" : "review_required") as "blocked" | "review_required",
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
  const screenshotPath = typeof input.result.screenshotPath === "string" ? input.result.screenshotPath : null;
  const normalizedResult = {
    ...input.result,
    evidence: {
      screenshotPath,
      availability: screenshotPath ? "captured" : "unavailable",
      reason: screenshotPath ? null : "The saved script completed without a configured screenshot step. Add a screenshot step during Genie script calibration to retain visual evidence.",
    },
  };
  await db
    .update(actionProposals)
    .set({ state, executedAt: new Date(), executionResult: normalizedResult })
    .where(and(eq(actionProposals.id, input.proposalId), eq(actionProposals.userId, input.userId), eq(actionProposals.state, "approved")));
  await recordAudit({
    userId: input.userId,
    eventType: input.success ? "genie_action_executed" : "genie_action_blocked",
    entityType: "action_proposal",
    entityId: String(input.proposalId),
    summary: input.success ? "Approved Genie saved script completed." : "Approved Genie saved script failed and was blocked.",
    metadata: normalizedResult,
  });
}

export async function listProposalAuditEntries(userId: number, proposalId: number) {
  const db = await requireDb();
  return db.select().from(auditEntries).where(and(eq(auditEntries.userId, userId), eq(auditEntries.entityType, "action_proposal"), eq(auditEntries.entityId, String(proposalId)))).orderBy(desc(auditEntries.createdAt)).limit(12);
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

export async function searchApprovedKnowledge(userId: number, query: string) {
  const db = await requireDb();
  const sources = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.userId, userId), eq(knowledgeSources.status, "ready"))).orderBy(desc(knowledgeSources.updatedAt)).limit(80);
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2).slice(0, 18);
  const score = (source: typeof sources[number]) => {
    const haystack = `${source.title}\n${source.content ?? ""}\n${source.sourceUrl ?? ""}`.toLowerCase();
    return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
  };
  return sources.map(source => ({ source, score: score(source) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || Number(b.source.updatedAt) - Number(a.source.updatedAt)).slice(0, 6).map(item => item.source);
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

export async function createLiveCallSession(input: { userId: number; leadLabel: string }) {
  const db = await requireDb();
  const result = await db.insert(callSessions).values({ userId: input.userId, leadLabel: input.leadLabel, status: "in_progress" });
  const id = Number(result[0].insertId);
  await recordAudit({ userId: input.userId, eventType: "live_call_started", entityType: "call_session", entityId: String(id), summary: "Live coaching session started.", metadata: { leadLabel: input.leadLabel } });
  return id;
}

export async function appendLiveTranscript(input: { userId: number; callSessionId: number; transcriptChunk: string; coachTip?: string }) {
  const db = await requireDb();
  const current = (await db.select().from(callSessions).where(and(eq(callSessions.id, input.callSessionId), eq(callSessions.userId, input.userId))).limit(1))[0];
  if (!current) throw new Error("Live call session was not found.");
  const transcript = `${current.transcript ? `${current.transcript}\n` : ""}${input.transcriptChunk}`.slice(-40_000);
  await db.update(callSessions).set({ transcript, coachNotes: input.coachTip ?? current.coachNotes, status: "in_progress" }).where(eq(callSessions.id, input.callSessionId));
  return { transcript };
}

export async function completeLiveCallSession(input: { userId: number; callSessionId: number; summary?: string }) {
  const db = await requireDb();
  await db.update(callSessions).set({ status: "ready_for_review", summary: input.summary }).where(and(eq(callSessions.id, input.callSessionId), eq(callSessions.userId, input.userId)));
  await recordAudit({ userId: input.userId, eventType: "live_call_completed", entityType: "call_session", entityId: String(input.callSessionId), summary: "Live coaching session completed and is ready for review.", metadata: {} });
}

export async function getOperationalAnalytics(userId: number) {
  const db = await requireDb();
  const [review, approved, executed, blocked, callbacks, calls] = await Promise.all([
    db.select({ value: count() }).from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "review_required"))),
    db.select({ value: count() }).from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "approved"))),
    db.select({ value: count() }).from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "executed"))),
    db.select({ value: count() }).from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.state, "blocked"))),
    db.select({ value: count() }).from(callbackTasks).where(and(eq(callbackTasks.userId, userId), eq(callbackTasks.state, "open"))),
    db.select({ value: count() }).from(callSessions).where(eq(callSessions.userId, userId)),
  ]);
  return { reviewRequired: review[0]?.value ?? 0, approved: approved[0]?.value ?? 0, executed: executed[0]?.value ?? 0, blocked: blocked[0]?.value ?? 0, openCallbacks: callbacks[0]?.value ?? 0, callSessions: calls[0]?.value ?? 0 };
}

export async function listAuditEntries(userId: number, limit = 60) {
  const db = await requireDb();
  return db.select().from(auditEntries).where(eq(auditEntries.userId, userId)).orderBy(desc(auditEntries.createdAt)).limit(limit);
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

export async function listDailyReports(userId: number) {
  const db = await requireDb();
  return db.select().from(dailyReports).where(eq(dailyReports.userId, userId)).orderBy(desc(dailyReports.createdAt));
}

export async function listEnabledDailyReports() {
  const db = await requireDb();
  return db.select().from(dailyReports).where(eq(dailyReports.isEnabled, true));
}

export async function claimDailyReportDelivery(reportId: number, deliveryKey: string) {
  const db = await requireDb();
  const result = await db.update(dailyReports)
    .set({ deliveryClaimKey: deliveryKey, lastAttemptAt: new Date() })
    .where(and(
      eq(dailyReports.id, reportId),
      or(isNull(dailyReports.lastDeliveryKey), ne(dailyReports.lastDeliveryKey, deliveryKey)),
      or(isNull(dailyReports.deliveryClaimKey), ne(dailyReports.deliveryClaimKey, deliveryKey)),
    ));
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 1;
}

export async function markDailyReportDelivery(reportId: number, deliveryKey: string) {
  const db = await requireDb();
  const sentAt = new Date();
  await db.update(dailyReports).set({ deliveryClaimKey: null, lastDeliveryKey: deliveryKey, lastSentAt: sentAt }).where(and(eq(dailyReports.id, reportId), eq(dailyReports.deliveryClaimKey, deliveryKey)));
  await db.insert(dailyReportExecutions).values({ reportId, deliveryKey, status: "sent", sentAt }).onDuplicateKeyUpdate({ set: { status: "sent", failureReason: null, attemptedAt: sentAt, sentAt } });
}

export async function releaseDailyReportDelivery(reportId: number, deliveryKey: string, failureReason: string) {
  const db = await requireDb();
  const attemptedAt = new Date();
  await db.update(dailyReports).set({ deliveryClaimKey: null }).where(and(eq(dailyReports.id, reportId), eq(dailyReports.deliveryClaimKey, deliveryKey)));
  await db.insert(dailyReportExecutions).values({ reportId, deliveryKey, status: "failed", failureReason: failureReason.slice(0, 240), attemptedAt }).onDuplicateKeyUpdate({ set: { status: "failed", failureReason: failureReason.slice(0, 240), attemptedAt, sentAt: null } });
}

export async function getCompanySetup(userId: number) {
  const db = await requireDb();
  const [profile, discoveries, connections, playbooks] = await Promise.all([
    db.select().from(companyProfiles).where(eq(companyProfiles.userId, userId)).limit(1),
    db.select().from(websiteDiscoveries).where(eq(websiteDiscoveries.userId, userId)).orderBy(desc(websiteDiscoveries.createdAt)).limit(8),
    db.select().from(crmConnections).where(eq(crmConnections.userId, userId)).orderBy(desc(crmConnections.updatedAt)),
    db.select().from(automationPlaybooks).where(eq(automationPlaybooks.userId, userId)).orderBy(desc(automationPlaybooks.updatedAt)),
  ]);
  return { profile: profile[0] ?? null, discoveries, connections, playbooks };
}

export async function getCompanyAgentContext(userId: number) {
  const db = await requireDb();
  const profile = (await db.select().from(companyProfiles).where(eq(companyProfiles.userId, userId)).limit(1))[0];
  if (!profile) return undefined;
  return [
    `Company: ${profile.companyName}`,
    profile.industry ? `Industry: ${profile.industry}` : "",
    profile.primaryMarket ? `Primary market: ${profile.primaryMarket}` : "",
    profile.salesMotion ? `Sales motion: ${profile.salesMotion}` : "",
    profile.brandVoice ? `Approved brand voice: ${profile.brandVoice}` : "",
  ].filter(Boolean).join("\n").slice(0, 8_000);
}

export async function upsertCompanyProfile(input: {
  userId: number; companyName: string; websiteUrl?: string | null; industry?: string | null; companySize?: string | null;
  primaryMarket?: string | null; salesMotion?: string | null; brandVoice?: string | null;
}) {
  const db = await requireDb();
  await db.insert(companyProfiles).values(input).onDuplicateKeyUpdate({ set: {
    companyName: input.companyName, websiteUrl: input.websiteUrl ?? null, industry: input.industry ?? null,
    companySize: input.companySize ?? null, primaryMarket: input.primaryMarket ?? null, salesMotion: input.salesMotion ?? null,
    brandVoice: input.brandVoice ?? null,
  } });
  const profile = (await db.select().from(companyProfiles).where(eq(companyProfiles.userId, input.userId)).limit(1))[0];
  if (!profile) throw new Error("Company profile could not be saved.");
  await recordAudit({ userId: input.userId, eventType: "company_profile_saved", entityType: "company_profile", entityId: String(profile.id), summary: "Company setup profile saved.", metadata: { hasWebsite: Boolean(profile.websiteUrl) } });
  return profile;
}

export async function confirmWebsiteDiscovery(input: {
  userId: number; companyProfileId: number; sourceUrl: string; pageTitle: string | null;
  confirmedKnowledge: Array<{ title: string; content: string }>;
}) {
  const db = await requireDb();
  const profile = (await db.select().from(companyProfiles).where(and(eq(companyProfiles.id, input.companyProfileId), eq(companyProfiles.userId, input.userId))).limit(1))[0];
  if (!profile) throw new Error("Company profile is unavailable for confirmation.");
  await db.transaction(async tx => {
    const result = await tx.insert(websiteDiscoveries).values({
      userId: input.userId, companyProfileId: input.companyProfileId, sourceUrl: input.sourceUrl, pageTitle: input.pageTitle,
      extractedText: null, proposedFacts: { confirmedKnowledgeTitles: input.confirmedKnowledge.map(item => item.title) },
      proposedKnowledge: input.confirmedKnowledge, status: "confirmed", reviewedAt: new Date(),
    });
    const discoveryId = Number(result[0].insertId);
    await tx.update(companyProfiles).set({ discoveryStatus: "confirmed", confirmedAt: new Date() }).where(and(eq(companyProfiles.id, input.companyProfileId), eq(companyProfiles.userId, input.userId)));
    if (input.confirmedKnowledge.length) await tx.insert(knowledgeSources).values(input.confirmedKnowledge.map(item => ({ userId: input.userId, title: item.title, sourceType: "url" as const, sourceUrl: input.sourceUrl, content: item.content, status: "ready" as const })));
    return discoveryId;
  });
  const confirmed = (await db.select().from(websiteDiscoveries).where(and(eq(websiteDiscoveries.companyProfileId, input.companyProfileId), eq(websiteDiscoveries.userId, input.userId), eq(websiteDiscoveries.status, "confirmed"))).orderBy(desc(websiteDiscoveries.createdAt)).limit(1))[0];
  await recordAudit({ userId: input.userId, eventType: "website_discovery_confirmed", entityType: "website_discovery", entityId: String(confirmed?.id ?? ""), summary: "Confirmed website knowledge is now available to the assistant.", metadata: { sourceUrl: input.sourceUrl, confirmedKnowledgeItems: input.confirmedKnowledge.length } });
  return { discoveryId: confirmed?.id ?? null, confirmedKnowledgeItems: input.confirmedKnowledge.length };
}

export async function saveCrmConnection(input: { userId: number; provider: "genie" | "hubspot" | "salesforce" | "pipedrive" | "custom_browser"; displayName: string; status: "draft" | "needs_credentials"; capabilities: Array<"contacts" | "tasks" | "opportunities" | "notes" | "activities" | "email" | "calendar">; connectionMode: "api" | "browser_automation" | "custom"; configurationHint?: string | null }) {
  const db = await requireDb();
  const result = await db.insert(crmConnections).values(input);
  const id = Number(result[0].insertId);
  await recordAudit({ userId: input.userId, eventType: "crm_connection_registered", entityType: "crm_connection", entityId: String(id), summary: `${input.displayName} was registered for review-first automation.`, metadata: { provider: input.provider, capabilities: input.capabilities, connectionMode: input.connectionMode } });
  return id;
}

export async function getCrmConnectionForVerification(userId: number, connectionId: number) {
  const db = await requireDb();
  return (await db.select().from(crmConnections).where(and(eq(crmConnections.id, connectionId), eq(crmConnections.userId, userId))).limit(1))[0];
}

export async function recordCrmConnectionVerification(input: {
  userId: number; connectionId: number; status: "ready" | "needs_credentials" | "error" | "connector_not_implemented";
  verifiedAt?: Date | null; verificationExpiresAt?: Date | null; verificationFailure?: string | null; verificationEvidence?: Record<string, unknown> | null;
}) {
  const db = await requireDb();
  await db.update(crmConnections).set({
    status: input.status,
    verifiedAt: input.verifiedAt ?? null,
    verificationExpiresAt: input.verificationExpiresAt ?? null,
    verificationFailure: input.verificationFailure ?? null,
    verificationEvidence: input.verificationEvidence ?? null,
  }).where(and(eq(crmConnections.id, input.connectionId), eq(crmConnections.userId, input.userId)));
  await recordAudit({ userId: input.userId, eventType: "crm_connection_verified", entityType: "crm_connection", entityId: String(input.connectionId), summary: `CRM connection verification finished with ${input.status}.`, metadata: { status: input.status, verified: input.status === "ready" } });
}

export async function saveAutomationPlaybook(input: { userId: number; title: string; trigger: string; description: string; agentKey: string; requiredCapabilities: string[]; status: "draft" | "active" | "paused" }) {
  const db = await requireDb();
  const result = await db.insert(automationPlaybooks).values({ ...input, reviewRequired: true });
  const id = Number(result[0].insertId);
  await recordAudit({ userId: input.userId, eventType: "automation_playbook_saved", entityType: "automation_playbook", entityId: String(id), summary: `Review-first playbook '${input.title}' saved.`, metadata: { agentKey: input.agentKey, status: input.status } });
  return id;
}

export async function getActiveAutomationPlaybook(userId: number, playbookId: number) {
  const db = await requireDb();
  return (await db.select().from(automationPlaybooks).where(and(eq(automationPlaybooks.id, playbookId), eq(automationPlaybooks.userId, userId), eq(automationPlaybooks.status, "active"))).limit(1))[0];
}

export async function getCachedAgentResponse(input: { userId: number; agentKey: string; requestHash: string; policyVersion: string }) {
  const db = await requireDb();
  return (await db.select().from(agentResponseCache).where(and(eq(agentResponseCache.userId, input.userId), eq(agentResponseCache.agentKey, input.agentKey), eq(agentResponseCache.requestHash, input.requestHash), eq(agentResponseCache.policyVersion, input.policyVersion), gt(agentResponseCache.expiresAt, new Date()))).orderBy(desc(agentResponseCache.createdAt)).limit(1))[0];
}

export async function saveCachedAgentResponse(input: { userId: number; agentKey: string; requestHash: string; policyVersion: string; content: string; expiresAt: Date }) {
  const db = await requireDb();
  await db.insert(agentResponseCache).values(input).onDuplicateKeyUpdate({ set: { content: input.content, expiresAt: input.expiresAt, createdAt: new Date() } });
}

export async function recordAgentUsage(input: { userId: number; agentKey: string; model?: string | null; cacheHit: boolean; inputTokens?: number | null; outputTokens?: number | null; inputChars: number; outputChars: number }) {
  const db = await requireDb();
  await db.insert(agentUsageEvents).values(input);
}

export async function getAgentUsageSummary(userId: number) {
  const db = await requireDb();
  const events = await db.select().from(agentUsageEvents).where(eq(agentUsageEvents.userId, userId)).orderBy(desc(agentUsageEvents.createdAt)).limit(250);
  return summarizeAgentUsageEvents(events);
}

export async function saveCommunicationDraft(input: { userId: number; leadLabel?: string | null; recipientEmail: string; subject: string; body: string; purpose: string; dedupeKey: string; qualityChecks: Array<{ key: string; passed: boolean; detail: string }> }) {
  const db = await requireDb();
  const existing = (await db.select().from(communicationDrafts).where(and(eq(communicationDrafts.userId, input.userId), eq(communicationDrafts.dedupeKey, input.dedupeKey))).orderBy(desc(communicationDrafts.createdAt)).limit(1))[0];
  if (existing && ["draft", "review_required"].includes(existing.state)) return { id: existing.id, reused: true };
  const result = await db.insert(communicationDrafts).values({ ...input, state: "review_required" });
  const id = Number(result[0].insertId);
  await recordAudit({ userId: input.userId, eventType: "communication_draft_prepared", entityType: "communication_draft", entityId: String(id), summary: "Human-style email draft prepared for review; no email was sent.", metadata: { leadLabel: input.leadLabel ?? null, recipientEmail: input.recipientEmail, qualityChecks: input.qualityChecks } });
  return { id, reused: false };
}

export async function listCommunicationDrafts(userId: number) {
  const db = await requireDb();
  return db.select().from(communicationDrafts).where(eq(communicationDrafts.userId, userId)).orderBy(desc(communicationDrafts.createdAt)).limit(30);
}

export async function upsertCrmContextSnapshot(input: { userId: number; leadLabel: string; source: "genie_browser" | "manual"; context: Record<string, string>; summary: string; expiresAt: Date }) {
  const db = await requireDb();
  await db.insert(crmContextSnapshots).values(input).onDuplicateKeyUpdate({ set: { source: input.source, context: input.context, summary: input.summary, refreshedAt: new Date(), expiresAt: input.expiresAt } });
  const snapshot = (await db.select().from(crmContextSnapshots).where(and(eq(crmContextSnapshots.userId, input.userId), eq(crmContextSnapshots.leadLabel, input.leadLabel))).limit(1))[0];
  if (!snapshot) throw new Error("CRM context snapshot could not be saved.");
  await recordAudit({ userId: input.userId, eventType: "crm_context_refreshed", entityType: "crm_context_snapshot", entityId: String(snapshot.id), summary: `CRM context refreshed for ${input.leadLabel}.`, metadata: { source: input.source, expiresAt: input.expiresAt.toISOString() } });
  return snapshot;
}

export async function getCrmContextSnapshot(userId: number, leadLabel: string) {
  const db = await requireDb();
  return (await db.select().from(crmContextSnapshots).where(and(eq(crmContextSnapshots.userId, userId), eq(crmContextSnapshots.leadLabel, leadLabel))).limit(1))[0];
}

export async function getCrmWorkboard(userId: number, leadLabel: string) {
  const db = await requireDb();
  const [snapshot, workflows, proposals, callbacks, calls] = await Promise.all([
    getCrmContextSnapshot(userId, leadLabel),
    db.select().from(workflowRuns).where(and(eq(workflowRuns.userId, userId), eq(workflowRuns.leadLabel, leadLabel))).orderBy(desc(workflowRuns.createdAt)).limit(8),
    db.select().from(actionProposals).where(and(eq(actionProposals.userId, userId), eq(actionProposals.targetLabel, leadLabel))).orderBy(desc(actionProposals.createdAt)).limit(30),
    db.select().from(callbackTasks).where(and(eq(callbackTasks.userId, userId), eq(callbackTasks.leadLabel, leadLabel))).orderBy(desc(callbackTasks.updatedAt)).limit(16),
    db.select().from(callSessions).where(and(eq(callSessions.userId, userId), eq(callSessions.leadLabel, leadLabel))).orderBy(desc(callSessions.updatedAt)).limit(8),
  ]);
  return { snapshot: snapshot ?? null, workflows, proposals, callbacks, calls };
}

export type ManagerFindingInput = { findingKey: string; severity: "critical" | "high" | "normal" | "info"; title: string; detail: string; targetType?: string; targetId?: string; metadata: Record<string, unknown> };
export async function upsertManagerFinding(input: ManagerFindingInput & { userId: number }) {
  const db = await requireDb();
  await db.insert(managerFindings).values({ ...input, state: "open" }).onDuplicateKeyUpdate({ set: { severity: input.severity, title: input.title, detail: input.detail, targetType: input.targetType ?? null, targetId: input.targetId ?? null, metadata: input.metadata, state: "open", updatedAt: new Date() } });
}

export async function listManagerFindings(userId: number) {
  const db = await requireDb();
  return db.select().from(managerFindings).where(eq(managerFindings.userId, userId)).orderBy(desc(managerFindings.updatedAt)).limit(80);
}

export async function updateManagerFindingState(input: { userId: number; findingId: number; state: "acknowledged" | "resolved" }) {
  const db = await requireDb();
  await db.update(managerFindings).set({ state: input.state }).where(and(eq(managerFindings.id, input.findingId), eq(managerFindings.userId, input.userId)));
  await recordAudit({ userId: input.userId, eventType: `manager_finding_${input.state}`, entityType: "manager_finding", entityId: String(input.findingId), summary: `Manager finding marked ${input.state}.`, metadata: {} });
}

export async function getManagerAssuranceSnapshot(userId: number) {
  const db = await requireDb();
  const [proposals, callbacks, runs, calls, findings] = await Promise.all([
    db.select().from(actionProposals).where(eq(actionProposals.userId, userId)).orderBy(desc(actionProposals.createdAt)).limit(200),
    db.select().from(callbackTasks).where(eq(callbackTasks.userId, userId)).orderBy(desc(callbackTasks.updatedAt)).limit(200),
    db.select().from(workflowRuns).where(eq(workflowRuns.userId, userId)).orderBy(desc(workflowRuns.updatedAt)).limit(100),
    db.select().from(callSessions).where(eq(callSessions.userId, userId)).orderBy(desc(callSessions.updatedAt)).limit(80),
    listManagerFindings(userId),
  ]);
  return { proposals, callbacks, runs, calls, findings };
}
