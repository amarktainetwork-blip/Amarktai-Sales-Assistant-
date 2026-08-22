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
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["genie", "outlook", "genx"]).notNull(),
    displayName: varchar("displayName", { length: 140 }).notNull(),
    status: mysqlEnum("status", ["needs_credentials", "ready", "paused", "error"])
      .default("needs_credentials")
      .notNull(),
    scopeSummary: text("scopeSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("integrationProfiles_user_provider_idx").on(table.userId, table.provider), index("integrationProfiles_org_provider_idx").on(table.organisationId, table.provider)],
);

/**
 * Immutable record of an assistant instruction and the safe, review-first
 * action plan produced from it. External actions are never performed here.
 */
export const companyProfiles = mysqlTable("companyProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  organisationId: int("organisationId").references(() => organisations.id, { onDelete: "cascade" }),
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
}, table => [uniqueIndex("companyProfiles_organisation_user_unique").on(table.organisationId, table.userId), index("companyProfiles_user_idx").on(table.userId), index("companyProfiles_org_idx").on(table.organisationId)]);

export const websiteDiscoveries = mysqlTable("websiteDiscoveries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  organisationId: int("organisationId").references(() => organisations.id, { onDelete: "cascade" }),
  companyProfileId: int("companyProfileId").notNull().references(() => companyProfiles.id, { onDelete: "cascade" }),
  sourceUrl: varchar("sourceUrl", { length: 1024 }).notNull(),
  pageTitle: varchar("pageTitle", { length: 500 }),
  extractedText: text("extractedText"),
  proposedFacts: json("proposedFacts").$type<Record<string, unknown>>().notNull(),
  proposedKnowledge: json("proposedKnowledge").$type<Array<{ title: string; content: string }>>().notNull(),
  status: mysqlEnum("status", ["review_required", "confirmed", "rejected", "failed"]).default("review_required").notNull(),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("websiteDiscoveries_user_created_idx").on(table.userId, table.createdAt), index("websiteDiscoveries_org_created_idx").on(table.organisationId, table.createdAt)]);

export const crmConnections = mysqlTable("crmConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  organisationId: int("organisationId").references(() => organisations.id, { onDelete: "cascade" }),
  provider: mysqlEnum("provider", ["genie", "hubspot", "salesforce", "pipedrive", "custom_browser"]).notNull(),
  displayName: varchar("displayName", { length: 180 }).notNull(),
  status: mysqlEnum("status", ["draft", "needs_credentials", "ready", "paused", "error"]).default("draft").notNull(),
  capabilities: json("capabilities").$type<Array<"contacts" | "tasks" | "opportunities" | "notes" | "activities" | "email" | "calendar">>().notNull(),
  connectionMode: mysqlEnum("connectionMode", ["api", "browser_automation", "custom"]).notNull(),
  configurationHint: text("configurationHint"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("crmConnections_user_provider_idx").on(table.userId, table.provider), index("crmConnections_org_provider_idx").on(table.organisationId, table.provider)]);

export const automationPlaybooks = mysqlTable("automationPlaybooks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  organisationId: int("organisationId").references(() => organisations.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 220 }).notNull(),
  trigger: varchar("trigger", { length: 160 }).notNull(),
  description: text("description").notNull(),
  agentKey: varchar("agentKey", { length: 80 }).notNull(),
  requiredCapabilities: json("requiredCapabilities").$type<string[]>().notNull(),
  reviewRequired: boolean("reviewRequired").default(true).notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("automationPlaybooks_user_status_idx").on(table.userId, table.status), index("automationPlaybooks_org_status_idx").on(table.organisationId, table.status)]);

export const workflowRuns = mysqlTable(
  "workflowRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
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
  table => [index("workflowRuns_user_created_idx").on(table.userId, table.createdAt), index("workflowRuns_organisation_created_idx").on(table.organisationId, table.createdAt)],
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
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
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
    executionClaimId: varchar("executionClaimId", { length: 64 }),
    executionClaimedAt: timestamp("executionClaimedAt"),
    executedAt: timestamp("executedAt"),
    executionResult: json("executionResult").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("actionProposals_user_state_idx").on(table.userId, table.state),
    index("actionProposals_organisation_state_idx").on(table.organisationId, table.state),
    index("actionProposals_claim_expiry_idx").on(table.state, table.executionClaimedAt),
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
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
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
    index("callbackTasks_organisation_state_due_idx").on(table.organisationId, table.state, table.dueAt),
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
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
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
  table => [index("callSessions_user_created_idx").on(table.userId, table.createdAt), index("callSessions_organisation_created_idx").on(table.organisationId, table.createdAt)],
);

/** Course, programme, and policy content used by the knowledge agent. */
export const knowledgeSources = mysqlTable(
  "knowledgeSources",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
    title: varchar("title", { length: 220 }).notNull(),
    sourceType: mysqlEnum("sourceType", ["note", "url", "document"]).default("note").notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    content: text("content"),
    status: mysqlEnum("status", ["draft", "ready", "needs_review"]).default("draft").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("knowledgeSources_user_status_idx").on(table.userId, table.status), index("knowledgeSources_organisation_status_idx").on(table.organisationId, table.status)],
);

/** Append-only user-visible operational audit trail. */
export const auditEntries = mysqlTable(
  "auditEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    entityType: varchar("entityType", { length: 100 }).notNull(),
    entityId: varchar("entityId", { length: 100 }),
    summary: text("summary").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("auditEntries_user_created_idx").on(table.userId, table.createdAt), index("auditEntries_organisation_created_idx").on(table.organisationId, table.createdAt)],
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
    organisationId: int("organisationId").references(() => organisations.id, { onDelete: "set null" }),
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
    index("dailyReports_organisation_enabled_idx").on(table.organisationId, table.isEnabled),
    uniqueIndex("dailyReports_task_uid_uq").on(table.scheduleCronTaskUid),
  ],
);

/**
 * Organisation-scoped foundations for the universal sales operating layer.
 * Legacy user-owned records remain intact while new shared CRM data belongs to
 * an organisation and may be safely used by several mapped salespeople.
 */
export const organisations = mysqlTable("organisations", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 220 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  timezone: varchar("timezone", { length: 80 }).notNull().default("UTC"),
  locale: varchar("locale", { length: 24 }).notNull().default("en"),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  settings: json("settings").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [index("organisations_owner_idx").on(table.ownerUserId)]);

export const organisationMembers = mysqlTable("organisationMembers", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["owner", "manager", "salesperson", "auditor"]).notNull().default("salesperson"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("organisation_members_unique").on(table.organisationId, table.userId),
  index("organisation_members_user_idx").on(table.userId, table.isActive),
]);

export const connectedSystems = mysqlTable("connectedSystems", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  provider: mysqlEnum("provider", ["genie", "hubspot", "salesforce", "pipedrive", "zoho", "custom_browser", "custom_api", "csv_import"]).notNull(),
  displayName: varchar("displayName", { length: 180 }).notNull(),
  baseUrl: varchar("baseUrl", { length: 1024 }),
  connectionMethod: mysqlEnum("connectionMethod", ["oauth", "browser", "sidecar", "custom_adapter", "import"]).notNull(),
  status: mysqlEnum("status", ["connecting", "testing", "ready", "needs_attention", "authentication_expired", "limited_permissions", "paused", "disconnected", "error"]).notNull().default("disconnected"),
  allowedReadCapabilities: json("allowedReadCapabilities").$type<string[]>().notNull(),
  allowedWriteCapabilities: json("allowedWriteCapabilities").$type<string[]>().notNull(),
  verifiedCapabilities: json("verifiedCapabilities").$type<string[]>().notNull(),
  accountExternalId: varchar("accountExternalId", { length: 180 }),
  scopes: json("scopes").$type<string[]>().notNull(),
  configuration: json("configuration").$type<Record<string, unknown>>().notNull(),
  lastHealthCheckAt: timestamp("lastHealthCheckAt"),
  lastHealthSummary: text("lastHealthSummary"),
  readyAt: timestamp("readyAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  index("connected_systems_org_status_idx").on(table.organisationId, table.status),
  index("connected_systems_org_provider_idx").on(table.organisationId, table.provider),
]);

/** Encrypted material only: values never leave the server in API responses or audit records. */
export const connectionSecrets = mysqlTable("connectionSecrets", {
  id: int("id").autoincrement().primaryKey(),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  secretKind: varchar("secretKind", { length: 80 }).notNull(),
  keyVersion: varchar("keyVersion", { length: 64 }).notNull(),
  iv: varchar("iv", { length: 128 }).notNull(),
  authTag: varchar("authTag", { length: 128 }).notNull(),
  ciphertext: text("ciphertext").notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("connection_secrets_system_kind_unique").on(table.connectedSystemId, table.secretKind)]);

export const authorisedDomains = mysqlTable("authorisedDomains", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  hostname: varchar("hostname", { length: 253 }).notNull(),
  allowedPaths: json("allowedPaths").$type<string[]>().notNull(),
  status: mysqlEnum("status", ["pending", "verified", "paused", "revoked"]).notNull().default("pending"),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("authorised_domains_system_host_unique").on(table.connectedSystemId, table.hostname),
  index("authorised_domains_org_status_idx").on(table.organisationId, table.status),
]);

export const externalUserMappings = mysqlTable("externalUserMappings", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  externalUserId: varchar("externalUserId", { length: 180 }).notNull(),
  displayName: varchar("displayName", { length: 220 }).notNull(),
  email: varchar("email", { length: 320 }),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("external_user_mapping_system_external_unique").on(table.connectedSystemId, table.externalUserId),
  index("external_user_mapping_org_user_idx").on(table.organisationId, table.userId),
]);

/** Explicit CRM pipeline/stage interpretation set by a manager after connector verification. */
export const crmPipelineStageMappings = mysqlTable("crmPipelineStageMappings", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalPipelineId: varchar("externalPipelineId", { length: 180 }).notNull(),
  externalStageId: varchar("externalStageId", { length: 180 }).notNull(),
  pipelineLabel: varchar("pipelineLabel", { length: 220 }).notNull(),
  stageLabel: varchar("stageLabel", { length: 220 }).notNull(),
  category: mysqlEnum("category", ["open", "qualified", "proposal", "won", "lost", "other"]).notNull().default("other"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_pipeline_stage_mapping_system_stage_unique").on(table.connectedSystemId, table.externalStageId),
  index("crm_pipeline_stage_mapping_org_category_idx").on(table.organisationId, table.category, table.isActive),
]);

export const crmCompanies = mysqlTable("crmCompanies", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalId: varchar("externalId", { length: 180 }).notNull(),
  name: varchar("name", { length: 320 }).notNull(),
  website: varchar("website", { length: 1024 }),
  ownerExternalId: varchar("ownerExternalId", { length: 180 }),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  sourceRevision: varchar("sourceRevision", { length: 180 }),
  raw: json("raw").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_companies_system_external_unique").on(table.connectedSystemId, table.externalId),
  index("crm_companies_org_owner_idx").on(table.organisationId, table.ownerExternalId),
]);

export const crmContacts = mysqlTable("crmContacts", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalId: varchar("externalId", { length: 180 }).notNull(),
  companyExternalId: varchar("companyExternalId", { length: 180 }),
  ownerExternalId: varchar("ownerExternalId", { length: 180 }),
  firstName: varchar("firstName", { length: 160 }),
  lastName: varchar("lastName", { length: 160 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 80 }),
  lifecycleStage: varchar("lifecycleStage", { length: 120 }),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  sourceRevision: varchar("sourceRevision", { length: 180 }),
  raw: json("raw").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_contacts_system_external_unique").on(table.connectedSystemId, table.externalId),
  index("crm_contacts_org_owner_idx").on(table.organisationId, table.ownerExternalId),
  index("crm_contacts_org_email_idx").on(table.organisationId, table.email),
]);

export const crmOpportunities = mysqlTable("crmOpportunities", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalId: varchar("externalId", { length: 180 }).notNull(),
  companyExternalId: varchar("companyExternalId", { length: 180 }),
  contactExternalId: varchar("contactExternalId", { length: 180 }),
  ownerExternalId: varchar("ownerExternalId", { length: 180 }),
  name: varchar("name", { length: 320 }).notNull(),
  pipeline: varchar("pipeline", { length: 180 }),
  stage: varchar("stage", { length: 180 }),
  valueMinor: int("valueMinor"),
  currency: varchar("currency", { length: 8 }),
  closeAt: timestamp("closeAt"),
  lastActivityAt: timestamp("lastActivityAt"),
  nextStepAt: timestamp("nextStepAt"),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  sourceRevision: varchar("sourceRevision", { length: 180 }),
  raw: json("raw").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_opportunities_system_external_unique").on(table.connectedSystemId, table.externalId),
  index("crm_opportunities_org_owner_stage_idx").on(table.organisationId, table.ownerExternalId, table.stage),
  index("crm_opportunities_org_activity_idx").on(table.organisationId, table.lastActivityAt),
]);

export const crmTasks = mysqlTable("crmTasks", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalId: varchar("externalId", { length: 180 }).notNull(),
  contactExternalId: varchar("contactExternalId", { length: 180 }),
  opportunityExternalId: varchar("opportunityExternalId", { length: 180 }),
  ownerExternalId: varchar("ownerExternalId", { length: 180 }),
  title: varchar("title", { length: 320 }).notNull(),
  status: varchar("status", { length: 120 }).notNull(),
  dueAt: timestamp("dueAt"),
  completedAt: timestamp("completedAt"),
  sourceUpdatedAt: timestamp("sourceUpdatedAt"),
  sourceRevision: varchar("sourceRevision", { length: 180 }),
  raw: json("raw").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_tasks_system_external_unique").on(table.connectedSystemId, table.externalId),
  index("crm_tasks_org_owner_due_idx").on(table.organisationId, table.ownerExternalId, table.dueAt),
]);

export const crmActivities = mysqlTable("crmActivities", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  externalId: varchar("externalId", { length: 180 }).notNull(),
  contactExternalId: varchar("contactExternalId", { length: 180 }),
  opportunityExternalId: varchar("opportunityExternalId", { length: 180 }),
  ownerExternalId: varchar("ownerExternalId", { length: 180 }),
  activityType: varchar("activityType", { length: 120 }).notNull(),
  occurredAt: timestamp("occurredAt").notNull(),
  body: text("body"),
  sourceRevision: varchar("sourceRevision", { length: 180 }),
  raw: json("raw").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [
  uniqueIndex("crm_activities_system_external_unique").on(table.connectedSystemId, table.externalId),
  index("crm_activities_org_owner_occurred_idx").on(table.organisationId, table.ownerExternalId, table.occurredAt),
]);

export const crmSyncCursors = mysqlTable("crmSyncCursors", {
  id: int("id").autoincrement().primaryKey(),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  resourceType: varchar("resourceType", { length: 80 }).notNull(),
  cursor: text("cursor"),
  sourceCheckpoint: varchar("sourceCheckpoint", { length: 255 }),
  lastSuccessfulAt: timestamp("lastSuccessfulAt"),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("crm_sync_cursors_system_resource_unique").on(table.connectedSystemId, table.resourceType)]);

export const salesActivityEvents = mysqlTable("salesActivityEvents", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  connectedSystemId: int("connectedSystemId").references(() => connectedSystems.id, { onDelete: "set null" }),
  salespersonUserId: int("salespersonUserId").references(() => users.id, { onDelete: "set null" }),
  externalOwnerId: varchar("externalOwnerId", { length: 180 }),
  contactExternalId: varchar("contactExternalId", { length: 180 }),
  opportunityExternalId: varchar("opportunityExternalId", { length: 180 }),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  source: varchar("source", { length: 80 }).notNull(),
  occurredAt: timestamp("occurredAt").notNull(),
  externalId: varchar("externalId", { length: 180 }),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  uniqueIndex("sales_activity_events_source_external_unique").on(table.connectedSystemId, table.externalId),
  index("sales_activity_events_org_user_occurred_idx").on(table.organisationId, table.salespersonUserId, table.occurredAt),
]);

export const connectorVerificationRuns = mysqlTable("connectorVerificationRuns", {
  id: int("id").autoincrement().primaryKey(),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  correlationId: varchar("correlationId", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["testing", "ready", "limited", "failed"]).notNull(),
  capabilities: json("capabilities").$type<Record<string, boolean>>().notNull(),
  summary: text("summary").notNull(),
  evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("connector_verification_system_created_idx").on(table.connectedSystemId, table.createdAt)]);

export const crmOAuthStates = mysqlTable("crmOAuthStates", {
  id: int("id").autoincrement().primaryKey(),
  connectedSystemId: int("connectedSystemId").notNull().references(() => connectedSystems.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  nonce: varchar("nonce", { length: 160 }).notNull().unique(),
  redirectUri: varchar("redirectUri", { length: 1024 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("crm_oauth_states_system_expiry_idx").on(table.connectedSystemId, table.expiresAt)]);

export const sidecarSessions = mysqlTable("sidecarSessions", {
  id: int("id").autoincrement().primaryKey(),
  organisationId: int("organisationId").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("sidecar_sessions_org_user_expiry_idx").on(table.organisationId, table.userId, table.expiresAt)]);

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
