export const CRM_CAPABILITIES = [
  "contacts.read",
  "contacts.write",
  "companies.read",
  "companies.write",
  "opportunities.read",
  "opportunities.write",
  "tasks.read",
  "tasks.write",
  "activities.read",
  "activities.write",
  "notes.read",
  "notes.write",
  "owners.read",
  "pipelines.read",
  "email.send",
  "sms.send",
  "whatsapp.send",
  "sequences.apply",
] as const;

export type CrmCapability = (typeof CRM_CAPABILITIES)[number];
export type CrmProvider = "genie" | "hubspot" | "salesforce" | "pipedrive" | "zoho" | "custom_browser" | "custom_api" | "csv_import";
export type ConnectionStatus = "connecting" | "testing" | "ready" | "needs_attention" | "authentication_expired" | "limited_permissions" | "paused" | "disconnected" | "error";

export type AdapterConnection = {
  id: number;
  organisationId: number;
  provider: CrmProvider;
  displayName: string;
  baseUrl: string | null;
  connectionMethod: "oauth" | "browser" | "sidecar" | "custom_adapter" | "import";
  allowedReadCapabilities: string[];
  allowedWriteCapabilities: string[];
  verifiedCapabilities: string[];
  scopes: string[];
  configuration: Record<string, unknown>;
};

export type ConnectionSecretPayload = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  accountExternalId?: string;
  scopes?: string[];
  apiBaseUrl?: string;
  instanceUrl?: string;
  accountsUrl?: string;
  tokenType?: string;
  /** Encrypted at rest. Versioned, organisation/connection-scoped browser session package. */
  browserSession?: Record<string, unknown>;
  /** Backend-only owner tag for the manager session copied into company commissioning. */
  commissioningUserId?: number;
};

export type AdapterEvidence = {
  operation: string;
  completedAt: string;
  correlationId: string;
  providerResult?: Record<string, unknown>;
  screenshotPath?: string;
  errorClassification?: "authentication" | "permission" | "rate_limit" | "network" | "validation" | "unsupported" | "unknown";
  retryable?: boolean;
};

export type CapabilityResult = {
  capability: CrmCapability;
  available: boolean;
  detail: string;
};

export type ConnectionTest = {
  status: "ready" | "limited" | "failed";
  summary: string;
  capabilities: CapabilityResult[];
  evidence: AdapterEvidence[];
  accountExternalId?: string;
  scopes?: string[];
};

export type OutboundMessageInput = {
  connection: AdapterConnection;
  secret: ConnectionSecretPayload;
  to: string;
  subject?: string;
  body: string;
  contactExternalId?: string;
  opportunityExternalId?: string;
  templateName?: string;
  /** Exact organisation-approved sending number/identity where the CRM supports it. */
  senderIdentity?: string;
  /** Stable proposal-level key, distinct from the execution attempt correlation id. */
  idempotencyKey?: string;
  correlationId: string;
};

export type CrmAdapter = {
  provider: CrmProvider;
  createAuthorizationUrl?: (input: { connection: AdapterConnection; state: string; redirectUri: string }) => string;
  exchangeAuthorizationCode?: (input: { connection: AdapterConnection; code: string; redirectUri: string; callbackParams?: Record<string, string> }) => Promise<ConnectionSecretPayload>;
  disconnect: (input: { connection: AdapterConnection; secret?: ConnectionSecretPayload; correlationId: string }) => Promise<AdapterEvidence>;
  refreshAuthentication: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; correlationId: string }) => Promise<ConnectionSecretPayload>;
  testConnection: (input: { connection: AdapterConnection; secret?: ConnectionSecretPayload; correlationId: string }) => Promise<ConnectionTest>;
  discoverCapabilities: (input: { connection: AdapterConnection; secret?: ConnectionSecretPayload; correlationId: string }) => Promise<CapabilityResult[]>;
  syncContacts: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; cursor?: string }) => Promise<{ records: NormalizedContact[]; cursor?: string }>;
  syncCompanies: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; cursor?: string }) => Promise<{ records: NormalizedCompany[]; cursor?: string }>;
  syncOpportunities: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; cursor?: string }) => Promise<{ records: NormalizedOpportunity[]; cursor?: string }>;
  syncTasks: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; cursor?: string }) => Promise<{ records: NormalizedTask[]; cursor?: string }>;
  syncActivities: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; cursor?: string }) => Promise<{ records: NormalizedActivity[]; cursor?: string }>;
  searchContacts: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; query: string }) => Promise<NormalizedContact[]>;
  getContact: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string }) => Promise<NormalizedContact | null>;
  getCompany: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string }) => Promise<NormalizedCompany | null>;
  getOpportunity: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string }) => Promise<NormalizedOpportunity | null>;
  createContact?: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; fields: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  createCompany?: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; fields: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  createOpportunity?: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; fields: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  createNote: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string; body: string; correlationId: string }) => Promise<AdapterEvidence>;
  createTask: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; title: string; dueAt?: string; contactExternalId?: string; opportunityExternalId?: string; correlationId: string }) => Promise<AdapterEvidence>;
  completeTask: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string; correlationId: string }) => Promise<AdapterEvidence>;
  updateContact: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string; patch: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  updateOpportunity: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string; patch: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  createActivity: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; activity: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  sendEmail?: (input: OutboundMessageInput) => Promise<AdapterEvidence>;
  sendSms?: (input: OutboundMessageInput) => Promise<AdapterEvidence>;
  sendWhatsApp?: (input: OutboundMessageInput) => Promise<AdapterEvidence>;
  applySequence?: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; externalId: string; sequence: string; correlationId: string }) => Promise<AdapterEvidence>;
  executeCustomAction?: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload; actionName: string; payload: Record<string, unknown>; correlationId: string }) => Promise<AdapterEvidence>;
  listPipelines: (input: { connection: AdapterConnection; secret: ConnectionSecretPayload }) => Promise<Array<{ externalId: string; label: string; stages: Array<{ externalId: string; label: string }> }>>;
  healthCheck: (input: { connection: AdapterConnection; secret?: ConnectionSecretPayload; correlationId: string }) => Promise<ConnectionTest>;
};

export type NormalizedContact = { externalId: string; companyExternalId?: string; ownerExternalId?: string; firstName?: string; lastName?: string; email?: string; phone?: string; lifecycleStage?: string; sourceUpdatedAt?: Date; sourceRevision?: string; raw: Record<string, unknown> };
export type NormalizedCompany = { externalId: string; name: string; website?: string; ownerExternalId?: string; sourceUpdatedAt?: Date; sourceRevision?: string; raw: Record<string, unknown> };
export type NormalizedOpportunity = { externalId: string; companyExternalId?: string; contactExternalId?: string; ownerExternalId?: string; name: string; pipeline?: string; stage?: string; valueMinor?: number; currency?: string; closeAt?: Date; lastActivityAt?: Date; nextStepAt?: Date; sourceUpdatedAt?: Date; sourceRevision?: string; raw: Record<string, unknown> };
export type NormalizedTask = { externalId: string; contactExternalId?: string; opportunityExternalId?: string; ownerExternalId?: string; title: string; status: string; dueAt?: Date; completedAt?: Date; sourceUpdatedAt?: Date; sourceRevision?: string; raw: Record<string, unknown> };
export type NormalizedActivity = { externalId: string; contactExternalId?: string; opportunityExternalId?: string; ownerExternalId?: string; activityType: string; occurredAt: Date; body?: string; sourceRevision?: string; raw: Record<string, unknown> };
