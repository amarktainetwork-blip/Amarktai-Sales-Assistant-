import {
  index,
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core identity record. The managed preview uses OAuth while the Webdock
 * deployment uses the same user boundary with a local bootstrap administrator.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/**
 * Non-sensitive connection profiles. OAuth tokens, API keys, and private
 * endpoints remain deployment secrets and are never stored in this table.
 */
export const integrationProfiles = mysqlTable(
  "integrationProfiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["genie", "outlook", "genx"]).notNull(),
    displayName: varchar("displayName", { length: 140 }).notNull(),
    status: mysqlEnum("status", ["needs_credentials", "ready", "paused", "error"])
      .default("needs_credentials")
      .notNull(),
    scopeSummary: text("scopeSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("integrationProfiles_user_provider_idx").on(table.userId, table.provider)],
);

/**
 * Immutable record of an assistant instruction and the safe, review-first
 * action plan produced from it. External actions are never performed here.
 */
export const companyProfiles = mysqlTable("companyProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  companyName: varchar("companyName", { length: 220 }).notNull(),
  websiteUrl: varchar("websiteUrl", { length: 1024 }),
  industry: varchar("industry", { length: 180 }),
  companySize: varchar("companySize", { length: 80 }),
  primaryMarket: varchar("primaryMarket", { length: 220 }),
  salesMotion: varchar("salesMotion", { length: 180 }),
  brandVoice: text("brandVoice"),
  discoveryStatus: mysqlEnum("discoveryStatus", ["not_started", "review_required", "confirmed", "failed"]).default("not_started").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("companyProfiles_user_idx").on(table.userId)]);

export const websiteDiscoveries = mysqlTable("websiteDiscoveries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  companyProfileId: int("companyProfileId").notNull().references(() => companyProfiles.id, { onDelete: "cascade" }),
  sourceUrl: varchar("sourceUrl", { length: 1024 }).notNull(),
  pageTitle: varchar("pageTitle", { length: 500 }),
  extractedText: text("extractedText"),
  proposedFacts: json("proposedFacts").$type<Record<string, unknown>>().notNull(),
  proposedKnowledge: json("proposedKnowledge").$type<Array<{ title: string; content: string }>>().notNull(),
  status: mysqlEnum("status", ["review_required", "confirmed", "rejected", "failed"]).default("review_required").notNull(),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("websiteDiscoveries_user_created_idx").on(table.userId, table.createdAt)]);

export const crmConnections = mysqlTable("crmConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: mysqlEnum("provider", ["genie", "hubspot", "salesforce", "pipedrive", "custom_browser"]).notNull(),
  displayName: varchar("displayName", { length: 180 }).notNull(),
  status: mysqlEnum("status", ["draft", "needs_credentials", "ready", "paused", "error"]).default("draft").notNull(),
  capabilities: json("capabilities").$type<Array<"contacts" | "tasks" | "opportunities" | "notes" | "activities" | "email" | "calendar">>().notNull(),
  connectionMode: mysqlEnum("connectionMode", ["api", "browser_automation", "custom"]).notNull(),
  configurationHint: text("configurationHint"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("crmConnections_user_provider_idx").on(table.userId, table.provider)]);

export const automationPlaybooks = mysqlTable("automationPlaybooks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 220 }).notNull(),
  trigger: varchar("trigger", { length: 160 }).notNull(),
  description: text("description").notNull(),
  agentKey: varchar("agentKey", { length: 80 }).notNull(),
  requiredCapabilities: json("requiredCapabilities").$type<string[]>().notNull(),
  reviewRequired: boolean("reviewRequired").default(true).notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("automationPlaybooks_user_status_idx").on(table.userId, table.status)]);

export const workflowRuns = mysqlTable(
  "workflowRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    workflowKey: varchar("workflowKey", { length: 80 }).notNull(),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["prepared", "blocked", "approved", "completed", "failed"])
      .default("prepared")
      .notNull(),
    input: json("input").$type<Record<string, unknown>>().notNull(),
    verificationSummary: text("verificationSummary").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("workflowRuns_user_created_idx").on(table.userId, table.createdAt)],
);

/**
 * Every intended CRM, email, message, task, or opportunity action is queued
 * as a reviewable proposal with an idempotency key before any execution layer
 * is permitted to act.
 */
export const actionProposals = mysqlTable(
  "actionProposals",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    workflowRunId: int("workflowRunId").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    actionType: varchar("actionType", { length: 80 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    targetLabel: varchar("targetLabel", { length: 180 }).notNull(),
    state: mysqlEnum("state", ["review_required", "approved", "skipped", "executed", "blocked"])
      .default("review_required")
      .notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    reviewedAt: timestamp("reviewedAt"),
    executedAt: timestamp("executedAt"),
    executionResult: json("executionResult").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("actionProposals_user_state_idx").on(table.userId, table.state),
    index("actionProposals_run_idx").on(table.workflowRunId),
    uniqueIndex("actionProposals_idempotency_uq").on(table.userId, table.idempotencyKey),
  ],
);

/**
 * Internal callback planning record. It mirrors planned tasks and deliberately
 * keeps external CRM task identifiers separate for a future verified connector.
 */
export const callbackTasks = mysqlTable(
  "callbackTasks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high"]).default("normal").notNull(),
    state: mysqlEnum("state", ["open", "completed", "blocked"]).default("open").notNull(),
    dueAt: timestamp("dueAt"),
    externalTaskId: varchar("externalTaskId", { length: 160 }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("callbackTasks_user_state_due_idx").on(table.userId, table.state, table.dueAt),
    uniqueIndex("callbackTasks_idempotency_uq").on(table.userId, table.idempotencyKey),
  ],
);

/**
 * Stores a call transcript or a user-authored live-call note, plus the
 * coach-facing summary generated by the configured model provider.
 */
export const callSessions = mysqlTable(
  "callSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["in_progress", "ready_for_review", "completed"])
      .default("ready_for_review")
      .notNull(),
    audioKey: varchar("audioKey", { length: 512 }),
    transcript: text("transcript"),
    coachNotes: text("coachNotes"),
    summary: text("summary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("callSessions_user_created_idx").on(table.userId, table.createdAt)],
);

/** Course, programme, and policy content used by the knowledge agent. */
export const knowledgeSources = mysqlTable(
  "knowledgeSources",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 220 }).notNull(),
    sourceType: mysqlEnum("sourceType", ["note", "url", "document"]).default("note").notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    content: text("content"),
    status: mysqlEnum("status", ["draft", "ready", "needs_review"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("knowledgeSources_user_status_idx").on(table.userId, table.status)],
);

/** Append-only user-visible operational audit trail. */
export const auditEntries = mysqlTable(
  "auditEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    entityType: varchar("entityType", { length: 100 }).notNull(),
    entityId: varchar("entityId", { length: 100 }),
    summary: text("summary").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("auditEntries_user_created_idx").on(table.userId, table.createdAt)],
);

/** Short-lived, hashed email verification challenges for app-level second-factor checks. */
export const twoFactorChallenges = mysqlTable(
  "twoFactorChallenges",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: mysqlEnum("purpose", ["workspace_access"]).default("workspace_access").notNull(),
    codeHash: varchar("codeHash", { length: 128 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("twoFactorChallenges_user_created_idx").on(table.userId, table.createdAt)],
);

/** A user-owned daily digest configuration and the task UID that owns its cron lifecycle. */
export const dailyReports = mysqlTable(
  "dailyReports",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipientEmail: varchar("recipientEmail", { length: 320 }).notNull(),
    cronExpression: varchar("cronExpression", { length: 64 }).notNull(),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    isEnabled: boolean("isEnabled").default(true).notNull(),
    lastDeliveryKey: varchar("lastDeliveryKey", { length: 32 }),
    lastSentAt: timestamp("lastSentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("dailyReports_user_enabled_idx").on(table.userId, table.isEnabled),
    uniqueIndex("dailyReports_task_uid_uq").on(table.scheduleCronTaskUid),
  ],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type IntegrationProfile = typeof integrationProfiles.$inferSelect;
export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type WebsiteDiscovery = typeof websiteDiscoveries.$inferSelect;
export type CrmConnection = typeof crmConnections.$inferSelect;
export type AutomationPlaybook = typeof automationPlaybooks.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type ActionProposal = typeof actionProposals.$inferSelect;
export type CallbackTask = typeof callbackTasks.$inferSelect;
export type CallSession = typeof callSessions.$inferSelect;
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
