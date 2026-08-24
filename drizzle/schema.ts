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
  isPlatformOwner: boolean("isPlatformOwner").default(false).notNull(),
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
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    provider: mysqlEnum("provider", ["genie", "outlook", "genx"]).notNull(),
    displayName: varchar("displayName", { length: 140 }).notNull(),
    status: mysqlEnum("status", [
      "needs_credentials",
      "ready",
      "paused",
      "error",
    ])
      .default("needs_credentials")
      .notNull(),
    scopeSummary: text("scopeSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("integrationProfiles_user_provider_idx").on(
      table.userId,
      table.provider
    ),
    index("integrationProfiles_org_provider_idx").on(
      table.organisationId,
      table.provider
    ),
  ]
);

/**
 * Immutable record of an assistant instruction and the safe, review-first
 * action plan produced from it. External actions are never performed here.
 */
export const companyProfiles = mysqlTable(
  "companyProfiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    companyName: varchar("companyName", { length: 220 }).notNull(),
    websiteUrl: varchar("websiteUrl", { length: 1024 }),
    industry: varchar("industry", { length: 180 }),
    companySize: varchar("companySize", { length: 80 }),
    primaryMarket: varchar("primaryMarket", { length: 220 }),
    salesMotion: varchar("salesMotion", { length: 180 }),
    productsServices: text("productsServices"),
    typicalCustomer: text("typicalCustomer"),
    primarySalesObjective: varchar("primarySalesObjective", { length: 500 }),
    brandVoice: text("brandVoice"),
    discoveryStatus: mysqlEnum("discoveryStatus", [
      "not_started",
      "review_required",
      "confirmed",
      "failed",
    ])
      .default("not_started")
      .notNull(),
    confirmedAt: timestamp("confirmedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("companyProfiles_organisation_user_unique").on(
      table.organisationId,
      table.userId
    ),
    index("companyProfiles_user_idx").on(table.userId),
    index("companyProfiles_org_idx").on(table.organisationId),
  ]
);

export const websiteDiscoveries = mysqlTable(
  "websiteDiscoveries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    companyProfileId: int("companyProfileId")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    sourceUrl: varchar("sourceUrl", { length: 1024 }).notNull(),
    pageTitle: varchar("pageTitle", { length: 500 }),
    extractedText: text("extractedText"),
    proposedFacts: json("proposedFacts")
      .$type<Record<string, unknown>>()
      .notNull(),
    proposedKnowledge: json("proposedKnowledge")
      .$type<Array<{ title: string; content: string; sourceUrl?: string; fetchedAt?: string; category?: string }>>()
      .notNull(),
    status: mysqlEnum("status", [
      "review_required",
      "confirmed",
      "rejected",
      "failed",
    ])
      .default("review_required")
      .notNull(),
    reviewedAt: timestamp("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("websiteDiscoveries_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    index("websiteDiscoveries_org_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
  ]
);

export const crmConnections = mysqlTable(
  "crmConnections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    provider: mysqlEnum("provider", [
      "genie",
      "hubspot",
      "salesforce",
      "pipedrive",
      "custom_browser",
    ]).notNull(),
    displayName: varchar("displayName", { length: 180 }).notNull(),
    status: mysqlEnum("status", [
      "draft",
      "needs_credentials",
      "ready",
      "paused",
      "error",
    ])
      .default("draft")
      .notNull(),
    capabilities: json("capabilities")
      .$type<
        Array<
          | "contacts"
          | "tasks"
          | "opportunities"
          | "notes"
          | "activities"
          | "email"
          | "calendar"
        >
      >()
      .notNull(),
    connectionMode: mysqlEnum("connectionMode", [
      "api",
      "browser_automation",
      "custom",
    ]).notNull(),
    configurationHint: text("configurationHint"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("crmConnections_user_provider_idx").on(table.userId, table.provider),
    index("crmConnections_org_provider_idx").on(
      table.organisationId,
      table.provider
    ),
  ]
);

export const automationPlaybooks = mysqlTable(
  "automationPlaybooks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    title: varchar("title", { length: 220 }).notNull(),
    trigger: varchar("trigger", { length: 160 }).notNull(),
    description: text("description").notNull(),
    agentKey: varchar("agentKey", { length: 80 }).notNull(),
    requiredCapabilities: json("requiredCapabilities")
      .$type<string[]>()
      .notNull(),
    reviewRequired: boolean("reviewRequired").default(true).notNull(),
    status: mysqlEnum("status", ["draft", "active", "paused"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("automationPlaybooks_user_status_idx").on(table.userId, table.status),
    index("automationPlaybooks_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

export const workflowRuns = mysqlTable(
  "workflowRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    workflowKey: varchar("workflowKey", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    status: mysqlEnum("status", [
      "prepared",
      "blocked",
      "approved",
      "completed",
      "failed",
    ])
      .default("prepared")
      .notNull(),
    input: json("input").$type<Record<string, unknown>>().notNull(),
    claimToken: varchar("claimToken", { length: 64 }),
    claimExpiresAt: timestamp("claimExpiresAt"),
    result: json("result").$type<Record<string, unknown>>(),
    verificationSummary: text("verificationSummary").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("workflowRuns_user_created_idx").on(table.userId, table.createdAt),
    index("workflowRuns_organisation_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
    uniqueIndex("workflowRuns_user_idempotency_uq").on(table.userId, table.idempotencyKey),
    index("workflowRuns_claim_expiry_idx").on(table.status, table.claimExpiresAt),
  ]
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
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    workflowRunId: int("workflowRunId")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    actionType: varchar("actionType", { length: 80 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    targetLabel: varchar("targetLabel", { length: 180 }).notNull(),
    state: mysqlEnum("state", [
      "review_required",
      "approved",
      "skipped",
      "executed",
      "blocked",
    ])
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
    index("actionProposals_organisation_state_idx").on(
      table.organisationId,
      table.state
    ),
    index("actionProposals_claim_expiry_idx").on(
      table.state,
      table.executionClaimedAt
    ),
    index("actionProposals_run_idx").on(table.workflowRunId),
    uniqueIndex("actionProposals_idempotency_uq").on(
      table.userId,
      table.idempotencyKey
    ),
  ]
);

/** User-managed favourites and tags for reviewable pitches, leads, and action proposals. */
export const workspaceSavedItems = mysqlTable(
  "workspaceSavedItems",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    targetType: mysqlEnum("targetType", [
      "action_proposal",
      "lead",
      "pitch",
    ]).notNull(),
    targetKey: varchar("targetKey", { length: 160 }).notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    tags: json("tags").$type<string[]>().notNull(),
    isFavorite: boolean("isFavorite").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("workspaceSavedItems_user_organisation_target_unique").on(
      table.userId,
      table.organisationId,
      table.targetType,
      table.targetKey
    ),
    index("workspaceSavedItems_organisation_updated_idx").on(
      table.organisationId,
      table.updatedAt
    ),
  ]
);

/**
 * Internal callback planning record. It mirrors planned tasks and deliberately
 * keeps external CRM task identifiers separate for a future verified connector.
 */
export const callbackTasks = mysqlTable(
  "callbackTasks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high"])
      .default("normal")
      .notNull(),
    state: mysqlEnum("state", ["open", "completed", "blocked"])
      .default("open")
      .notNull(),
    dueAt: timestamp("dueAt"),
    externalTaskId: varchar("externalTaskId", { length: 160 }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("callbackTasks_user_state_due_idx").on(
      table.userId,
      table.state,
      table.dueAt
    ),
    index("callbackTasks_organisation_state_due_idx").on(
      table.organisationId,
      table.state,
      table.dueAt
    ),
    uniqueIndex("callbackTasks_idempotency_uq").on(
      table.userId,
      table.idempotencyKey
    ),
  ]
);

/** Durable user-owned reminders shown in Today; CRM tasks remain in the normalized CRM tables. */
export const assistantReminders = mysqlTable(
  "assistantReminders",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactExternalId: varchar("contactExternalId", { length: 160 }),
    opportunityExternalId: varchar("opportunityExternalId", { length: 160 }),
    title: varchar("title", { length: 300 }).notNull(),
    details: text("details"),
    dueAt: timestamp("dueAt").notNull(),
    timezone: varchar("timezone", { length: 80 }).notNull(),
    status: mysqlEnum("status", ["open", "snoozed", "completed", "cancelled"])
      .default("open")
      .notNull(),
    source: mysqlEnum("source", ["manual", "assistant", "call_commitment", "crm", "inbound", "automation", "appointment"])
      .default("manual")
      .notNull(),
    sourceReference: varchar("sourceReference", { length: 220 }),
    snoozedUntil: timestamp("snoozedUntil"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("assistantReminders_org_user_status_due_idx").on(table.organisationId, table.userId, table.status, table.dueAt),
    index("assistantReminders_org_contact_idx").on(table.organisationId, table.contactExternalId),
    uniqueIndex("assistantReminders_org_source_ref_uq").on(table.organisationId, table.source, table.sourceReference),
  ]
);

/** Structured assistant memory with explicit provenance and trust; AI inference is never confirmed implicitly. */
export const assistantMemories = mysqlTable(
  "assistantMemories",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactExternalId: varchar("contactExternalId", { length: 160 }),
    opportunityExternalId: varchar("opportunityExternalId", { length: 160 }),
    memoryType: mysqlEnum("memoryType", ["user_preference", "customer_fact", "commitment", "conversation_reference"]).notNull(),
    subject: varchar("subject", { length: 220 }).notNull(),
    content: text("content").notNull(),
    provenance: mysqlEnum("provenance", ["user_asserted", "crm", "call", "message", "approved_ai_extraction"]).notNull(),
    trust: mysqlEnum("trust", ["confirmed", "user_asserted", "inferred"]).notNull(),
    sourceReference: varchar("sourceReference", { length: 220 }),
    status: mysqlEnum("status", ["active", "superseded", "removed"])
      .default("active")
      .notNull(),
    occurredAt: timestamp("occurredAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("assistantMemories_org_user_type_idx").on(table.organisationId, table.userId, table.memoryType),
    index("assistantMemories_org_contact_idx").on(table.organisationId, table.contactExternalId),
    uniqueIndex("assistantMemories_org_provenance_ref_uq").on(table.organisationId, table.provenance, table.sourceReference),
  ]
);

/**
 * Stores a call transcript or a user-authored live-call note, plus the
 * coach-facing summary generated by the configured model provider.
 */
export const callSessions = mysqlTable(
  "callSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    leadLabel: varchar("leadLabel", { length: 160 }).notNull(),
    status: mysqlEnum("status", [
      "in_progress",
      "ready_for_review",
      "completed",
    ])
      .default("ready_for_review")
      .notNull(),
    audioKey: varchar("audioKey", { length: 512 }),
    transcript: text("transcript"),
    coachNotes: text("coachNotes"),
    summary: text("summary"),
    crmContext: json("crmContext").$type<Record<string, unknown>>(),
    structuredOutcome:
      json("structuredOutcome").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("callSessions_user_created_idx").on(table.userId, table.createdAt),
    index("callSessions_organisation_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
  ]
);

/** Course, programme, and policy content used by the knowledge agent. */
export const knowledgeSources = mysqlTable(
  "knowledgeSources",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 220 }).notNull(),
    sourceType: mysqlEnum("sourceType", ["note", "url", "document"])
      .default("note")
      .notNull(),
    sourceUrl: varchar("sourceUrl", { length: 1024 }),
    sourceFetchedAt: timestamp("sourceFetchedAt"),
    sourceMetadata: json("sourceMetadata").$type<Record<string, unknown>>(),
    content: text("content"),
    status: mysqlEnum("status", ["draft", "ready", "needs_review"])
      .default("draft")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("knowledgeSources_user_status_idx").on(table.userId, table.status),
    index("knowledgeSources_organisation_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

/** Append-only user-visible operational audit trail. */
export const auditEntries = mysqlTable(
  "auditEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    entityType: varchar("entityType", { length: 100 }).notNull(),
    entityId: varchar("entityId", { length: 100 }),
    summary: text("summary").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("auditEntries_user_created_idx").on(table.userId, table.createdAt),
    index("auditEntries_organisation_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
  ]
);

/** Short-lived, hashed email verification challenges for app-level second-factor checks. */
export const twoFactorChallenges = mysqlTable(
  "twoFactorChallenges",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: mysqlEnum("purpose", ["workspace_access"])
      .default("workspace_access")
      .notNull(),
    codeHash: varchar("codeHash", { length: 128 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("twoFactorChallenges_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
  ]
);

/** A user-owned daily digest configuration and the task UID that owns its cron lifecycle. */
export const dailyReports = mysqlTable(
  "dailyReports",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
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
    index("dailyReports_organisation_enabled_idx").on(
      table.organisationId,
      table.isEnabled
    ),
    uniqueIndex("dailyReports_task_uid_uq").on(table.scheduleCronTaskUid),
  ]
);

/**
 * Organisation-scoped foundations for the universal sales operating layer.
 * Legacy user-owned records remain intact while new shared CRM data belongs to
 * an organisation and may be safely used by several mapped salespeople.
 */
export const organisations = mysqlTable(
  "organisations",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 220 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    timezone: varchar("timezone", { length: 80 }).notNull().default("UTC"),
    locale: varchar("locale", { length: 24 }).notNull().default("en"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    settings: json("settings").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("organisations_owner_idx").on(table.ownerUserId)]
);

export const organisationMembers = mysqlTable(
  "organisationMembers",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", ["owner", "manager", "salesperson", "auditor"])
      .notNull()
      .default("salesperson"),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("organisation_members_unique").on(
      table.organisationId,
      table.userId
    ),
    index("organisation_members_user_idx").on(table.userId, table.isActive),
  ]
);

export const connectedSystems = mysqlTable(
  "connectedSystems",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", [
      "genie",
      "hubspot",
      "salesforce",
      "pipedrive",
      "zoho",
      "custom_browser",
      "custom_api",
      "csv_import",
    ]).notNull(),
    displayName: varchar("displayName", { length: 180 }).notNull(),
    baseUrl: varchar("baseUrl", { length: 1024 }),
    connectionMethod: mysqlEnum("connectionMethod", [
      "oauth",
      "browser",
      "sidecar",
      "custom_adapter",
      "import",
    ]).notNull(),
    status: mysqlEnum("status", [
      "connecting",
      "testing",
      "ready",
      "needs_attention",
      "authentication_expired",
      "limited_permissions",
      "paused",
      "disconnected",
      "error",
    ])
      .notNull()
      .default("disconnected"),
    allowedReadCapabilities: json("allowedReadCapabilities")
      .$type<string[]>()
      .notNull(),
    allowedWriteCapabilities: json("allowedWriteCapabilities")
      .$type<string[]>()
      .notNull(),
    verifiedCapabilities: json("verifiedCapabilities")
      .$type<string[]>()
      .notNull(),
    accountExternalId: varchar("accountExternalId", { length: 180 }),
    scopes: json("scopes").$type<string[]>().notNull(),
    configuration: json("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),
    lastHealthCheckAt: timestamp("lastHealthCheckAt"),
    lastHealthSummary: text("lastHealthSummary"),
    readyAt: timestamp("readyAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("connected_systems_org_status_idx").on(
      table.organisationId,
      table.status
    ),
    index("connected_systems_org_provider_idx").on(
      table.organisationId,
      table.provider
    ),
  ]
);

/** Encrypted material only: values never leave the server in API responses or audit records. */
export const connectionSecrets = mysqlTable(
  "connectionSecrets",
  {
    id: int("id").autoincrement().primaryKey(),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    secretKind: varchar("secretKind", { length: 80 }).notNull(),
    keyVersion: varchar("keyVersion", { length: 64 }).notNull(),
    iv: varchar("iv", { length: 128 }).notNull(),
    authTag: varchar("authTag", { length: 128 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("connection_secrets_system_kind_unique").on(
      table.connectedSystemId,
      table.secretKind
    ),
  ]
);

export const authorisedDomains = mysqlTable(
  "authorisedDomains",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 253 }).notNull(),
    allowedPaths: json("allowedPaths").$type<string[]>().notNull(),
    status: mysqlEnum("status", ["pending", "verified", "paused", "revoked"])
      .notNull()
      .default("pending"),
    verifiedAt: timestamp("verifiedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("authorised_domains_system_host_unique").on(
      table.connectedSystemId,
      table.hostname
    ),
    index("authorised_domains_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

export const externalUserMappings = mysqlTable(
  "externalUserMappings",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    externalUserId: varchar("externalUserId", { length: 180 }).notNull(),
    displayName: varchar("displayName", { length: 220 }).notNull(),
    email: varchar("email", { length: 320 }),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("external_user_mapping_system_external_unique").on(
      table.connectedSystemId,
      table.externalUserId
    ),
    index("external_user_mapping_org_user_idx").on(
      table.organisationId,
      table.userId
    ),
  ]
);

/** Explicit CRM pipeline/stage interpretation set by a manager after connector verification. */
export const crmPipelineStageMappings = mysqlTable(
  "crmPipelineStageMappings",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    externalPipelineId: varchar("externalPipelineId", {
      length: 180,
    }).notNull(),
    externalStageId: varchar("externalStageId", { length: 180 }).notNull(),
    pipelineLabel: varchar("pipelineLabel", { length: 220 }).notNull(),
    stageLabel: varchar("stageLabel", { length: 220 }).notNull(),
    category: mysqlEnum("category", [
      "open",
      "qualified",
      "proposal",
      "won",
      "lost",
      "other",
    ])
      .notNull()
      .default("other"),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("crm_pipeline_stage_mapping_system_stage_unique").on(
      table.connectedSystemId,
      table.externalStageId
    ),
    index("crm_pipeline_stage_mapping_org_category_idx").on(
      table.organisationId,
      table.category,
      table.isActive
    ),
  ]
);

export const crmCompanies = mysqlTable(
  "crmCompanies",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    externalId: varchar("externalId", { length: 180 }).notNull(),
    name: varchar("name", { length: 320 }).notNull(),
    website: varchar("website", { length: 1024 }),
    ownerExternalId: varchar("ownerExternalId", { length: 180 }),
    sourceUpdatedAt: timestamp("sourceUpdatedAt"),
    sourceRevision: varchar("sourceRevision", { length: 180 }),
    raw: json("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("crm_companies_system_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("crm_companies_org_owner_idx").on(
      table.organisationId,
      table.ownerExternalId
    ),
  ]
);

export const crmContacts = mysqlTable(
  "crmContacts",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    externalId: varchar("externalId", { length: 180 }).notNull(),
    companyExternalId: varchar("companyExternalId", { length: 180 }),
    ownerExternalId: varchar("ownerExternalId", { length: 180 }),
    firstName: varchar("firstName", { length: 160 }),
    lastName: varchar("lastName", { length: 160 }),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 80 }),
    normalizedEmail: varchar("normalizedEmail", { length: 320 }),
    normalizedPhone: varchar("normalizedPhone", { length: 80 }),
    lifecycleStage: varchar("lifecycleStage", { length: 120 }),
    sourceUpdatedAt: timestamp("sourceUpdatedAt"),
    sourceRevision: varchar("sourceRevision", { length: 180 }),
    raw: json("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("crm_contacts_system_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("crm_contacts_org_owner_idx").on(
      table.organisationId,
      table.ownerExternalId
    ),
    index("crm_contacts_org_email_idx").on(table.organisationId, table.email),
    index("crm_contacts_org_normalized_email_idx").on(
      table.organisationId,
      table.normalizedEmail
    ),
    index("crm_contacts_org_normalized_phone_idx").on(
      table.organisationId,
      table.normalizedPhone
    ),
  ]
);

export const crmOpportunities = mysqlTable(
  "crmOpportunities",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
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
  },
  table => [
    uniqueIndex("crm_opportunities_system_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("crm_opportunities_org_owner_stage_idx").on(
      table.organisationId,
      table.ownerExternalId,
      table.stage
    ),
    index("crm_opportunities_org_activity_idx").on(
      table.organisationId,
      table.lastActivityAt
    ),
  ]
);

export const crmTasks = mysqlTable(
  "crmTasks",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
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
  },
  table => [
    uniqueIndex("crm_tasks_system_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("crm_tasks_org_owner_due_idx").on(
      table.organisationId,
      table.ownerExternalId,
      table.dueAt
    ),
  ]
);

export const crmActivities = mysqlTable(
  "crmActivities",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
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
  },
  table => [
    uniqueIndex("crm_activities_system_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("crm_activities_org_owner_occurred_idx").on(
      table.organisationId,
      table.ownerExternalId,
      table.occurredAt
    ),
  ]
);

export const crmSyncCursors = mysqlTable(
  "crmSyncCursors",
  {
    id: int("id").autoincrement().primaryKey(),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    resourceType: varchar("resourceType", { length: 80 }).notNull(),
    cursor: text("cursor"),
    sourceCheckpoint: varchar("sourceCheckpoint", { length: 255 }),
    lastSuccessfulAt: timestamp("lastSuccessfulAt"),
    lastError: text("lastError"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("crm_sync_cursors_system_resource_unique").on(
      table.connectedSystemId,
      table.resourceType
    ),
  ]
);

export const salesActivityEvents = mysqlTable(
  "salesActivityEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId").references(
      () => connectedSystems.id,
      { onDelete: "set null" }
    ),
    salespersonUserId: int("salespersonUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    externalOwnerId: varchar("externalOwnerId", { length: 180 }),
    contactExternalId: varchar("contactExternalId", { length: 180 }),
    opportunityExternalId: varchar("opportunityExternalId", { length: 180 }),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    source: varchar("source", { length: 80 }).notNull(),
    occurredAt: timestamp("occurredAt").notNull(),
    externalId: varchar("externalId", { length: 180 }),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("sales_activity_events_source_external_unique").on(
      table.connectedSystemId,
      table.externalId
    ),
    index("sales_activity_events_org_user_occurred_idx").on(
      table.organisationId,
      table.salespersonUserId,
      table.occurredAt
    ),
  ]
);

export const connectorVerificationRuns = mysqlTable(
  "connectorVerificationRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    correlationId: varchar("correlationId", { length: 80 }).notNull(),
    status: mysqlEnum("status", [
      "testing",
      "ready",
      "limited",
      "failed",
    ]).notNull(),
    capabilities: json("capabilities")
      .$type<Record<string, boolean>>()
      .notNull(),
    summary: text("summary").notNull(),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("connector_verification_system_created_idx").on(
      table.connectedSystemId,
      table.createdAt
    ),
  ]
);

/** Durable, resumable orchestration for automatic CRM commissioning. */
export const crmCommissioningJobs = mysqlTable(
  "crmCommissioningJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    requestedByUserId: int("requestedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    connectorClass: mysqlEnum("connectorClass", [
      "native_api",
      "known_browser",
      "unknown_browser",
    ]).notNull(),
    state: mysqlEnum("state", [
      "AUTHENTICATE",
      "DISCOVER_NAVIGATION",
      "DISCOVER_CAPABILITIES",
      "TEST_SAFE_READS",
      "AWAIT_SAFE_TEST_RECORD",
      "TEST_CONTROLLED_WRITES",
      "VERIFY_READBACK",
      "PUBLISH_PROVEN_OPERATIONS",
      "READY",
    ]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "running",
      "waiting_for_approval",
      "ready",
      "needs_attention",
      "failed",
      "cancelled",
    ]).notNull().default("queued"),
    progress: json("progress").$type<Record<string, unknown>>().notNull(),
    safeTestRecord: json("safeTestRecord").$type<Record<string, unknown>>(),
    discoveredOperationKeys: json("discoveredOperationKeys")
      .$type<string[]>()
      .notNull(),
    optionalFailures: json("optionalFailures")
      .$type<Record<string, string>>()
      .notNull(),
    attempt: int("attempt").notNull().default(0),
    cancelRequested: boolean("cancelRequested").notNull().default(false),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    lastError: text("lastError"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("crm_commissioning_system_unique").on(table.connectedSystemId),
    index("crm_commissioning_org_status_idx").on(
      table.organisationId,
      table.status
    ),
    index("crm_commissioning_status_lease_idx").on(
      table.status,
      table.leaseExpiresAt
    ),
  ]
);

/**
 * Versioned, organisation-scoped deterministic browser operations learned
 * through Teach Amarktai. Definitions never contain credentials or captured
 * customer values; runtime writes may use only a LIVE_PROVEN version.
 */
export const browserLearnedOperations = mysqlTable(
  "browserLearnedOperations",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    operationKey: varchar("operationKey", { length: 120 }).notNull(),
    version: int("version").notNull(),
    status: mysqlEnum("status", [
      "NOT_LEARNED",
      "LEARNED",
      "TEST_READY",
      "LIVE_PROVEN",
      "DEGRADED",
      "BLOCKED",
    ])
      .notNull()
      .default("LEARNED"),
    definition: json("definition").$type<Record<string, unknown>>().notNull(),
    prerequisites: json("prerequisites")
      .$type<Record<string, unknown>>()
      .notNull(),
    targetAssertions: json("targetAssertions")
      .$type<Record<string, unknown>>()
      .notNull(),
    postconditionAssertions: json("postconditionAssertions")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    lastTestAt: timestamp("lastTestAt"),
    lastSuccessAt: timestamp("lastSuccessAt"),
    lastFailureAt: timestamp("lastFailureAt"),
    lastError: text("lastError"),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: int("publishedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("browser_learned_operation_system_key_version_unique").on(
      table.connectedSystemId,
      table.operationKey,
      table.version
    ),
    index("browser_learned_operation_org_system_status_idx").on(
      table.organisationId,
      table.connectedSystemId,
      table.status
    ),
  ]
);

/** Short-lived manager training capture bound to one organisation and system. */
export const browserTrainingSessions = mysqlTable(
  "browserTrainingSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationKey: varchar("operationKey", { length: 120 }).notNull(),
    status: mysqlEnum("status", [
      "capturing",
      "submitted",
      "cancelled",
      "expired",
    ])
      .notNull()
      .default("capturing"),
    capture: json("capture").$type<Array<Record<string, unknown>>>().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("browser_training_session_scope_idx").on(
      table.organisationId,
      table.connectedSystemId,
      table.userId,
      table.status
    ),
  ]
);

export const crmOAuthStates = mysqlTable(
  "crmOAuthStates",
  {
    id: int("id").autoincrement().primaryKey(),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nonce: varchar("nonce", { length: 160 }).notNull().unique(),
    redirectUri: varchar("redirectUri", { length: 1024 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("crm_oauth_states_system_expiry_idx").on(
      table.connectedSystemId,
      table.expiresAt
    ),
  ]
);

export const sidecarSessions = mysqlTable(
  "sidecarSessions",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("sidecar_sessions_org_user_expiry_idx").on(
      table.organisationId,
      table.userId,
      table.expiresAt
    ),
  ]
);

/** Manager-owned privacy, retention, and outbound-consent policy for an organisation. */
export const organisationCompliancePolicies = mysqlTable(
  "organisationCompliancePolicies",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    transcriptRetentionDays: int("transcriptRetentionDays")
      .notNull()
      .default(90),
    auditRetentionDays: int("auditRetentionDays").notNull().default(365),
    operationalRetentionDays: int("operationalRetentionDays")
      .notNull()
      .default(365),
    outboundConsentRequired: boolean("outboundConsentRequired")
      .notNull()
      .default(true),
    deletionApprovalRequired: boolean("deletionApprovalRequired")
      .notNull()
      .default(true),
    policyText: text("policyText"),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: int("updatedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("organisation_compliance_policy_unique").on(
      table.organisationId
    ),
  ]
);

/** A tracked export or deletion request; destructive execution remains review-first. */
export const dataSubjectRequests = mysqlTable(
  "dataSubjectRequests",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    requestedByUserId: int("requestedByUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestType: mysqlEnum("requestType", ["export", "deletion"]).notNull(),
    subjectType: mysqlEnum("subjectType", [
      "contact",
      "company",
      "user",
      "operational_record",
    ]).notNull(),
    subjectReference: varchar("subjectReference", { length: 220 }).notNull(),
    reason: text("reason"),
    status: mysqlEnum("status", [
      "review_required",
      "approved",
      "rejected",
      "completed",
      "failed",
    ])
      .notNull()
      .default("review_required"),
    reviewedByUserId: int("reviewedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewedAt"),
    executionSummary: text("executionSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("data_subject_requests_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

/** Structured application, worker, connector, backup, and deployment events for operational alerting. */
export const operationalEvents = mysqlTable(
  "operationalEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    connectedSystemId: int("connectedSystemId").references(
      () => connectedSystems.id,
      { onDelete: "set null" }
    ),
    severity: mysqlEnum("severity", ["info", "warning", "error", "critical"])
      .notNull()
      .default("info"),
    category: varchar("category", { length: 100 }).notNull(),
    eventKey: varchar("eventKey", { length: 180 }).notNull(),
    summary: text("summary").notNull(),
    detail: json("detail").$type<Record<string, unknown>>().notNull(),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("operational_events_org_severity_created_idx").on(
      table.organisationId,
      table.severity,
      table.createdAt
    ),
    index("operational_events_connector_created_idx").on(
      table.connectedSystemId,
      table.createdAt
    ),
  ]
);

/** Provider-neutral enterprise identity configuration; encrypted credentials remain in connectionSecrets. */
export const enterpriseIdentityConnections = mysqlTable(
  "enterpriseIdentityConnections",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    protocol: mysqlEnum("protocol", ["saml", "scim"]).notNull(),
    displayName: varchar("displayName", { length: 180 }).notNull(),
    status: mysqlEnum("status", [
      "draft",
      "testing",
      "ready",
      "paused",
      "error",
    ])
      .notNull()
      .default("draft"),
    configuration: json("configuration")
      .$type<Record<string, unknown>>()
      .notNull(),
    verifiedAt: timestamp("verifiedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("enterprise_identity_org_protocol_unique").on(
      table.organisationId,
      table.protocol
    ),
  ]
);

/** Durable organisation entitlement state; a payment provider is never active without a verified connection. */
export const organisationEntitlements = mysqlTable(
  "organisationEntitlements",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    planKey: varchar("planKey", { length: 80 })
      .notNull()
      .default("self_hosted"),
    status: mysqlEnum("status", ["active", "trial", "suspended", "cancelled"])
      .notNull()
      .default("active"),
    featureFlags: json("featureFlags")
      .$type<Record<string, boolean>>()
      .notNull(),
    limits: json("limits").$type<Record<string, number>>().notNull(),
    providerReference: varchar("providerReference", { length: 180 }),
    currentPeriodEndsAt: timestamp("currentPeriodEndsAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("organisation_entitlements_unique").on(table.organisationId),
  ]
);

/** Immutable manager-authored revisions; only one published revision may be selected by a workflow at runtime. */
export const playbookVersions = mysqlTable(
  "playbookVersions",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    playbookKey: varchar("playbookKey", { length: 140 }).notNull(),
    version: int("version").notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    instructions: text("instructions").notNull(),
    inputSchema: json("inputSchema").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", ["draft", "published", "archived"])
      .notNull()
      .default("draft"),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: int("publishedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("publishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("playbook_versions_org_key_version_unique").on(
      table.organisationId,
      table.playbookKey,
      table.version
    ),
    index("playbook_versions_org_key_status_idx").on(
      table.organisationId,
      table.playbookKey,
      table.status
    ),
  ]
);

/** Review language is versioned separately so policy/legal changes do not alter historical approvals. */
export const approvalTemplates = mysqlTable(
  "approvalTemplates",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    templateKey: varchar("templateKey", { length: 140 }).notNull(),
    version: int("version").notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    body: text("body").notNull(),
    status: mysqlEnum("status", ["draft", "published", "archived"])
      .notNull()
      .default("draft"),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: int("publishedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("publishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("approval_templates_org_key_version_unique").on(
      table.organisationId,
      table.templateKey,
      table.version
    ),
    index("approval_templates_org_key_status_idx").on(
      table.organisationId,
      table.templateKey,
      table.status
    ),
  ]
);

/** Runtime execution evidence binds a workflow run to exact approved playbook/template revisions. */
export const playbookExecutionHistory = mysqlTable(
  "playbookExecutionHistory",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    playbookVersionId: int("playbookVersionId")
      .notNull()
      .references(() => playbookVersions.id, { onDelete: "restrict" }),
    approvalTemplateId: int("approvalTemplateId").references(
      () => approvalTemplates.id,
      { onDelete: "set null" }
    ),
    workflowRunId: int("workflowRunId").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    actionProposalId: int("actionProposalId").references(
      () => actionProposals.id,
      { onDelete: "set null" }
    ),
    status: mysqlEnum("status", [
      "prepared",
      "reviewed",
      "approved",
      "executed",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("prepared"),
    inputSnapshot: json("inputSnapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSummary: text("outputSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [
    index("playbook_execution_org_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
    index("playbook_execution_workflow_idx").on(table.workflowRunId),
  ]
);

/** A scheduled connector job remains disabled until its connected system is backend-verified for the specified capability. */
export const connectorSyncJobs = mysqlTable(
  "connectorSyncJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    resourceType: varchar("resourceType", { length: 80 }).notNull(),
    scheduleExpression: varchar("scheduleExpression", {
      length: 120,
    }).notNull(),
    status: mysqlEnum("status", [
      "draft",
      "ready",
      "paused",
      "running",
      "error",
    ])
      .notNull()
      .default("draft"),
    capabilityKey: varchar("capabilityKey", { length: 120 }).notNull(),
    lastStartedAt: timestamp("lastStartedAt"),
    lastSucceededAt: timestamp("lastSucceededAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("connector_sync_jobs_system_resource_unique").on(
      table.connectedSystemId,
      table.resourceType
    ),
    index("connector_sync_jobs_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

/** Webhook payloads are retained as receipt metadata; unsigned or duplicate payloads never trigger CRM mutations. */
export const connectorWebhookReceipts = mysqlTable(
  "connectorWebhookReceipts",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId")
      .notNull()
      .references(() => connectedSystems.id, { onDelete: "cascade" }),
    eventId: varchar("eventId", { length: 220 }).notNull(),
    eventType: varchar("eventType", { length: 160 }).notNull(),
    signatureStatus: mysqlEnum("signatureStatus", [
      "verified",
      "missing",
      "invalid",
      "not_configured",
    ]).notNull(),
    processingStatus: mysqlEnum("processingStatus", [
      "received",
      "processed",
      "retrying",
      "dead_letter",
      "ignored",
    ])
      .notNull()
      .default("received"),
    attempts: int("attempts").notNull().default(0),
    payloadHash: varchar("payloadHash", { length: 128 }).notNull(),
    lastError: text("lastError"),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    processedAt: timestamp("processedAt"),
  },
  table => [
    uniqueIndex("connector_webhook_system_event_unique").on(
      table.connectedSystemId,
      table.eventId
    ),
    index("connector_webhook_org_status_received_idx").on(
      table.organisationId,
      table.processingStatus,
      table.receivedAt
    ),
  ]
);

export const operationalAlertRules = mysqlTable(
  "operationalAlertRules",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    severityThreshold: mysqlEnum("severityThreshold", [
      "warning",
      "error",
      "critical",
    ])
      .notNull()
      .default("error"),
    category: varchar("category", { length: 100 }),
    deliveryChannel: mysqlEnum("deliveryChannel", [
      "email",
      "webhook",
    ]).notNull(),
    destination: varchar("destination", { length: 1_000 }).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("operational_alert_rules_org_active_idx").on(
      table.organisationId,
      table.isActive
    ),
  ]
);

export const operationalAlertDeliveries = mysqlTable(
  "operationalAlertDeliveries",
  {
    id: int("id").autoincrement().primaryKey(),
    operationalEventId: int("operationalEventId")
      .notNull()
      .references(() => operationalEvents.id, { onDelete: "cascade" }),
    alertRuleId: int("alertRuleId")
      .notNull()
      .references(() => operationalAlertRules.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", [
      "pending",
      "delivered",
      "failed",
      "suppressed",
    ])
      .notNull()
      .default("pending"),
    attempts: int("attempts").notNull().default(0),
    deliveredAt: timestamp("deliveredAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("operational_alert_delivery_event_rule_unique").on(
      table.operationalEventId,
      table.alertRuleId
    ),
    index("operational_alert_delivery_status_idx").on(
      table.status,
      table.createdAt
    ),
  ]
);

export const operationalWorkerRuns = mysqlTable(
  "operationalWorkerRuns",
  {
    id: int("id").autoincrement().primaryKey(),
    workerKey: varchar("workerKey", { length: 140 }).notNull(),
    organisationId: int("organisationId").references(() => organisations.id, {
      onDelete: "set null",
    }),
    status: mysqlEnum("status", ["started", "succeeded", "failed"]).notNull(),
    summary: text("summary").notNull(),
    detail: json("detail").$type<Record<string, unknown>>().notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    finishedAt: timestamp("finishedAt"),
  },
  table => [
    index("operational_worker_runs_key_started_idx").on(
      table.workerKey,
      table.startedAt
    ),
  ]
);

export const inboundMessages = mysqlTable(
  "inboundMessages",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId").references(
      () => connectedSystems.id,
      { onDelete: "set null" }
    ),
    externalMessageId: varchar("externalMessageId", { length: 220 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 64 }),
    channel: mysqlEnum("channel", ["email", "sms", "chat", "other"]).notNull(),
    senderReference: varchar("senderReference", { length: 320 }).notNull(),
    contactExternalId: varchar("contactExternalId", { length: 180 }),
    subject: varchar("subject", { length: 500 }),
    body: text("body").notNull(),
    classification: json("classification").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "received",
      "classified",
      "draft_ready",
      "archived",
    ])
      .notNull()
      .default("received"),
    needsAction: boolean("needsAction").notNull().default(false),
    receivedAt: timestamp("receivedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("inbound_messages_system_external_unique").on(
      table.connectedSystemId,
      table.externalMessageId
    ),
    uniqueIndex("inbound_messages_idempotency_unique").on(table.idempotencyKey),
    index("inbound_messages_org_status_received_idx").on(
      table.organisationId,
      table.status,
      table.receivedAt
    ),
    index("inbound_messages_org_action_received_idx").on(
      table.organisationId,
      table.needsAction,
      table.receivedAt
    ),
  ]
);

/** Durable, idempotent Microsoft Graph notification intake queue. */
export const outlookInboundQueue = mysqlTable(
  "outlookInboundQueue",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    messageId: varchar("messageId", { length: 512 }).notNull(),
    subscriptionId: varchar("subscriptionId", { length: 180 }),
    status: mysqlEnum("status", [
      "queued",
      "processing",
      "processed",
      "dead_letter",
    ])
      .default("queued")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
    claimedAt: timestamp("claimedAt"),
    processedAt: timestamp("processedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("outlook_inbound_queue_org_message_unique").on(
      table.organisationId,
      table.messageId
    ),
    index("outlook_inbound_queue_status_due_idx").on(
      table.status,
      table.nextAttemptAt
    ),
  ]
);

/** Fail-closed recipient suppression created by deterministic inbound opt-outs. */
export const contactCommunicationSuppressions = mysqlTable(
  "contactCommunicationSuppressions",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    connectedSystemId: int("connectedSystemId").references(
      () => connectedSystems.id,
      { onDelete: "set null" }
    ),
    channel: mysqlEnum("channel", ["email", "sms", "chat", "other"]).notNull(),
    senderReference: varchar("senderReference", { length: 320 }).notNull(),
    contactExternalId: varchar("contactExternalId", { length: 180 }),
    reason: varchar("reason", { length: 220 }).notNull(),
    sourceMessageId: int("sourceMessageId").references(
      () => inboundMessages.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex(
      "contact_communication_suppression_org_channel_sender_unique"
    ).on(table.organisationId, table.channel, table.senderReference),
    index("contact_communication_suppression_contact_idx").on(
      table.organisationId,
      table.contactExternalId
    ),
  ]
);

export const inboundReplyDrafts = mysqlTable(
  "inboundReplyDrafts",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    inboundMessageId: int("inboundMessageId")
      .notNull()
      .references(() => inboundMessages.id, { onDelete: "cascade" }),
    draftBody: text("draftBody").notNull(),
    rationale: text("rationale").notNull(),
    qualityChecks: json("qualityChecks")
      .$type<Record<string, boolean>>()
      .notNull(),
    status: mysqlEnum("status", [
      "draft",
      "approved",
      "rejected",
      "sent",
      "cancelled",
    ])
      .notNull()
      .default("draft"),
    approvedByUserId: int("approvedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approvedAt"),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("inbound_reply_drafts_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

export const qaRubrics = mysqlTable(
  "qaRubrics",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    criteria: json("criteria")
      .$type<Array<{ key: string; label: string; weight: number }>>()
      .notNull(),
    isActive: boolean("isActive").notNull().default(true),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("qa_rubrics_org_active_idx").on(table.organisationId, table.isActive),
  ]
);

export const qaScorecards = mysqlTable(
  "qaScorecards",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    rubricId: int("rubricId")
      .notNull()
      .references(() => qaRubrics.id, { onDelete: "restrict" }),
    reviewedUserId: int("reviewedUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerUserId: int("reviewerUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceType: mysqlEnum("sourceType", [
      "call",
      "message",
      "proposal",
      "workflow",
    ]).notNull(),
    sourceReference: varchar("sourceReference", { length: 220 }).notNull(),
    scores: json("scores").$type<Record<string, number>>().notNull(),
    totalScore: int("totalScore").notNull(),
    feedback: text("feedback"),
    status: mysqlEnum("status", ["draft", "calibrated", "shared"])
      .notNull()
      .default("draft"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("qa_scorecards_org_user_created_idx").on(
      table.organisationId,
      table.reviewedUserId,
      table.createdAt
    ),
  ]
);

export const coachingRecords = mysqlTable(
  "coachingRecords",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    scorecardId: int("scorecardId").references(() => qaScorecards.id, {
      onDelete: "set null",
    }),
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    coachUserId: int("coachUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    commitments: json("commitments").$type<string[]>().notNull(),
    followUpAt: timestamp("followUpAt"),
    status: mysqlEnum("status", ["open", "completed", "cancelled"])
      .notNull()
      .default("open"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("coaching_records_org_user_status_idx").on(
      table.organisationId,
      table.userId,
      table.status
    ),
  ]
);

export const salesTerritories = mysqlTable(
  "salesTerritories",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    definition: json("definition").$type<Record<string, unknown>>().notNull(),
    ownerUserId: int("ownerUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("sales_territories_org_name_unique").on(
      table.organisationId,
      table.name
    ),
  ]
);

export const quotaPlans = mysqlTable(
  "quotaPlans",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    territoryId: int("territoryId").references(() => salesTerritories.id, {
      onDelete: "set null",
    }),
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    periodStart: timestamp("periodStart").notNull(),
    periodEnd: timestamp("periodEnd").notNull(),
    targetValueMinor: int("targetValueMinor").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    capacityAssumption: json("capacityAssumption")
      .$type<Record<string, number>>()
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("quota_plans_org_period_idx").on(
      table.organisationId,
      table.periodStart,
      table.periodEnd
    ),
  ]
);

export const forecastSnapshots = mysqlTable(
  "forecastSnapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    quotaPlanId: int("quotaPlanId").references(() => quotaPlans.id, {
      onDelete: "set null",
    }),
    forecastValueMinor: int("forecastValueMinor").notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    confidence: int("confidence").notNull(),
    methodology: varchar("methodology", { length: 180 }).notNull(),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("forecast_snapshots_org_created_idx").on(
      table.organisationId,
      table.createdAt
    ),
  ]
);

export const ttsVoiceProfiles = mysqlTable(
  "ttsVoiceProfiles",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    displayName: varchar("displayName", { length: 180 }).notNull(),
    providerKey: varchar("providerKey", { length: 100 }).notNull(),
    voiceReference: varchar("voiceReference", { length: 180 }).notNull(),
    consentStatus: mysqlEnum("consentStatus", [
      "not_recorded",
      "recorded",
      "revoked",
    ])
      .notNull()
      .default("not_recorded"),
    isActive: boolean("isActive").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("tts_voice_profiles_org_voice_unique").on(
      table.organisationId,
      table.providerKey,
      table.voiceReference
    ),
  ]
);

export const ttsGenerationRequests = mysqlTable(
  "ttsGenerationRequests",
  {
    id: int("id").autoincrement().primaryKey(),
    organisationId: int("organisationId")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    voiceProfileId: int("voiceProfileId")
      .notNull()
      .references(() => ttsVoiceProfiles.id, { onDelete: "restrict" }),
    text: text("text").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "approved",
      "generated",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("draft"),
    approvedByUserId: int("approvedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    audioStorageKey: varchar("audioStorageKey", { length: 1_024 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    generatedAt: timestamp("generatedAt"),
  },
  table => [
    index("tts_generation_org_status_idx").on(
      table.organisationId,
      table.status
    ),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type IntegrationProfile = typeof integrationProfiles.$inferSelect;
export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type WebsiteDiscovery = typeof websiteDiscoveries.$inferSelect;
export type CrmConnection = typeof crmConnections.$inferSelect;
export type AutomationPlaybook = typeof automationPlaybooks.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type CrmCommissioningJob = typeof crmCommissioningJobs.$inferSelect;
export type ActionProposal = typeof actionProposals.$inferSelect;
export type CallbackTask = typeof callbackTasks.$inferSelect;
export type CallSession = typeof callSessions.$inferSelect;
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
