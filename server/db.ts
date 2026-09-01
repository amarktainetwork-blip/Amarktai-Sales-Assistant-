import {
  and,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import bcrypt from "bcryptjs";
import {
  actionProposals,
  auditEntries,
  callbackTasks,
  callSessions,
  companyProfiles,
  connectedSystems,
  dailyReports,
  integrationProfiles,
  knowledgeSources,
  twoFactorChallenges,
  type InsertUser,
  users,
  websiteDiscoveries,
  automationPlaybooks,
  workflowRuns,
  workspaceSavedItems,
  crmContacts,
  crmCompanies,
  crmActivities,
  crmOpportunities,
  crmTasks,
} from "../drizzle/schema";
import type { ProposedAction } from "./workflowRules";
import { normalizeSavedItemTags, type SavedItemTargetType } from "./savedItems";

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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  const updateSet: Record<string, unknown> = {
    lastSignedIn: values.lastSignedIn,
  };
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
  if (user.isPlatformOwner !== undefined) {
    values.isPlatformOwner = user.isPlatformOwner;
    updateSet.isPlatformOwner = user.isPlatformOwner;
  }

  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
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
  return (
    await db.select().from(users).where(eq(users.email, email)).limit(1)
  )[0];
}

export function localAdminPlatformOwnerEnabled(
  value = process.env.LOCAL_ADMIN_PLATFORM_OWNER
) {
  return value === "true";
}

export async function createLocalAdminIfMissing() {
  const email = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error(
      "LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD are required for Webdock local authentication."
    );
  const db = await requireDb();
  const existing = await getUserByEmail(email);
  const platformOwner = localAdminPlatformOwnerEnabled();
  if (existing) {
    if (
      platformOwner &&
      (!existing.isPlatformOwner || existing.role !== "admin")
    ) {
      await db
        .update(users)
        .set({ role: "admin", isPlatformOwner: true })
        .where(eq(users.id, existing.id));
      return getUserByEmail(email);
    }
    return existing;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    openId: `local:${email}`,
    email,
    name: process.env.LOCAL_ADMIN_NAME || "Amarktai Administrator",
    loginMethod: "local",
    passwordHash,
    role: "admin",
    isPlatformOwner: platformOwner,
    lastSignedIn: new Date(),
  });
  return getUserByEmail(email);
}

export async function getAssistantDashboard(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  const [reviewCount, openTaskCount, knowledgeCount, runs, proposals] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "review_required")
          )
        ),
      db
        .select({ value: count() })
        .from(callbackTasks)
        .where(
          and(
            eq(callbackTasks.userId, userId),
            eq(callbackTasks.organisationId, organisationId),
            eq(callbackTasks.state, "open")
          )
        ),
      db
        .select({ value: count() })
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.userId, userId),
            eq(knowledgeSources.organisationId, organisationId)
          )
        ),
      db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.userId, userId),
            eq(workflowRuns.organisationId, organisationId)
          )
        )
        .orderBy(desc(workflowRuns.createdAt))
        .limit(6),
      db
        .select()
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "review_required")
          )
        )
        .orderBy(desc(actionProposals.createdAt))
        .limit(8),
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

export async function getOperationsDashboard(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const [proposals, callbacks, calls, runs, profiles, audit] =
    await Promise.all([
      db
        .select()
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId)
          )
        )
        .orderBy(desc(actionProposals.createdAt))
        .limit(100),
      db
        .select()
        .from(callbackTasks)
        .where(
          and(
            eq(callbackTasks.userId, userId),
            eq(callbackTasks.organisationId, organisationId)
          )
        )
        .orderBy(desc(callbackTasks.createdAt))
        .limit(80),
      db
        .select()
        .from(callSessions)
        .where(
          and(
            eq(callSessions.userId, userId),
            eq(callSessions.organisationId, organisationId)
          )
        )
        .orderBy(desc(callSessions.updatedAt))
        .limit(40),
      db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.userId, userId),
            eq(workflowRuns.organisationId, organisationId)
          )
        )
        .orderBy(desc(workflowRuns.updatedAt))
        .limit(40),
      db
        .select()
        .from(integrationProfiles)
        .where(
          and(
            eq(integrationProfiles.userId, userId),
            eq(integrationProfiles.organisationId, organisationId)
          )
        )
        .orderBy(desc(integrationProfiles.updatedAt))
        .limit(20),
      db
        .select()
        .from(auditEntries)
        .where(
          and(
            eq(auditEntries.userId, userId),
            eq(auditEntries.organisationId, organisationId)
          )
        )
        .orderBy(desc(auditEntries.createdAt))
        .limit(30),
    ]);
  const openCallbacks = callbacks.filter(task => task.state === "open");
  const overdueCallbacks = openCallbacks.filter(
    task => task.dueAt && task.dueAt < now
  );
  const dueTodayCallbacks = openCallbacks.filter(
    task => task.dueAt && task.dueAt >= now && task.dueAt <= todayEnd
  );
  const reviewProposals = proposals.filter(
    proposal => proposal.state === "review_required"
  );
  const approvedProposals = proposals.filter(
    proposal => proposal.state === "approved"
  );
  const executedProposals = proposals.filter(
    proposal => proposal.state === "executed"
  );
  const blockedProposals = proposals.filter(
    proposal => proposal.state === "blocked"
  );
  const activeCalls = calls.filter(call => call.status === "in_progress");
  const reviewCalls = calls.filter(call => call.status === "ready_for_review");
  return {
    generatedAt: now,
    metrics: {
      reviewRequired: reviewProposals.length,
      approvedActions: approvedProposals.length,
      openCallbacks: openCallbacks.length,
      overdueCallbacks: overdueCallbacks.length,
      dueTodayCallbacks: dueTodayCallbacks.length,
      activeCalls: activeCalls.length,
      callsReadyForReview: reviewCalls.length,
      executedActions: executedProposals.length,
      blockedActions: blockedProposals.length,
      preparedWorkflows: runs.filter(run => run.status === "prepared").length,
    },
    queues: {
      reviewProposals: reviewProposals.slice(0, 8),
      approvedProposals: approvedProposals.slice(0, 6),
      overdueCallbacks: overdueCallbacks.slice(0, 8),
      dueTodayCallbacks: dueTodayCallbacks.slice(0, 8),
      activeCalls: activeCalls.slice(0, 6),
      callsReadyForReview: reviewCalls.slice(0, 6),
    },
    recent: {
      workflows: runs.slice(0, 8),
      audit: audit.slice(0, 10),
      connections: profiles.map(profile => ({
        ...profile,
        provider: publicConnectionLabels[profile.provider],
      })),
      agentActivity: audit
        .filter(entry =>
          [
            "workflow_prepared",
            "live_call_started",
            "live_call_completed",
            "genie_action_executed",
            "genie_action_blocked",
          ].includes(entry.eventType)
        )
        .slice(0, 8),
    },
  };
}

export async function createWorkflowRun(input: {
  userId: number;
  organisationId: number;
  workflowKey: string;
  leadLabel: string;
  payload: Record<string, unknown>;
  verificationSummary: string;
  actions: ProposedAction[];
}) {
  const db = await requireDb();
  const inserted = await db.insert(workflowRuns).values({
    userId: input.userId,
    organisationId: input.organisationId,
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
        organisationId: input.organisationId,
        workflowRunId,
        actionType: action.actionType,
        title: action.title,
        targetLabel: action.targetLabel,
        idempotencyKey: action.idempotencyKey,
        payload: action.payload,
        state: ((action.payload.crmRoute as { routable?: boolean } | undefined)
          ?.routable === false
          ? "blocked"
          : "review_required") as "blocked" | "review_required",
      }))
    );
  }

  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "workflow_prepared",
    entityType: "workflow_run",
    entityId: String(workflowRunId),
    summary: `${input.workflowKey} prepared for review.`,
    metadata: { actionCount: input.actions.length, leadLabel: input.leadLabel },
  });

  return workflowRunId;
}

export async function listActionProposals(
  userId: number,
  organisationId: number,
  workflowRunId?: number
) {
  const db = await requireDb();
  const whereClause = workflowRunId
    ? and(
        eq(actionProposals.userId, userId),
        eq(actionProposals.organisationId, organisationId),
        eq(actionProposals.workflowRunId, workflowRunId)
      )
    : and(
        eq(actionProposals.userId, userId),
        eq(actionProposals.organisationId, organisationId)
      );
  return db
    .select()
    .from(actionProposals)
    .where(whereClause)
    .orderBy(desc(actionProposals.createdAt))
    .limit(40);
}

/** Edits only the body of the current user's still-pending delegated email draft. */
export async function updateDelegatedEmailDraft(input: {
  userId: number;
  organisationId: number;
  proposalId: number;
  body: string;
}) {
  const db = await requireDb();
  const proposal = (
    await db
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.id, input.proposalId),
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.organisationId, input.organisationId),
          eq(actionProposals.state, "review_required")
        )
      )
      .limit(1)
  )[0];
  const route = proposal?.payload?.crmRoute as
    | { provider?: string }
    | undefined;
  if (
    !proposal ||
    !["send_email", "send_email_template"].includes(proposal.actionType) ||
    route?.provider !== "microsoft_delegated"
  )
    throw new Error(
      "This personal mailbox draft is no longer available to edit."
    );
  const body = input.body.trim().slice(0, 20_000);
  if (!body) throw new Error("Write a reply before sending this email.");
  await db
    .update(actionProposals)
    .set({ payload: { ...proposal.payload, body } })
    .where(
      and(
        eq(actionProposals.id, proposal.id),
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.state, "review_required")
      )
    );
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_draft_edited",
    entityType: "action_proposal",
    entityId: String(proposal.id),
    summary: "The salesperson edited a review-only personal mailbox draft.",
    metadata: { contentRetained: false },
  });
  return { ...proposal, payload: { ...proposal.payload, body } };
}

export async function listWorkspaceSavedItems(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  return db
    .select()
    .from(workspaceSavedItems)
    .where(
      and(
        eq(workspaceSavedItems.userId, userId),
        eq(workspaceSavedItems.organisationId, organisationId)
      )
    )
    .orderBy(desc(workspaceSavedItems.updatedAt))
    .limit(200);
}

export async function saveWorkspaceSavedItem(input: {
  userId: number;
  organisationId: number;
  targetType: SavedItemTargetType;
  targetKey: string;
  title: string;
  tags: string[];
  isFavorite: boolean;
}) {
  const db = await requireDb();
  if (input.targetType === "action_proposal") {
    const proposalId = Number(input.targetKey);
    if (!Number.isInteger(proposalId) || proposalId < 1)
      throw new Error("A valid action proposal is required.");
    const proposal = (
      await db
        .select({ id: actionProposals.id })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.id, proposalId),
            eq(actionProposals.userId, input.userId),
            eq(actionProposals.organisationId, input.organisationId)
          )
        )
        .limit(1)
    )[0];
    if (!proposal)
      throw new Error(
        "That action proposal is unavailable in the selected workspace."
      );
  }
  const tags = normalizeSavedItemTags(input.tags);
  await db
    .insert(workspaceSavedItems)
    .values({ ...input, tags })
    .onDuplicateKeyUpdate({
      set: {
        title: input.title,
        tags,
        isFavorite: input.isFavorite,
        updatedAt: new Date(),
      },
    });
  const saved = (
    await db
      .select()
      .from(workspaceSavedItems)
      .where(
        and(
          eq(workspaceSavedItems.userId, input.userId),
          eq(workspaceSavedItems.organisationId, input.organisationId),
          eq(workspaceSavedItems.targetType, input.targetType),
          eq(workspaceSavedItems.targetKey, input.targetKey)
        )
      )
      .limit(1)
  )[0];
  if (!saved) throw new Error("Saved item could not be recorded.");
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "workspace_item_saved",
    entityType: "workspace_saved_item",
    entityId: String(saved.id),
    summary: `Saved ${input.targetType} for quick access.`,
    metadata: {
      targetType: input.targetType,
      targetKey: input.targetKey,
      tags,
      isFavorite: input.isFavorite,
    },
  });
  return saved;
}

export async function removeWorkspaceSavedItem(input: {
  userId: number;
  organisationId: number;
  id: number;
}) {
  const db = await requireDb();
  await db
    .delete(workspaceSavedItems)
    .where(
      and(
        eq(workspaceSavedItems.id, input.id),
        eq(workspaceSavedItems.userId, input.userId),
        eq(workspaceSavedItems.organisationId, input.organisationId)
      )
    );
}

export async function reviewActionProposal(
  userId: number,
  organisationId: number,
  proposalId: number,
  state: "approved" | "skipped"
) {
  const db = await requireDb();
  await db
    .update(actionProposals)
    .set({ state, reviewedAt: new Date() })
    .where(
      and(
        eq(actionProposals.id, proposalId),
        eq(actionProposals.userId, userId),
        eq(actionProposals.organisationId, organisationId),
        eq(actionProposals.state, "review_required")
      )
    );
  await recordAudit({
    userId,
    organisationId,
    eventType: `action_${state}`,
    entityType: "action_proposal",
    entityId: String(proposalId),
    summary: `Action proposal marked ${state}; no external execution was attempted.`,
    metadata: {},
  });
}

export async function getApprovedActionProposal(
  userId: number,
  organisationId: number,
  proposalId: number
) {
  const db = await requireDb();
  return (
    await db
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.id, proposalId),
          eq(actionProposals.userId, userId),
          eq(actionProposals.organisationId, organisationId),
          eq(actionProposals.state, "approved")
        )
      )
      .limit(1)
  )[0];
}

export const ACTION_EXECUTION_CLAIM_TTL_MS = 15 * 60 * 1000;

export function isActionExecutionClaimStale(
  claimedAt: Date | null | undefined,
  now = Date.now()
) {
  return Boolean(
    claimedAt && now - claimedAt.getTime() >= ACTION_EXECUTION_CLAIM_TTL_MS
  );
}

export function isCurrentActionExecutionClaim(
  activeCorrelationId: string | null | undefined,
  correlationId: string
) {
  return Boolean(activeCorrelationId && activeCorrelationId === correlationId);
}

export async function claimApprovedActionProposal(input: {
  userId: number;
  organisationId: number;
  proposalId: number;
  correlationId: string;
}) {
  const db = await requireDb();
  const claimedAt = new Date();
  const claim = {
    status: "executing",
    correlationId: input.correlationId,
    claimedAt: claimedAt.toISOString(),
  };
  const staleBefore = new Date(
    claimedAt.getTime() - ACTION_EXECUTION_CLAIM_TTL_MS
  );
  const result = await db
    .update(actionProposals)
    .set({
      executionClaimId: input.correlationId,
      executionClaimedAt: claimedAt,
      executionResult: claim,
    })
    .where(
      and(
        eq(actionProposals.id, input.proposalId),
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.state, "approved"),
        or(
          and(
            isNull(actionProposals.executionClaimId),
            isNull(actionProposals.executionResult)
          ),
          and(
            isNotNull(actionProposals.executionClaimId),
            isNotNull(actionProposals.executionClaimedAt),
            lt(actionProposals.executionClaimedAt, staleBefore)
          )
        )
      )
    );
  if (result[0].affectedRows !== 1) return undefined;
  const proposal = (
    await db
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.id, input.proposalId),
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.organisationId, input.organisationId),
          eq(actionProposals.state, "approved")
        )
      )
      .limit(1)
  )[0];
  if (!proposal)
    throw new Error("Claimed action proposal could not be loaded.");
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "crm_action_claimed",
    entityType: "action_proposal",
    entityId: String(input.proposalId),
    summary: "Approved CRM action claimed for one-time execution.",
    metadata: claim,
  });
  return proposal;
}

export async function recordActionExecution(input: {
  userId: number;
  organisationId: number;
  proposalId: number;
  correlationId: string;
  success: boolean;
  result: Record<string, unknown>;
}) {
  const db = await requireDb();
  const state: "executed" | "blocked" = input.success ? "executed" : "blocked";
  const screenshotPath =
    typeof input.result.screenshotPath === "string"
      ? input.result.screenshotPath
      : null;
  const normalizedResult = {
    ...input.result,
    correlationId: input.correlationId,
    evidence: {
      screenshotPath,
      availability: screenshotPath ? "captured" : "unavailable",
      reason: screenshotPath
        ? null
        : "The saved script completed without a configured screenshot step. Add a screenshot step during Genie script calibration to retain visual evidence.",
    },
  };
  const finalized = await db
    .update(actionProposals)
    .set({
      state,
      executedAt: new Date(),
      executionClaimId: null,
      executionClaimedAt: null,
      executionResult: normalizedResult,
    })
    .where(
      and(
        eq(actionProposals.id, input.proposalId),
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.state, "approved"),
        eq(actionProposals.executionClaimId, input.correlationId)
      )
    );
  if (finalized[0].affectedRows !== 1)
    throw new Error(
      "Action execution claim is no longer current; the result was not recorded."
    );
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: input.success ? "crm_action_executed" : "crm_action_blocked",
    entityType: "action_proposal",
    entityId: String(input.proposalId),
    summary: input.success
      ? "Approved CRM action was verified by its connector."
      : "Approved CRM action failed and was blocked.",
    metadata: normalizedResult,
  });
}

export async function returnClaimedActionForReview(input: {
  userId: number;
  organisationId: number;
  proposalId: number;
  correlationId: string;
  reason: string;
}) {
  const db = await requireDb();
  await db
    .update(actionProposals)
    .set({
      state: "review_required",
      reviewedAt: null,
      executionClaimId: null,
      executionClaimedAt: null,
    })
    .where(
      and(
        eq(actionProposals.id, input.proposalId),
        eq(actionProposals.userId, input.userId),
        eq(actionProposals.organisationId, input.organisationId),
        eq(actionProposals.state, "approved"),
        eq(actionProposals.executionClaimId, input.correlationId)
      )
    );
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "personal_mailbox_send_not_completed",
    entityType: "action_proposal",
    entityId: String(input.proposalId),
    summary:
      "The approved personal mailbox email was not sent and returned for review.",
    metadata: { reason: input.reason.slice(0, 240) },
  });
}

export async function listProposalAuditEntries(
  userId: number,
  organisationId: number,
  proposalId: number
) {
  const db = await requireDb();
  const proposal = (
    await db
      .select({ id: actionProposals.id })
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.id, proposalId),
          eq(actionProposals.userId, userId),
          eq(actionProposals.organisationId, organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!proposal) return [];
  return db
    .select()
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.userId, userId),
        eq(auditEntries.organisationId, organisationId),
        eq(auditEntries.entityType, "action_proposal"),
        eq(auditEntries.entityId, String(proposalId))
      )
    )
    .orderBy(desc(auditEntries.createdAt))
    .limit(12);
}

export async function listIntegrationProfiles(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  return db
    .select()
    .from(integrationProfiles)
    .where(
      and(
        eq(integrationProfiles.userId, userId),
        eq(integrationProfiles.organisationId, organisationId)
      )
    )
    .orderBy(desc(integrationProfiles.updatedAt));
}

export async function createIntegrationProfile(input: {
  userId: number;
  organisationId: number;
  provider: "genie" | "outlook" | "genx";
  displayName: string;
  scopeSummary?: string;
}) {
  const db = await requireDb();
  const result = await db
    .insert(integrationProfiles)
    .values({ ...input, status: "needs_credentials" });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "integration_profile_created",
    entityType: "integration_profile",
    entityId: String(id),
    summary: `${input.provider} profile saved without secrets.`,
    metadata: {
      provider: input.provider,
      organisationId: input.organisationId,
    },
  });
  return id;
}

export async function listKnowledgeSources(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  return db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.organisationId, organisationId),
        or(
          eq(knowledgeSources.userId, userId),
          eq(knowledgeSources.visibility, "organisation")
        )
      )
    )
    .orderBy(desc(knowledgeSources.updatedAt));
}

export async function searchApprovedKnowledge(
  userId: number,
  organisationId: number,
  query: string
) {
  const db = await requireDb();
  const sources = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.organisationId, organisationId),
        eq(knowledgeSources.status, "ready"),
        or(
          eq(knowledgeSources.userId, userId),
          eq(knowledgeSources.visibility, "organisation")
        )
      )
    )
    .orderBy(desc(knowledgeSources.updatedAt))
    .limit(80);
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 2)
    .slice(0, 18);
  const score = (source: (typeof sources)[number]) => {
    const haystack =
      `${source.title}\n${source.content ?? ""}\n${source.sourceUrl ?? ""}`.toLowerCase();
    return terms.reduce(
      (total, term) => total + (haystack.includes(term) ? 1 : 0),
      0
    );
  };
  return sources
    .map(source => ({ source, score: score(source) }))
    .filter(item => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.source.updatedAt) - Number(a.source.updatedAt)
    )
    .slice(0, 6)
    .map(item => item.source);
}

export async function createKnowledgeSource(input: {
  userId: number;
  organisationId: number;
  title: string;
  sourceType: "note" | "url" | "document";
  sourceUrl?: string;
  content?: string;
}) {
  const db = await requireDb();
  const result = await db
    .insert(knowledgeSources)
    .values({ ...input, visibility: "organisation", status: "ready" });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "company_knowledge_added",
    entityType: "knowledge_source",
    entityId: String(id),
    summary: "Approved company knowledge was added by management.",
    metadata: {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl || null,
    },
  });
  return id;
}

export async function updateKnowledgeSource(input: {
  userId: number;
  organisationId: number;
  id: number;
  title: string;
  content: string;
}) {
  const db = await requireDb();
  const result = await db
    .update(knowledgeSources)
    .set({ title: input.title, content: input.content, status: "ready" })
    .where(
      and(
        eq(knowledgeSources.id, input.id),
        eq(knowledgeSources.organisationId, input.organisationId),
        eq(knowledgeSources.visibility, "organisation")
      )
    );
  if (Number(result[0].affectedRows || 0) !== 1)
    throw new Error("That knowledge item is no longer available.");
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "company_knowledge_updated",
    entityType: "knowledge_source",
    entityId: String(input.id),
    summary: "Approved company knowledge was corrected by management.",
    metadata: { contentRetainedInAudit: false },
  });
  return input.id;
}

export async function createCallSession(input: {
  userId: number;
  organisationId: number;
  leadLabel: string;
  transcript?: string;
  coachNotes?: string;
}) {
  const db = await requireDb();
  const result = await db
    .insert(callSessions)
    .values({ ...input, status: "ready_for_review" });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "call_note_saved",
    entityType: "call_session",
    entityId: String(id),
    summary: "Call note saved for review.",
    metadata: { leadLabel: input.leadLabel },
  });
  return id;
}

export async function createLiveCallSession(input: {
  userId: number;
  organisationId: number;
  leadLabel: string;
  crmContext?: Record<string, unknown>;
}) {
  const db = await requireDb();
  const result = await db.insert(callSessions).values({
    userId: input.userId,
    organisationId: input.organisationId,
    leadLabel: input.leadLabel,
    crmContext: input.crmContext,
    status: "in_progress",
  });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "live_call_started",
    entityType: "call_session",
    entityId: String(id),
    summary: "Live coaching session started.",
    metadata: { leadLabel: input.leadLabel },
  });
  return id;
}

export async function appendLiveTranscript(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
  transcriptChunk: string;
  coachTip?: string;
}) {
  const db = await requireDb();
  const current = (
    await db
      .select()
      .from(callSessions)
      .where(
        and(
          eq(callSessions.id, input.callSessionId),
          eq(callSessions.userId, input.userId),
          eq(callSessions.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!current) throw new Error("Live call session was not found.");
  const transcript =
    `${current.transcript ? `${current.transcript}\n` : ""}${input.transcriptChunk}`.slice(
      -40_000
    );
  await db
    .update(callSessions)
    .set({
      transcript,
      coachNotes: input.coachTip ?? current.coachNotes,
      status: "in_progress",
    })
    .where(eq(callSessions.id, input.callSessionId));
  return { transcript };
}

export async function completeLiveCallSession(input: {
  userId: number;
  organisationId: number;
  callSessionId: number;
  summary?: string;
}) {
  const db = await requireDb();
  await db
    .update(callSessions)
    .set({ status: "ready_for_review", summary: input.summary })
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
    eventType: "live_call_completed",
    entityType: "call_session",
    entityId: String(input.callSessionId),
    summary: "Live coaching session completed and is ready for review.",
    metadata: {},
  });
}

export async function getOperationalAnalytics(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  const [review, approved, executed, blocked, callbacks, calls] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "review_required")
          )
        ),
      db
        .select({ value: count() })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "approved")
          )
        ),
      db
        .select({ value: count() })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "executed")
          )
        ),
      db
        .select({ value: count() })
        .from(actionProposals)
        .where(
          and(
            eq(actionProposals.userId, userId),
            eq(actionProposals.organisationId, organisationId),
            eq(actionProposals.state, "blocked")
          )
        ),
      db
        .select({ value: count() })
        .from(callbackTasks)
        .where(
          and(
            eq(callbackTasks.userId, userId),
            eq(callbackTasks.organisationId, organisationId),
            eq(callbackTasks.state, "open")
          )
        ),
      db
        .select({ value: count() })
        .from(callSessions)
        .where(
          and(
            eq(callSessions.userId, userId),
            eq(callSessions.organisationId, organisationId)
          )
        ),
    ]);
  return {
    reviewRequired: review[0]?.value ?? 0,
    approved: approved[0]?.value ?? 0,
    executed: executed[0]?.value ?? 0,
    blocked: blocked[0]?.value ?? 0,
    openCallbacks: callbacks[0]?.value ?? 0,
    callSessions: calls[0]?.value ?? 0,
  };
}

export async function getWorkspaceExportData(input: {
  userId: number;
  organisationId: number;
  kind: "operational_report" | "conversation_log";
  callSessionId?: number;
}) {
  const db = await requireDb();
  if (input.kind === "conversation_log") {
    const filters = [
      eq(callSessions.userId, input.userId),
      eq(callSessions.organisationId, input.organisationId),
    ];
    if (input.callSessionId)
      filters.push(eq(callSessions.id, input.callSessionId));
    const calls = await db
      .select()
      .from(callSessions)
      .where(and(...filters))
      .orderBy(desc(callSessions.updatedAt))
      .limit(input.callSessionId ? 1 : 30);
    return { calls };
  }
  const [proposals, callbacks, calls, audit] = await Promise.all([
    db
      .select()
      .from(actionProposals)
      .where(
        and(
          eq(actionProposals.userId, input.userId),
          eq(actionProposals.organisationId, input.organisationId)
        )
      )
      .orderBy(desc(actionProposals.createdAt))
      .limit(250),
    db
      .select()
      .from(callbackTasks)
      .where(
        and(
          eq(callbackTasks.userId, input.userId),
          eq(callbackTasks.organisationId, input.organisationId)
        )
      )
      .orderBy(desc(callbackTasks.updatedAt))
      .limit(250),
    db
      .select()
      .from(callSessions)
      .where(
        and(
          eq(callSessions.userId, input.userId),
          eq(callSessions.organisationId, input.organisationId)
        )
      )
      .orderBy(desc(callSessions.updatedAt))
      .limit(100),
    db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.userId, input.userId),
          eq(auditEntries.organisationId, input.organisationId)
        )
      )
      .orderBy(desc(auditEntries.createdAt))
      .limit(250),
  ]);
  return { proposals, callbacks, calls, audit };
}

export async function listAuditEntries(
  userId: number,
  organisationId: number,
  limit = 60
) {
  const db = await requireDb();
  return db
    .select()
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.userId, userId),
        eq(auditEntries.organisationId, organisationId)
      )
    )
    .orderBy(desc(auditEntries.createdAt))
    .limit(limit);
}

export async function recordAudit(input: {
  userId: number;
  organisationId?: number;
  eventType: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata: Record<string, unknown>;
}) {
  const db = await requireDb();
  const metadataOrganisationId =
    typeof input.metadata.organisationId === "number" &&
    Number.isInteger(input.metadata.organisationId) &&
    input.metadata.organisationId > 0
      ? input.metadata.organisationId
      : undefined;
  await db.insert(auditEntries).values({
    ...input,
    organisationId: input.organisationId ?? metadataOrganisationId,
  });
}

export async function createTwoFactorChallenge(input: {
  userId: number;
  codeHash: string;
  expiresAt: Date;
}) {
  const db = await requireDb();
  await db.insert(twoFactorChallenges).values(input);
}

export async function consumeValidTwoFactorChallenge(input: {
  userId: number;
  isValid: (hash: string) => boolean;
}) {
  const db = await requireDb();
  const challenge = (
    await db
      .select()
      .from(twoFactorChallenges)
      .where(
        and(
          eq(twoFactorChallenges.userId, input.userId),
          isNull(twoFactorChallenges.consumedAt),
          gt(twoFactorChallenges.expiresAt, new Date())
        )
      )
      .orderBy(desc(twoFactorChallenges.createdAt))
      .limit(1)
  )[0];
  if (
    !challenge ||
    challenge.attempts >= 5 ||
    !input.isValid(challenge.codeHash)
  ) {
    if (challenge)
      await db
        .update(twoFactorChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(twoFactorChallenges.id, challenge.id));
    return false;
  }
  await db
    .update(twoFactorChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(twoFactorChallenges.id, challenge.id));
  return true;
}

export async function createDailyReport(input: {
  userId: number;
  organisationId: number;
  recipientEmail: string;
  cronExpression: string;
}) {
  const db = await requireDb();
  const result = await db.insert(dailyReports).values(input);
  return Number(result[0].insertId);
}

export async function attachDailyReportTask(input: {
  reportId: number;
  userId: number;
  organisationId: number;
  taskUid: string;
}) {
  const db = await requireDb();
  await db
    .update(dailyReports)
    .set({ scheduleCronTaskUid: input.taskUid })
    .where(
      and(
        eq(dailyReports.id, input.reportId),
        eq(dailyReports.userId, input.userId),
        eq(dailyReports.organisationId, input.organisationId)
      )
    );
}

export async function listDailyReports(userId: number, organisationId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.userId, userId),
        eq(dailyReports.organisationId, organisationId)
      )
    )
    .orderBy(desc(dailyReports.createdAt));
}

export async function getDailyReportByTaskUid(taskUid: string) {
  const db = await requireDb();
  return (
    await db
      .select()
      .from(dailyReports)
      .where(eq(dailyReports.scheduleCronTaskUid, taskUid))
      .limit(1)
  )[0];
}

export async function markDailyReportDelivery(
  reportId: number,
  deliveryKey: string
) {
  const db = await requireDb();
  await db
    .update(dailyReports)
    .set({ lastDeliveryKey: deliveryKey, lastSentAt: new Date() })
    .where(eq(dailyReports.id, reportId));
}

export async function releaseDailyReportDelivery(
  reportId: number,
  deliveryKey: string
) {
  const db = await requireDb();
  await db
    .update(dailyReports)
    .set({ lastDeliveryKey: null })
    .where(
      and(
        eq(dailyReports.id, reportId),
        eq(dailyReports.lastDeliveryKey, deliveryKey)
      )
    );
}

export async function getCompanySetup(userId: number, organisationId: number) {
  const db = await requireDb();
  const [profile, discoveries, playbooks] = await Promise.all([
    db
      .select()
      .from(companyProfiles)
      .where(eq(companyProfiles.organisationId, organisationId))
      .orderBy(
        desc(companyProfiles.confirmedAt),
        desc(companyProfiles.updatedAt)
      )
      .limit(1),
    db
      .select()
      .from(websiteDiscoveries)
      .where(eq(websiteDiscoveries.organisationId, organisationId))
      .orderBy(desc(websiteDiscoveries.createdAt))
      .limit(8),
    db
      .select()
      .from(automationPlaybooks)
      .where(
        and(
          eq(automationPlaybooks.userId, userId),
          eq(automationPlaybooks.organisationId, organisationId)
        )
      )
      .orderBy(desc(automationPlaybooks.updatedAt)),
  ]);
  return {
    profile: profile[0] ?? null,
    discoveries,
    currentDiscovery:
      discoveries.find(discovery => discovery.status === "review_required") ??
      null,
    playbooks,
  };
}

export async function upsertCompanyProfile(input: {
  userId: number;
  organisationId: number;
  companyName: string;
  websiteUrl?: string | null;
  industry?: string | null;
  companySize?: string | null;
  primaryMarket?: string | null;
  salesMotion?: string | null;
  productsServices?: string | null;
  typicalCustomer?: string | null;
  primarySalesObjective?: string | null;
  brandVoice?: string | null;
}) {
  const db = await requireDb();
  const existing = (
    await db
      .select({ id: companyProfiles.id })
      .from(companyProfiles)
      .where(eq(companyProfiles.organisationId, input.organisationId))
      .orderBy(
        desc(companyProfiles.confirmedAt),
        desc(companyProfiles.updatedAt)
      )
      .limit(1)
  )[0];
  const values = {
    companyName: input.companyName,
    websiteUrl: input.websiteUrl ?? null,
    industry: input.industry ?? null,
    companySize: input.companySize ?? null,
    primaryMarket: input.primaryMarket ?? null,
    salesMotion: input.salesMotion ?? null,
    productsServices: input.productsServices ?? null,
    typicalCustomer: input.typicalCustomer ?? null,
    primarySalesObjective: input.primarySalesObjective ?? null,
    brandVoice: input.brandVoice ?? null,
  };
  if (existing)
    await db
      .update(companyProfiles)
      .set(values)
      .where(
        and(
          eq(companyProfiles.id, existing.id),
          eq(companyProfiles.organisationId, input.organisationId)
        )
      );
  else await db.insert(companyProfiles).values({ ...input, ...values });
  const profile = (
    await db
      .select()
      .from(companyProfiles)
      .where(eq(companyProfiles.organisationId, input.organisationId))
      .orderBy(
        desc(companyProfiles.confirmedAt),
        desc(companyProfiles.updatedAt)
      )
      .limit(1)
  )[0];
  if (!profile) throw new Error("Company profile could not be saved.");
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "company_profile_saved",
    entityType: "company_profile",
    entityId: String(profile.id),
    summary: "Company setup profile saved.",
    metadata: { hasWebsite: Boolean(profile.websiteUrl) },
  });
  return profile;
}

export async function getAssistantOperationalContext(
  userId: number,
  organisationId: number
) {
  const db = await requireDb();
  const [calls, playbooks, systems] = await Promise.all([
    db
      .select({
        id: callSessions.id,
        leadLabel: callSessions.leadLabel,
        status: callSessions.status,
        summary: callSessions.summary,
        structuredOutcome: callSessions.structuredOutcome,
        createdAt: callSessions.createdAt,
      })
      .from(callSessions)
      .where(
        and(
          eq(callSessions.userId, userId),
          eq(callSessions.organisationId, organisationId)
        )
      )
      .orderBy(desc(callSessions.createdAt))
      .limit(10),
    db
      .select({
        id: automationPlaybooks.id,
        title: automationPlaybooks.title,
        trigger: automationPlaybooks.trigger,
        description: automationPlaybooks.description,
        status: automationPlaybooks.status,
        requiredCapabilities: automationPlaybooks.requiredCapabilities,
      })
      .from(automationPlaybooks)
      .where(
        and(
          eq(automationPlaybooks.userId, userId),
          eq(automationPlaybooks.organisationId, organisationId)
        )
      )
      .orderBy(desc(automationPlaybooks.updatedAt))
      .limit(12),
    db
      .select({
        id: connectedSystems.id,
        provider: connectedSystems.provider,
        displayName: connectedSystems.displayName,
        status: connectedSystems.status,
        verifiedCapabilities: connectedSystems.verifiedCapabilities,
      })
      .from(connectedSystems)
      .where(eq(connectedSystems.organisationId, organisationId))
      .limit(20),
  ]);
  return {
    recentCalls: calls.map(call => ({
      ...call,
      summary: call.summary?.slice(0, 2_000) ?? null,
    })),
    approvedPlaybooks: playbooks,
    connections: systems,
    allowedActions: Array.from(
      new Set(systems.flatMap(system => system.verifiedCapabilities))
    ).sort(),
  };
}

export async function listCrmCustomers(organisationId: number) {
  const db = await requireDb();
  const [contacts, companies, activities, opportunities, tasks] =
    await Promise.all([
      db
        .select({
          id: crmContacts.id,
          connectedSystemId: crmContacts.connectedSystemId,
          externalId: crmContacts.externalId,
          companyExternalId: crmContacts.companyExternalId,
          firstName: crmContacts.firstName,
          lastName: crmContacts.lastName,
          email: crmContacts.email,
          phone: crmContacts.phone,
          lifecycleStage: crmContacts.lifecycleStage,
          updatedAt: crmContacts.updatedAt,
        })
        .from(crmContacts)
        .where(eq(crmContacts.organisationId, organisationId))
        .orderBy(desc(crmContacts.updatedAt))
        .limit(250),
      db
        .select({
          connectedSystemId: crmCompanies.connectedSystemId,
          externalId: crmCompanies.externalId,
          name: crmCompanies.name,
        })
        .from(crmCompanies)
        .where(eq(crmCompanies.organisationId, organisationId))
        .limit(500),
      db
        .select({
          connectedSystemId: crmActivities.connectedSystemId,
          contactExternalId: crmActivities.contactExternalId,
          activityType: crmActivities.activityType,
          occurredAt: crmActivities.occurredAt,
        })
        .from(crmActivities)
        .where(eq(crmActivities.organisationId, organisationId))
        .orderBy(desc(crmActivities.occurredAt))
        .limit(1_000),
      db
        .select({
          connectedSystemId: crmOpportunities.connectedSystemId,
          contactExternalId: crmOpportunities.contactExternalId,
          name: crmOpportunities.name,
          stage: crmOpportunities.stage,
          valueMinor: crmOpportunities.valueMinor,
          currency: crmOpportunities.currency,
          nextStepAt: crmOpportunities.nextStepAt,
          updatedAt: crmOpportunities.updatedAt,
        })
        .from(crmOpportunities)
        .where(eq(crmOpportunities.organisationId, organisationId))
        .orderBy(desc(crmOpportunities.updatedAt))
        .limit(1_000),
      db
        .select({
          connectedSystemId: crmTasks.connectedSystemId,
          contactExternalId: crmTasks.contactExternalId,
          title: crmTasks.title,
          status: crmTasks.status,
          dueAt: crmTasks.dueAt,
        })
        .from(crmTasks)
        .where(eq(crmTasks.organisationId, organisationId))
        .orderBy(desc(crmTasks.dueAt))
        .limit(1_000),
    ]);
  const companyByKey = new Map(
    companies.map(company => [
      `${company.connectedSystemId}:${company.externalId}`,
      company.name,
    ])
  );
  const firstByContact = <
    T extends { connectedSystemId: number; contactExternalId: string | null },
  >(
    rows: T[],
    include: (row: T) => boolean = () => true
  ) => {
    const result = new Map<string, T>();
    for (const row of rows) {
      if (!row.contactExternalId || !include(row)) continue;
      const key = `${row.connectedSystemId}:${row.contactExternalId}`;
      if (!result.has(key)) result.set(key, row);
    }
    return result;
  };
  const activityByContact = firstByContact(activities);
  const opportunityByContact = firstByContact(
    opportunities,
    item => !/closed|lost|won/i.test(item.stage ?? "")
  );
  const taskByContact = new Map<string, (typeof tasks)[number]>();
  for (const task of tasks) {
    if (
      !task.contactExternalId ||
      /completed|closed|done|cancelled/i.test(task.status)
    ) {
      continue;
    }
    const key = `${task.connectedSystemId}:${task.contactExternalId}`;
    const current = taskByContact.get(key);
    const dueAt = task.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const currentDueAt = current?.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (!current || dueAt < currentDueAt) taskByContact.set(key, task);
  }
  return contacts.map(contact => ({
    ...contact,
    name:
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.email ||
      contact.phone ||
      `CRM contact ${contact.externalId}`,
    companyName: contact.companyExternalId
      ? (companyByKey.get(
          `${contact.connectedSystemId}:${contact.companyExternalId}`
        ) ?? null)
      : null,
    lastInteraction:
      activityByContact.get(
        `${contact.connectedSystemId}:${contact.externalId}`
      ) ?? null,
    openOpportunity:
      opportunityByContact.get(
        `${contact.connectedSystemId}:${contact.externalId}`
      ) ?? null,
    nextAction:
      taskByContact.get(`${contact.connectedSystemId}:${contact.externalId}`) ??
      null,
  }));
}

export async function saveWebsiteDiscoveryReview(input: {
  userId: number;
  organisationId: number;
  companyProfileId: number;
  sourceUrl: string;
  pageTitle: string | null;
  extractedText: string;
  proposedFacts: Record<string, unknown>;
  proposedKnowledge: Array<{
    title: string;
    content: string;
    sourceUrl: string;
    fetchedAt: string;
    category: string;
    reviewState?: string;
    confidence?: string;
    evidenceBasis?: string;
    trustEligible?: boolean;
  }>;
  reviewAgentKey?: string;
  reviewState?: "completed" | "unavailable" | "pending";
}) {
  const db = await requireDb();
  const profile = (
    await db
      .select()
      .from(companyProfiles)
      .where(
        and(
          eq(companyProfiles.id, input.companyProfileId),
          eq(companyProfiles.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!profile)
    throw new Error("Company profile is unavailable for website discovery.");
  const previous = await db
    .select({ discoveryVersion: websiteDiscoveries.discoveryVersion })
    .from(websiteDiscoveries)
    .where(eq(websiteDiscoveries.companyProfileId, input.companyProfileId))
    .orderBy(desc(websiteDiscoveries.discoveryVersion))
    .limit(1);
  const discoveryVersion = (previous[0]?.discoveryVersion || 0) + 1;
  const completenessStatus = (
    input.proposedFacts.completeness as { status?: string } | undefined
  )?.status;
  const discoveryId = await db.transaction(async tx => {
    // A fresh scan replaces only earlier pending drafts. Confirmed knowledge is retained.
    await tx
      .update(websiteDiscoveries)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(
        and(
          eq(websiteDiscoveries.companyProfileId, input.companyProfileId),
          eq(websiteDiscoveries.status, "review_required")
        )
      );
    const result = await tx.insert(websiteDiscoveries).values({
      userId: input.userId,
      organisationId: input.organisationId,
      companyProfileId: input.companyProfileId,
      sourceUrl: input.sourceUrl,
      pageTitle: input.pageTitle,
      extractedText: input.extractedText,
      proposedFacts: { ...input.proposedFacts, discoveryVersion },
      proposedKnowledge: input.proposedKnowledge,
      discoveryVersion,
      reviewAgentKey: input.reviewAgentKey || null,
      reviewState: input.reviewState || "pending",
      status: "review_required",
    });
    return Number(result[0].insertId);
  });
  await db
    .update(companyProfiles)
    .set({ discoveryStatus: "review_required" })
    .where(
      and(
        eq(companyProfiles.id, input.companyProfileId),
        eq(companyProfiles.organisationId, input.organisationId)
      )
    );
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "website_discovery_review_ready",
    entityType: "website_discovery",
    entityId: String(discoveryId),
    summary:
      completenessStatus === "incomplete"
        ? "Website evidence was retained, but completeness checks require a retry before approval."
        : "Complete-site company knowledge is ready for deliberate user review.",
    metadata: {
      sourceUrl: input.sourceUrl,
      candidateCount: input.proposedKnowledge.length,
      discoveryVersion,
      reviewState: input.reviewState || "pending",
      pagesCrawled: input.proposedFacts.pagesCrawled ?? null,
      completenessStatus: completenessStatus ?? null,
    },
  });
  return discoveryId;
}

export async function confirmWebsiteDiscovery(input: {
  userId: number;
  organisationId: number;
  companyProfileId: number;
  discoveryId: number;
  knowledgeIndexes: number[];
  corrections?: Array<{ index: number; title: string; content: string }>;
}) {
  const db = await requireDb();
  const profile = (
    await db
      .select()
      .from(companyProfiles)
      .where(
        and(
          eq(companyProfiles.id, input.companyProfileId),
          eq(companyProfiles.organisationId, input.organisationId)
        )
      )
      .limit(1)
  )[0];
  if (!profile)
    throw new Error("Company profile is unavailable for confirmation.");
  const discovery = (
    await db
      .select()
      .from(websiteDiscoveries)
      .where(
        and(
          eq(websiteDiscoveries.id, input.discoveryId),
          eq(websiteDiscoveries.companyProfileId, input.companyProfileId),
          eq(websiteDiscoveries.organisationId, input.organisationId),
          eq(websiteDiscoveries.status, "review_required")
        )
      )
      .limit(1)
  )[0];
  if (!discovery)
    throw new Error(
      "The website review is unavailable or has already been completed. Run discovery again."
    );
  const completeness = (
    discovery.proposedFacts as {
      completeness?: { status?: string };
    }
  ).completeness;
  if (completeness?.status === "incomplete")
    throw new Error(
      "This company-knowledge pack is incomplete. Retry company learning before approving any facts."
    );
  const candidates = discovery.proposedKnowledge as Array<{
    title: string;
    content: string;
    sourceUrl?: string;
    fetchedAt?: string;
    category?: string;
    reviewState?: string;
    confidence?: string;
    evidenceBasis?: string;
    trustEligible?: boolean;
  }>;
  const corrections = new Map(
    (input.corrections ?? []).map(item => [item.index, item])
  );
  const permanentlyExcluded = new Set([
    "comparison",
    "competitor",
    "testimonial",
    "case_study",
    "example",
    "historical",
    "navigation",
    "marketing_copy",
    "ambiguous",
    "exclude",
  ]);
  const selectedIndexes = Array.from(new Set(input.knowledgeIndexes)).filter(
    index => {
      if (index < 0 || index >= candidates.length) return false;
      const candidate = candidates[index];
      // A human may resolve a genuine first-party fact conflict, but may never turn
      // contextual/comparative material or an unavailable AI review into company truth.
      if (
        permanentlyExcluded.has(candidate.category || "") ||
        candidate.reviewState === "ambiguous"
      )
        return false;
      return (
        candidate.trustEligible !== false ||
        (candidate.reviewState === "conflict" && corrections.has(index))
      );
    }
  );
  const confirmedKnowledge = selectedIndexes
    .map(index => {
      const candidate = candidates[index];
      const correction = corrections.get(index);
      return correction
        ? {
            ...candidate,
            title: correction.title.trim().slice(0, 220),
            content: correction.content.trim().slice(0, 40_000),
          }
        : candidate;
    })
    .filter(item => item.title && item.content);
  await db.transaction(async tx => {
    await tx
      .update(websiteDiscoveries)
      .set({
        status: "confirmed",
        reviewedAt: new Date(),
        proposedFacts: {
          ...discovery.proposedFacts,
          confirmedKnowledgeTitles: confirmedKnowledge.map(item => item.title),
          confirmedKnowledgeIndexes: selectedIndexes,
        },
      })
      .where(eq(websiteDiscoveries.id, discovery.id));
    await tx
      .update(companyProfiles)
      .set({ discoveryStatus: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(companyProfiles.id, input.companyProfileId),
          eq(companyProfiles.organisationId, input.organisationId)
        )
      );
    if (confirmedKnowledge.length)
      await tx.insert(knowledgeSources).values(
        confirmedKnowledge.map(item => ({
          userId: input.userId,
          organisationId: input.organisationId,
          title: item.title,
          sourceType: "url" as const,
          sourceUrl: item.sourceUrl || discovery.sourceUrl,
          sourceFetchedAt: item.fetchedAt
            ? new Date(item.fetchedAt)
            : discovery.createdAt,
          sourceMetadata: {
            category: item.category || "page",
            discoveryId: discovery.id,
            reviewAgentKey: discovery.reviewAgentKey,
            discoveryVersion: discovery.discoveryVersion,
          },
          visibility: "organisation" as const,
          content: item.content,
          status: "ready" as const,
        }))
      );
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "website_discovery_confirmed",
    entityType: "website_discovery",
    entityId: String(discovery.id),
    summary: "Confirmed website knowledge is now available to the assistant.",
    metadata: {
      sourceUrl: discovery.sourceUrl,
      confirmedKnowledgeItems: confirmedKnowledge.length,
    },
  });
  return {
    discoveryId: discovery.id,
    confirmedKnowledgeItems: confirmedKnowledge.length,
  };
}

export async function saveAutomationPlaybook(input: {
  userId: number;
  organisationId: number;
  title: string;
  trigger: string;
  description: string;
  agentKey: string;
  requiredCapabilities: string[];
  status: "draft" | "active" | "paused";
}) {
  const db = await requireDb();
  const result = await db
    .insert(automationPlaybooks)
    .values({ ...input, reviewRequired: true });
  const id = Number(result[0].insertId);
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "automation_playbook_saved",
    entityType: "automation_playbook",
    entityId: String(id),
    summary: `Review-first playbook '${input.title}' saved.`,
    metadata: { agentKey: input.agentKey, status: input.status },
  });
  return id;
}
