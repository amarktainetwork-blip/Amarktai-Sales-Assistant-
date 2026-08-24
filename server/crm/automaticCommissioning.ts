import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  browserLearnedOperations,
  connectedSystems,
  crmCommissioningJobs,
  type CrmCommissioningJob,
} from "../../drizzle/schema";
import {
  inspectBrowserCrmNavigation,
  resolveBrowserProfile,
  testLearnedBrowserOperation,
  type BrowserDiscoveryControl,
} from "../browserConnectors/browserCrmAdapter";
import {
  BROWSER_OPERATION_CATALOGUE,
  ADAPTER_OPERATION_KEYS,
  operationChecksum,
  validateLearnedOperationDefinition,
  type BrowserOperationMode,
  type BrowserPostcondition,
} from "../browserConnectors/operationContracts";
import {
  browserOperationReadinessForSystem,
  latestBrowserOperation,
  saveLearnedBrowserOperation,
} from "../browserConnectors/learnedOperations";
import {
  loadConnectionSecret,
  recordConnectionVerification,
  toAdapterConnection,
} from "../connectedSystems";
import { getDb, recordAudit } from "../db";
import { getGenxReadiness, runGenxAgent } from "../genx";
import { getCrmAdapter } from "./adapterRegistry";
import type {
  AdapterConnection,
  ConnectionSecretPayload,
  CrmAdapter,
  NormalizedContact,
  NormalizedOpportunity,
  NormalizedTask,
} from "./types";

export const COMMISSIONING_STATES = [
  "AUTHENTICATE",
  "DISCOVER_NAVIGATION",
  "DISCOVER_CAPABILITIES",
  "TEST_SAFE_READS",
  "AWAIT_SAFE_TEST_RECORD",
  "TEST_CONTROLLED_WRITES",
  "VERIFY_READBACK",
  "PUBLISH_PROVEN_OPERATIONS",
  "READY",
] as const;
export type CommissioningState = (typeof COMMISSIONING_STATES)[number];

export type SafeTestRecord = {
  mode: "existing" | "temporary";
  reference: string;
  authorisedDestinations?: Partial<
    Record<"email" | "sms" | "whatsapp" | "dialler", string>
  >;
  authorisedOperationKeys?: string[];
  selectedOpportunityExternalId?: string;
  selectedTaskExternalId?: string;
};

export type SafeTestContext = SafeTestRecord & {
  contactExternalId: string;
  contactLabel: string;
  contactEmail?: string;
  contactPhone?: string;
  companyExternalId?: string;
  opportunityExternalId?: string;
  opportunityLabel?: string;
  taskExternalId?: string;
  taskLabel?: string;
  temporaryRecordCreated: boolean;
  temporaryRecordCleanup: "manager_remove" | "not_applicable";
};

type DiscoverySnapshot = {
  pageUrl: string;
  controls: BrowserDiscoveryControl[];
  readOnly: true;
};

const CORE_BROWSER_OPERATIONS = [
  "contact.search",
  "contact.read",
  "task.list",
  "note.create",
  "task.create_callback",
  "opportunity.read",
  "opportunity.update",
] as const;

const COMMUNICATION_OPERATIONS: Record<string, keyof NonNullable<SafeTestRecord["authorisedDestinations"]>> = {
  "email.send": "email",
  "sms.send": "sms",
  "whatsapp.send": "whatsapp",
  "dialler.launch": "dialler",
};

const discoveryMatchers: Array<{
  pattern: RegExp;
  operations: string[];
}> = [
  { pattern: /contact|customer|lead|prospect/, operations: ["contact.search", "contact.read", "contact.create", "contact.update"] },
  { pattern: /compan|account|organisation|organization/, operations: ["company.read", "company.create"] },
  { pattern: /task|manual action/, operations: ["task.list", "task.read", "task.create", "task.complete"] },
  { pattern: /callback|reminder/, operations: ["task.create_callback"] },
  { pattern: /note|history|timeline/, operations: ["note.read", "note.create", "history.read"] },
  { pattern: /opportunit|deal/, operations: ["opportunity.read", "opportunity.update", "opportunity.create"] },
  { pattern: /pipeline/, operations: ["pipeline.list"] },
  { pattern: /stage|status/, operations: ["stage.read", "stage.update"] },
  { pattern: /owner|assignee|salesperson/, operations: ["owner.sync", "owner.assign"] },
  { pattern: /activit|interaction/, operations: ["activity.sync", "activity.create"] },
  { pattern: /e-?mail/, operations: ["email.send"] },
  { pattern: /\bsms\b|text message/, operations: ["sms.send"] },
  { pattern: /whats\s?app/, operations: ["whatsapp.send"] },
  { pattern: /sequence|cadence/, operations: ["sequence.apply"] },
  { pattern: /call|dial|phone/, operations: ["dialler.launch"] },
  { pattern: /appointment|meeting|calendar/, operations: ["appointment.book"] },
  { pattern: /quote|proposal/, operations: ["quote.create"] },
  { pattern: /workflow|automation/, operations: ["workflow.execute"] },
  { pattern: /custom field|properties/, operations: ["custom.read.custom_fields"] },
];

function safeText(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function connectorClass(provider: string) {
  if (["hubspot", "salesforce", "pipedrive", "zoho"].includes(provider))
    return "native_api" as const;
  return provider === "genie" ? "known_browser" as const : "unknown_browser" as const;
}

export function humanCommissioningStatus(state: CommissioningState) {
  return ({
    AUTHENTICATE: "Connecting",
    DISCOVER_NAVIGATION: "Finding CRM navigation",
    DISCOVER_CAPABILITIES: "Finding sales functions",
    TEST_SAFE_READS: "Testing safe reads",
    AWAIT_SAFE_TEST_RECORD: "Waiting for test customer",
    TEST_CONTROLLED_WRITES: "Testing updates",
    VERIFY_READBACK: "Checking results",
    PUBLISH_PROVEN_OPERATIONS: "Finishing setup",
    READY: "Ready",
  } as const)[state];
}

export function buildSecretFreeDiscoveryPrompt(snapshot: DiscoverySnapshot) {
  const serialized = JSON.stringify({
    pageUrl: snapshot.pageUrl,
    controls: snapshot.controls.map(({ tag, role, label, selector, href, pageUrl }) => ({
      tag,
      role,
      label: safeText(label, 160),
      selector: safeText(selector, 300),
      href: safeText(href, 1_000) || undefined,
      pageUrl: safeText(pageUrl, 1_000) || undefined,
    })),
  });
  if (/"(?:password|credentials?|authorization|cookies?|storageState|browserSession|secret)"\s*:/i.test(serialized))
    throw new Error("DISCOVERY_PROMPT_SECRET_FIELD_REJECTED");
  return `Identify CRM navigation capabilities from this bounded control-only snapshot. Return operation keys only. Never infer a write as safe.\n${serialized}`;
}

export function inferBrowserOperationCandidates(snapshot: DiscoverySnapshot) {
  buildSecretFreeDiscoveryPrompt(snapshot);
  const candidates = new Map<
    string,
    { operationKey: string; mode: BrowserOperationMode; control: BrowserDiscoveryControl }
  >();
  for (const control of snapshot.controls) {
    const semantic = `${control.label} ${control.href || ""} ${control.role}`.toLowerCase();
    for (const matcher of discoveryMatchers) {
      if (!matcher.pattern.test(semantic)) continue;
      for (const operationKey of matcher.operations) {
        if (candidates.has(operationKey)) continue;
        const catalogue = BROWSER_OPERATION_CATALOGUE.find(item => item.key === operationKey);
        candidates.set(operationKey, {
          operationKey,
          mode: catalogue?.mode || (operationKey.startsWith("custom.write.") ? "write" : "read"),
          control,
        });
      }
    }
  }
  return Array.from(candidates.values()).slice(0, 80);
}

export function controlledWritePayload(
  operationKey: string,
  record: SafeTestContext
) {
  const destinationKind = COMMUNICATION_OPERATIONS[operationKey];
  const destination = destinationKind
    ? record.authorisedDestinations?.[destinationKind]?.trim()
    : undefined;
  if (destinationKind && !destination)
    throw new Error("AUTHORISED_TEST_DESTINATION_REQUIRED");
  const extended = ["appointment.book", "quote.create", "workflow.execute", "sequence.apply"];
  if (extended.includes(operationKey) && !record.authorisedOperationKeys?.includes(operationKey))
    throw new Error("EXPLICIT_OPERATION_AUTHORISATION_REQUIRED");
  const requiresOpportunity = new Set([
    "opportunity.update",
    "stage.update",
  ]).has(operationKey);
  const requiresTask = operationKey === "task.complete";
  const requiresContact = !requiresOpportunity && !requiresTask;
  if (requiresContact && !record.contactExternalId)
    throw new Error("SAFE_TEST_CONTACT_REQUIRED");
  if (requiresOpportunity && !record.opportunityExternalId)
    throw new Error("SAFE_TEST_OPPORTUNITY_SELECTION_REQUIRED");
  if (requiresTask && !record.taskExternalId)
    throw new Error("SAFE_TEST_TASK_SELECTION_REQUIRED");
  const exactExternalId = requiresOpportunity
    ? record.opportunityExternalId
    : requiresTask
      ? record.taskExternalId
      : record.contactExternalId;
  return {
    externalId: exactExternalId,
    contactExternalId: requiresContact || operationKey === "task.create_callback"
      ? record.contactExternalId
      : undefined,
    companyExternalId: record.companyExternalId,
    opportunityExternalId: requiresOpportunity || operationKey === "task.create_callback"
      ? record.opportunityExternalId
      : undefined,
    taskExternalId: requiresTask ? record.taskExternalId : undefined,
    leadLabel: record.contactLabel,
    contactName: record.contactLabel,
    query: record.contactExternalId,
    to: destination,
    email: destinationKind === "email" ? destination : undefined,
    phone: destinationKind && destinationKind !== "email" ? destination : undefined,
    content: "Amarktai controlled setup verification",
    noteBody: "Amarktai controlled setup verification",
    taskTitle: "Amarktai setup verification",
    stage: "Amarktai setup verification",
    callbackAt: new Date(Date.now() + 86_400_000).toISOString(),
    controlledCommissioning: true,
  };
}

function normalizedContactLabel(contact: NormalizedContact) {
  return `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
    contact.email || contact.phone || contact.externalId;
}

function exactContactMatches(contact: NormalizedContact, reference: string) {
  const expected = reference.trim().toLowerCase();
  return [
    contact.externalId,
    contact.email,
    contact.phone,
    normalizedContactLabel(contact),
  ].some(value => value?.trim().toLowerCase() === expected);
}

async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{ records: T[]; cursor?: string }>,
  maximumPages = 20
) {
  const records: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maximumPages; page += 1) {
    const result = await fetchPage(cursor);
    records.push(...result.records);
    if (!result.cursor) return records;
    cursor = result.cursor;
  }
  throw new Error("SAFE_TEST_CONTEXT_PAGINATION_LIMIT");
}

function evidenceExternalId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:externalId|id|contactId)$/i.test(key) &&
        (typeof child === "string" || typeof child === "number")) {
      const candidate = String(child).trim();
      if (candidate) return candidate;
    }
    const nested = evidenceExternalId(child);
    if (nested) return nested;
  }
  return undefined;
}

function browserEvidenceRows(value: unknown) {
  if (!value || typeof value !== "object") return [] as Record<string, unknown>[];
  const providerResult = (value as Record<string, unknown>).providerResult;
  if (!providerResult || typeof providerResult !== "object") return [];
  const data = (providerResult as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["targets", "records", "tasks", "opportunities"]) {
    const serialized = (data as Record<string, unknown>)[key];
    if (typeof serialized !== "string") continue;
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        );
    } catch {
      continue;
    }
  }
  return [];
}

function oneRelatedRecord<T extends { externalId: string }>(input: {
  kind: "opportunity" | "task";
  records: T[];
  selectedExternalId?: string;
  label: (record: T) => string;
}) {
  if (input.selectedExternalId) {
    const selected = input.records.find(
      record => record.externalId === input.selectedExternalId
    );
    if (!selected)
      throw new Error(
        `SAFE_TEST_${input.kind.toUpperCase()}_SELECTION_INVALID: the selected ${input.kind} is not related to this test customer.`
      );
    return selected;
  }
  if (input.records.length <= 1) return input.records[0];
  const choices = input.records.slice(0, 10)
    .map(record => `${input.label(record)} (${record.externalId})`)
    .join(", ");
  throw new Error(
    `SAFE_TEST_${input.kind.toUpperCase()}_SELECTION_REQUIRED: choose one exact related ${input.kind}: ${choices}`
  );
}

export function connectorSupportsTemporaryTestRecord(input: {
  connection: AdapterConnection;
  adapter: CrmAdapter;
  contactCreateLiveProven?: boolean;
}) {
  if (!input.adapter.createContact) return false;
  if (!input.connection.verifiedCapabilities.includes("contacts.write"))
    return false;
  const browser = ["browser", "sidecar"].includes(
    input.connection.connectionMethod
  );
  return !browser || input.contactCreateLiveProven === true;
}

export async function resolveSafeTestContext(input: {
  record: SafeTestRecord;
  operationKeys: string[];
  connection: AdapterConnection;
  adapter: CrmAdapter;
  secret: ConnectionSecretPayload;
  contactCreateLiveProven?: boolean;
  correlationId: string;
}): Promise<SafeTestContext> {
  const reference = input.record.reference.trim();
  let contact: NormalizedContact | undefined;
  let temporaryRecordCreated = false;
  if (input.record.mode === "temporary") {
    if (!connectorSupportsTemporaryTestRecord(input))
      throw new Error(
        "TEMPORARY_TEST_RECORD_UNAVAILABLE: use an existing CRM test customer for this connector."
      );
    const label = `Amarktai Setup Test ${input.correlationId.slice(-8)}`;
    const evidence = await input.adapter.createContact!({
      connection: input.connection,
      secret: input.secret,
      fields: {
        firstName: "Amarktai Setup",
        lastName: "Test",
        name: label,
        commissioningLabel: label,
      },
      correlationId: input.correlationId,
    });
    const createdId = evidenceExternalId(evidence.providerResult);
    if (createdId)
      contact = await input.adapter.getContact({
        connection: input.connection,
        secret: input.secret,
        externalId: createdId,
      }) || undefined;
    if (!contact) {
      const matches = await input.adapter.searchContacts({
        connection: input.connection,
        secret: input.secret,
        query: label,
      });
      const exact = matches.filter(candidate =>
        normalizedContactLabel(candidate).toLowerCase() === label.toLowerCase()
      );
      if (exact.length !== 1)
        throw new Error(
          "TEMPORARY_TEST_RECORD_ID_UNVERIFIED: the connector created a record but did not return one exact readable contact ID."
        );
      contact = exact[0];
    }
    temporaryRecordCreated = true;
  } else {
    if (!reference) throw new Error("AUTHORISED_TEST_RECORD_REQUIRED");
    const matches = await input.adapter.searchContacts({
      connection: input.connection,
      secret: input.secret,
      query: reference,
    });
    const exact = matches.filter(candidate =>
      exactContactMatches(candidate, reference)
    );
    if (exact.length > 1)
      throw new Error(
        `SAFE_TEST_CONTACT_SELECTION_REQUIRED: ${exact.length} exact-looking contacts matched; enter the exact external contact ID.`
      );
    contact = exact[0];
    if (!contact) {
      const direct = await input.adapter.getContact({
        connection: input.connection,
        secret: input.secret,
        externalId: reference,
      });
      if (direct?.externalId === reference) contact = direct;
    }
    if (!contact)
      throw new Error(
        "SAFE_TEST_CONTACT_NOT_FOUND: enter an exact CRM contact ID, email, phone, or unique contact name."
      );
  }

  const needsOpportunity = input.operationKeys.some(key =>
    ["opportunity.update", "stage.update"].includes(key)
  );
  const needsTask = input.operationKeys.includes("task.complete");
  let opportunity: NormalizedOpportunity | undefined;
  let task: NormalizedTask | undefined;
  if (needsOpportunity) {
    const browser = ["browser", "sidecar"].includes(input.connection.connectionMethod);
    const available = browser && input.adapter.executeCustomAction
      ? browserEvidenceRows(await input.adapter.executeCustomAction({
          connection: input.connection,
          secret: input.secret,
          actionName: "opportunity.read",
          payload: { contactExternalId: contact.externalId },
          correlationId: `${input.correlationId}:opportunity-read`,
        })).map(item => ({
          externalId: String(item.externalId || item.id || ""),
          contactExternalId: typeof item.contactExternalId === "string" ? item.contactExternalId : undefined,
          companyExternalId: typeof item.companyExternalId === "string" ? item.companyExternalId : undefined,
          name: String(item.name || item.label || "Opportunity"),
          raw: item,
        } satisfies NormalizedOpportunity)).filter(item => item.externalId)
      : await collectPages(cursor =>
          input.adapter.syncOpportunities({
            connection: input.connection,
            secret: input.secret,
            cursor,
          })
        );
    const related = available.filter(item =>
      item.contactExternalId === contact!.externalId ||
      Boolean(contact!.companyExternalId && item.companyExternalId === contact!.companyExternalId)
    );
    opportunity = oneRelatedRecord({
      kind: "opportunity",
      records: related,
      selectedExternalId: input.record.selectedOpportunityExternalId,
      label: item => item.name,
    });
    if (!opportunity)
      throw new Error(
        "SAFE_TEST_OPPORTUNITY_REQUIRED: this controlled opportunity test needs one related safe/test opportunity."
      );
  }
  if (needsTask) {
    const browser = ["browser", "sidecar"].includes(input.connection.connectionMethod);
    const available = browser && input.adapter.executeCustomAction
      ? browserEvidenceRows(await input.adapter.executeCustomAction({
          connection: input.connection,
          secret: input.secret,
          actionName: "task.list",
          payload: { contactExternalId: contact.externalId },
          correlationId: `${input.correlationId}:task-read`,
        })).map(item => ({
          externalId: String(item.externalId || item.id || ""),
          contactExternalId: typeof item.contactExternalId === "string" ? item.contactExternalId : undefined,
          opportunityExternalId: typeof item.opportunityExternalId === "string" ? item.opportunityExternalId : undefined,
          title: String(item.title || item.name || "Task"),
          status: String(item.status || "open"),
          raw: item,
        } satisfies NormalizedTask)).filter(item => item.externalId)
      : await collectPages(cursor =>
          input.adapter.syncTasks({
            connection: input.connection,
            secret: input.secret,
            cursor,
          })
        );
    const related = available.filter(item => item.contactExternalId === contact!.externalId);
    task = oneRelatedRecord({
      kind: "task",
      records: related,
      selectedExternalId: input.record.selectedTaskExternalId,
      label: item => item.title,
    });
    if (!task)
      throw new Error(
        "SAFE_TEST_TASK_REQUIRED: this controlled task test needs one related safe/test task."
      );
  }
  return {
    ...input.record,
    reference: contact.externalId,
    contactExternalId: contact.externalId,
    contactLabel: normalizedContactLabel(contact),
    contactEmail: contact.email,
    contactPhone: contact.phone,
    companyExternalId: contact.companyExternalId,
    opportunityExternalId: opportunity?.externalId,
    opportunityLabel: opportunity?.name,
    taskExternalId: task?.externalId,
    taskLabel: task?.title,
    temporaryRecordCreated,
    temporaryRecordCleanup: temporaryRecordCreated
      ? "manager_remove"
      : "not_applicable",
  };
}

export function nextCommissioningState(input: {
  state: CommissioningState;
  hasWrites?: boolean;
  hasSafeTestRecord?: boolean;
}) {
  if (input.state === "AUTHENTICATE") return "DISCOVER_NAVIGATION";
  if (input.state === "DISCOVER_NAVIGATION") return "DISCOVER_CAPABILITIES";
  if (input.state === "DISCOVER_CAPABILITIES") return "TEST_SAFE_READS";
  if (input.state === "TEST_SAFE_READS")
    return input.hasWrites ? "AWAIT_SAFE_TEST_RECORD" : "PUBLISH_PROVEN_OPERATIONS";
  if (input.state === "AWAIT_SAFE_TEST_RECORD")
    return input.hasSafeTestRecord ? "TEST_CONTROLLED_WRITES" : "AWAIT_SAFE_TEST_RECORD";
  if (input.state === "TEST_CONTROLLED_WRITES") return "VERIFY_READBACK";
  if (input.state === "VERIFY_READBACK") return "PUBLISH_PROVEN_OPERATIONS";
  if (input.state === "PUBLISH_PROVEN_OPERATIONS") return "READY";
  return "READY";
}

export function coreBrowserCommissioningReady(
  statuses: ReadonlyMap<string, string>
) {
  return CORE_BROWSER_OPERATIONS.every(key => statuses.get(key) === "LIVE_PROVEN");
}

export function automaticRepairStatusAfterProof(input: {
  mode: BrowserOperationMode;
  safeVerificationPassed: boolean;
  controlledWriteProof?: boolean;
  readbackVerified?: boolean;
}) {
  if (!input.safeVerificationPassed) return "DEGRADED" as const;
  if (
    input.mode === "write" &&
    (!input.controlledWriteProof || !input.readbackVerified)
  )
    return "TEST_READY" as const;
  return "LIVE_PROVEN" as const;
}

async function loadJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return (await db.select().from(crmCommissioningJobs).where(eq(crmCommissioningJobs.id, id)).limit(1))[0];
}

async function updateJob(
  id: number,
  values: Partial<typeof crmCommissioningJobs.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db.update(crmCommissioningJobs).set(values).where(eq(crmCommissioningJobs.id, id));
}

async function systemForJob(job: CrmCommissioningJob) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db.select().from(connectedSystems).where(and(
      eq(connectedSystems.id, job.connectedSystemId),
      eq(connectedSystems.organisationId, job.organisationId)
    )).limit(1)
  )[0];
  if (!system) throw new Error("Connected system was not found for commissioning.");
  return system;
}

async function insertCandidate(input: {
  job: CrmCommissioningJob;
  operationKey: string;
  mode: BrowserOperationMode;
  control: BrowserDiscoveryControl;
}) {
  if (await latestBrowserOperation({
    organisationId: input.job.organisationId,
    connectedSystemId: input.job.connectedSystemId,
    operationKey: input.operationKey,
  })) return false;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const definition = {
    mode: input.mode,
    candidateOnly: true,
    automaticDiscovery: {
      label: safeText(input.control.label, 160),
      selector: safeText(input.control.selector, 300),
      href: safeText(input.control.href, 1_000) || undefined,
      readOnlyDiscovery: true,
    },
  };
  await db.insert(browserLearnedOperations).values({
    organisationId: input.job.organisationId,
    connectedSystemId: input.job.connectedSystemId,
    operationKey: input.operationKey,
    version: 1,
    status: "NOT_LEARNED",
    definition,
    prerequisites: { automaticCandidate: true },
    targetAssertions: {},
    postconditionAssertions: [],
    checksum: operationChecksum({ operationKey: input.operationKey, definition }),
    evidence: { automaticDiscovery: true, readOnly: true },
    createdByUserId: input.job.requestedByUserId,
  });
  return true;
}

export async function attemptBoundedAutomaticRepair(input: {
  system: typeof connectedSystems.$inferSelect;
  operationKey: string;
  previousVersion: number;
}) {
  if (input.system.provider !== "genie" && input.system.provider !== "custom_browser")
    return { proposed: false, reason: "not_browser" };
  const snapshot = await inspectBrowserCrmNavigation({
    connection: toAdapterConnection(input.system),
    provider: input.system.provider,
  });
  const candidate = inferBrowserOperationCandidates(snapshot).find(
    item => item.operationKey === input.operationKey
  );
  if (!candidate)
    return { proposed: false, reason: "safe_candidate_not_found" };
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const definition = {
    mode: candidate.mode,
    candidateOnly: true,
    automaticRepair: {
      previousVersion: input.previousVersion,
      label: safeText(candidate.control.label, 160),
      selector: safeText(candidate.control.selector, 300),
      href: safeText(candidate.control.href, 1_000) || undefined,
      requiresSafeVerification: true,
      requiresControlledWriteProof: candidate.mode === "write",
    },
  };
  await db.insert(browserLearnedOperations).values({
    organisationId: input.system.organisationId,
    connectedSystemId: input.system.id,
    operationKey: input.operationKey,
    version: input.previousVersion + 1,
    status: "NOT_LEARNED",
    definition,
    prerequisites: { automaticRepairCandidate: true },
    targetAssertions: {},
    postconditionAssertions: [],
    checksum: operationChecksum({ operationKey: input.operationKey, definition }),
    evidence: { automaticRepair: true, readOnlyDiscovery: true },
  }).onDuplicateKeyUpdate({ set: { evidence: { automaticRepair: true, readOnlyDiscovery: true } } });
  return { proposed: true, version: input.previousVersion + 1, status: "NOT_LEARNED" as const };
}

export async function installKnownGeniePack(job: CrmCommissioningJob, system: typeof connectedSystems.$inferSelect) {
  const profile = await resolveBrowserProfile(toAdapterConnection(system), "genie");
  if (!profile) return { installed: [] as string[], needsDiscovery: [] as string[] };
  const installed: string[] = [];
  const needsDiscovery: string[] = [];
  for (const [operationKey, packed] of Object.entries(profile.operationDefinitions || {})) {
    try {
      const source = packed.definition as Record<string, unknown>;
      const script = (key: string) => {
        const name = typeof source[key] === "string" ? source[key] : "";
        const selected = name ? profile.scripts[name] : undefined;
        if (!selected) throw new Error(`Known Genie operation '${operationKey}' references missing script '${name}'.`);
        return selected;
      };
      const definition = validateLearnedOperationDefinition(
        typeof source.executeScript === "string"
          ? {
              mode: source.mode,
              execute: script("executeScript"),
              targetRead: typeof source.targetReadScript === "string" ? script("targetReadScript") : undefined,
              postconditionRead: typeof source.postconditionReadScript === "string" ? script("postconditionReadScript") : undefined,
              resultKey: source.resultKey,
            }
          : packed.definition
      );
      const existing = await latestBrowserOperation({
        organisationId: job.organisationId,
        connectedSystemId: job.connectedSystemId,
        operationKey,
      });
      if (existing && existing.status !== "NOT_LEARNED") continue;
      await saveLearnedBrowserOperation({
        userId: job.requestedByUserId!,
        organisationId: job.organisationId,
        connectedSystemId: job.connectedSystemId,
        operationKey,
        definition,
        prerequisites: { ...(packed.prerequisites || {}), knownGeniePack: true },
        targetAssertions: packed.targetAssertions || {},
        postconditionAssertions: (packed.postconditionAssertions || []) as BrowserPostcondition[],
      });
      installed.push(operationKey);
    } catch {
      needsDiscovery.push(operationKey);
    }
  }
  for (const [adapterOperation, scriptName] of Object.entries(profile.operationMap || {})) {
    const operationKey = ADAPTER_OPERATION_KEYS[adapterOperation];
    const metadata = BROWSER_OPERATION_CATALOGUE.find(item => item.key === operationKey);
    const script = profile.scripts[scriptName];
    if (!operationKey || metadata?.mode !== "read" || !script) continue;
    try {
      validateLearnedOperationDefinition({ mode: "read", execute: script });
    } catch {
      needsDiscovery.push(operationKey);
      continue;
    }
    if (await latestBrowserOperation({ organisationId: job.organisationId, connectedSystemId: job.connectedSystemId, operationKey })) continue;
    await saveLearnedBrowserOperation({
      userId: job.requestedByUserId!,
      organisationId: job.organisationId,
      connectedSystemId: job.connectedSystemId,
      operationKey,
      definition: { mode: "read", execute: script },
      prerequisites: { knownGeniePack: true, importedFrom: scriptName },
    });
    installed.push(operationKey);
  }
  return {
    installed: Array.from(new Set(installed)),
    needsDiscovery: Array.from(new Set(needsDiscovery)),
  };
}

function parseJsonObject(value: string) {
  const cleaned = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Semantic discovery returned no JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

async function discoverSemanticOperationDefinitions(input: {
  job: CrmCommissioningJob;
  snapshot: DiscoverySnapshot;
  targetOperationKeys?: string[];
  allowReplacement?: boolean;
}) {
  if (!input.job.requestedByUserId || !getGenxReadiness().configured)
    return { calls: 0, installed: [] as string[] };
  const semanticTargets = (input.targetOperationKeys || [])
    .filter(key => BROWSER_OPERATION_CATALOGUE.some(item => item.key === key))
    .slice(0, 80);
  const basePrompt = buildSecretFreeDiscoveryPrompt(input.snapshot);
  const prompt = semanticTargets.length
    ? `${basePrompt}\nKnown Genie catalogue targets for this bounded repair: ${semanticTargets.join(", ")}. Return only these operation keys and never return a template placeholder.`
    : basePrompt;
  const response = await runGenxAgent({
    agentKey: "knowledge_curator",
    modelTier: "reasoning",
    billing: {
      userId: input.job.requestedByUserId,
      organisationId: input.job.organisationId,
      feature: "crm_commissioning_discovery",
      reference: `crm-commissioning:${input.job.id}:semantic-discovery`,
    },
    messages: [{
      role: "user",
      content: `${prompt}\n\nReturn strict JSON: {"operations":[{"operationKey":"contact.read","definition":{"mode":"read","execute":{"steps":[...]}},"prerequisites":{},"targetAssertions":{},"postconditionAssertions":[]}]}. Use only declarative saved-browser actions and selectors present in the snapshot. Reads may be proposed only when their output is deterministic. Writes require a deterministic target-read, execution, postcondition-read, target assertions and postcondition assertions. Never include credentials, cookies, tokens, customer values, executable JavaScript, or navigation outside listed authorised URLs. If uncertain, omit the operation.`,
    }],
  });
  const parsed = parseJsonObject(response.content);
  const operations = Array.isArray(parsed.operations) ? parsed.operations.slice(0, 80) : [];
  const installed: string[] = [];
  for (const raw of operations) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    const operationKey = safeText(candidate.operationKey, 120);
    if (semanticTargets.length && !semanticTargets.includes(operationKey))
      continue;
    const known = BROWSER_OPERATION_CATALOGUE.some(item => item.key === operationKey);
    if (!known && !/^custom\.(?:read|write)\.[a-z0-9_.:-]{2,100}$/.test(operationKey)) continue;
    const existing = await latestBrowserOperation({
      organisationId: input.job.organisationId,
      connectedSystemId: input.job.connectedSystemId,
      operationKey,
    });
    if (
      existing &&
      existing.status !== "NOT_LEARNED" &&
      !input.allowReplacement
    ) continue;
    try {
      const definition = validateLearnedOperationDefinition(candidate.definition);
      const postconditionAssertions = Array.isArray(candidate.postconditionAssertions)
        ? candidate.postconditionAssertions as BrowserPostcondition[]
        : [];
      if (definition.mode === "write" && !postconditionAssertions.length) continue;
      await saveLearnedBrowserOperation({
        userId: input.job.requestedByUserId,
        organisationId: input.job.organisationId,
        connectedSystemId: input.job.connectedSystemId,
        operationKey,
        definition,
        prerequisites: {
          ...(candidate.prerequisites && typeof candidate.prerequisites === "object" && !Array.isArray(candidate.prerequisites)
            ? candidate.prerequisites as Record<string, unknown>
            : {}),
          automaticSemanticDiscovery: true,
          boundedReplacementOfVersion: existing?.version,
        },
        targetAssertions:
          candidate.targetAssertions && typeof candidate.targetAssertions === "object" && !Array.isArray(candidate.targetAssertions)
            ? candidate.targetAssertions as Record<string, unknown>
            : {},
        postconditionAssertions,
      });
      installed.push(operationKey);
    } catch {
      // Ambiguous or invalid model output remains a non-executable candidate.
    }
  }
  return { calls: 1, installed };
}

async function testOperations(input: {
  job: CrmCommissioningJob;
  mode: BrowserOperationMode;
  safeTestRecord?: SafeTestContext;
}) {
  const system = await systemForJob(input.job);
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const rows = await db.select().from(browserLearnedOperations).where(and(
    eq(browserLearnedOperations.organisationId, input.job.organisationId),
    eq(browserLearnedOperations.connectedSystemId, input.job.connectedSystemId)
  )).orderBy(desc(browserLearnedOperations.version));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.operationKey)) latest.set(row.operationKey, row);
  const selected = Array.from(latest.values()).filter(row => {
    if (row.status !== "TEST_READY") return false;
    const definition = row.definition as Record<string, unknown>;
    return definition.mode === input.mode;
  });
  const failures = { ...(input.job.optionalFailures || {}) };
  const proven: string[] = [];
  const failedOperationKeys: string[] = [];
  const runOne = async (operationKey: string) => {
    const payload = input.mode === "write"
      ? controlledWritePayload(operationKey, input.safeTestRecord!)
      : {};
    await testLearnedBrowserOperation({
      connection: toAdapterConnection(system),
      provider: system.provider as "genie" | "custom_browser",
      operationKey,
      payload,
      correlationId: `auto-${input.job.id}-${operationKey}-${randomUUID()}`,
      publishByUserId: input.job.requestedByUserId || undefined,
    });
  };
  for (const operation of selected.slice(0, 80)) {
    try {
      await runOne(operation.operationKey);
      proven.push(operation.operationKey);
      delete failures[operation.operationKey];
    } catch (error) {
      failedOperationKeys.push(operation.operationKey);
      failures[operation.operationKey] = safeText(
        error instanceof Error ? error.message : String(error),
        500
      );
    }
  }
  // Selector drift in a genuinely installed Genie definition receives one
  // bounded, control-only repair pass. Each replacement is still TEST_READY
  // and must pass the same read/guardian/write/readback proof below.
  if (system.provider === "genie" && failedOperationKeys.length) {
    try {
      const snapshot = await inspectBrowserCrmNavigation({
        connection: toAdapterConnection(system),
        provider: "genie",
      });
      const repair = await discoverSemanticOperationDefinitions({
        job: input.job,
        snapshot,
        targetOperationKeys: failedOperationKeys,
        allowReplacement: true,
      });
      for (const operationKey of repair.installed) {
        try {
          await runOne(operationKey);
          if (!proven.includes(operationKey)) proven.push(operationKey);
          delete failures[operationKey];
        } catch (error) {
          failures[operationKey] = safeText(
            error instanceof Error ? error.message : String(error),
            500
          );
        }
      }
    } catch {
      // Only the failed operation remains Needs setup; unrelated operations
      // keep their independently proven lifecycle state.
    }
  }
  return { proven, failures, attempted: selected.length };
}

const activeJobs = new Set<number>();

export function scheduleAutomaticCommissioning(jobId: number) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  setImmediate(() => {
    void advanceAutomaticCommissioning(jobId)
      .catch(error => console.error("[crm-commissioning] background step failed", {
        jobId,
        detail: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => activeJobs.delete(jobId));
  });
}

export async function startAutomaticCommissioning(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const system = (
    await db.select().from(connectedSystems).where(and(
      eq(connectedSystems.id, input.connectedSystemId),
      eq(connectedSystems.organisationId, input.organisationId)
    )).limit(1)
  )[0];
  if (!system) throw new Error("Connected system was not found in this organisation.");
  const values = {
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    requestedByUserId: input.userId,
    connectorClass: connectorClass(system.provider),
    state: "AUTHENTICATE" as const,
    status: "queued" as const,
    progress: { humanStatus: "Connecting", steps: {} },
    safeTestRecord: null,
    discoveredOperationKeys: [],
    optionalFailures: {},
    attempt: 0,
    cancelRequested: false,
    leaseExpiresAt: null,
    lastError: null,
    startedAt: new Date(),
    completedAt: null,
  };
  await db.insert(crmCommissioningJobs).values(values).onDuplicateKeyUpdate({ set: values });
  const job = (
    await db.select().from(crmCommissioningJobs).where(eq(crmCommissioningJobs.connectedSystemId, input.connectedSystemId)).limit(1)
  )[0];
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "crm_automatic_commissioning_started",
    entityType: "crm_commissioning_job",
    entityId: String(job.id),
    summary: `${system.displayName} automatic commissioning started.`,
    metadata: { connectedSystemId: system.id, connectorClass: values.connectorClass },
  });
  scheduleAutomaticCommissioning(job.id);
  return presentCommissioningJob(job);
}

export async function authoriseCommissioningSafeTest(input: {
  userId: number;
  organisationId: number;
  connectedSystemId: number;
  record: SafeTestRecord;
}) {
  const job = await getAutomaticCommissioning({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
  });
  if (!job) throw new Error("Start automatic commissioning before choosing a test customer.");
  if (input.record.mode === "existing" && !input.record.reference.trim())
    throw new Error("Choose a valid authorised test customer.");
  const requestedRecord: SafeTestRecord = {
    mode: input.record.mode,
    reference: input.record.reference.trim().slice(0, 500),
    authorisedDestinations: Object.fromEntries(
      Object.entries(input.record.authorisedDestinations || {})
        .map(([key, value]) => [key, safeText(value, 500)])
        .filter(([, value]) => value)
    ),
    authorisedOperationKeys: (input.record.authorisedOperationKeys || [])
      .filter(key => BROWSER_OPERATION_CATALOGUE.some(item => item.key === key))
      .slice(0, 30),
    selectedOpportunityExternalId: safeText(
      input.record.selectedOpportunityExternalId,
      500
    ) || undefined,
    selectedTaskExternalId: safeText(
      input.record.selectedTaskExternalId,
      500
    ) || undefined,
  };
  const system = await systemForJob(job);
  const connection = toAdapterConnection(system);
  const adapter = getCrmAdapter(system.provider);
  const secret = await loadConnectionSecret({
    organisationId: input.organisationId,
    connectedSystemId: input.connectedSystemId,
    secretKind: system.connectionMethod === "oauth" ? "oauth" : "browser",
  }) || {};
  const matrix = system.connectionMethod === "oauth"
    ? null
    : await browserOperationReadinessForSystem({
        organisationId: input.organisationId,
        connectedSystemId: input.connectedSystemId,
      });
  const operationKeys = matrix?.operations
    .filter(operation => operation.mode === "write" && operation.status === "TEST_READY")
    .map(operation => operation.key) || [];
  const safeRecord = await resolveSafeTestContext({
    record: requestedRecord,
    operationKeys,
    connection,
    adapter,
    secret,
    contactCreateLiveProven: matrix?.operations.some(operation =>
      operation.key === "contact.create" && operation.status === "LIVE_PROVEN"
    ),
    correlationId: `commissioning-${job.id}-${randomUUID()}`,
  });
  await updateJob(job.id, {
    safeTestRecord: safeRecord,
    state: "TEST_CONTROLLED_WRITES",
    status: "queued",
    progress: { ...(job.progress || {}), humanStatus: "Testing updates" },
    lastError: null,
  });
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "crm_commissioning_test_record_authorised",
    entityType: "crm_commissioning_job",
    entityId: String(job.id),
    summary: "A controlled CRM setup record was authorised for automatic write testing.",
    metadata: {
      connectedSystemId: input.connectedSystemId,
      mode: safeRecord.mode,
      contactExternalId: safeRecord.contactExternalId,
      opportunityExternalId: safeRecord.opportunityExternalId,
      taskExternalId: safeRecord.taskExternalId,
      temporaryRecordCreated: safeRecord.temporaryRecordCreated,
      temporaryRecordCleanup: safeRecord.temporaryRecordCleanup,
      authorisedChannels: Object.keys(safeRecord.authorisedDestinations || {}),
      authorisedOperationKeys: safeRecord.authorisedOperationKeys,
    },
  });
  scheduleAutomaticCommissioning(job.id);
  return presentCommissioningJob({ ...job, safeTestRecord: safeRecord, state: "TEST_CONTROLLED_WRITES", status: "queued" });
}

export async function getAutomaticCommissioning(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return (
    await db.select().from(crmCommissioningJobs).where(and(
      eq(crmCommissioningJobs.organisationId, input.organisationId),
      eq(crmCommissioningJobs.connectedSystemId, input.connectedSystemId)
    )).limit(1)
  )[0];
}

export function presentCommissioningJob(job: CrmCommissioningJob) {
  const { discoverySnapshot: _internalSnapshot, ...publicProgress } =
    (job.progress || {}) as Record<string, unknown>;
  const needsSetup = ["needs_attention", "failed"].includes(job.status);
  return {
    id: job.id,
    connectedSystemId: job.connectedSystemId,
    connectorClass: job.connectorClass,
    state: job.state,
    status: job.status,
    humanStatus: needsSetup ? "Needs setup" : humanCommissioningStatus(job.state),
    progress: publicProgress,
    optionalFailures: job.optionalFailures,
    safeTestRequired: job.state === "AWAIT_SAFE_TEST_RECORD",
    temporaryRecordSupported:
      (publicProgress as Record<string, unknown>).temporaryRecordSupported === true,
    temporaryRecordGuidance:
      (publicProgress as Record<string, unknown>).temporaryRecordSupported === true
        ? "Create an explicitly labelled temporary setup contact"
        : "Enter an existing CRM test record",
    advancedFallback: needsSetup,
    completedAt: job.completedAt,
  };
}

export async function automaticCommissioningStatus(input: {
  organisationId: number;
  connectedSystemId: number;
}) {
  const job = await getAutomaticCommissioning(input);
  if (!job) return null;
  if (["queued", "running"].includes(job.status)) scheduleAutomaticCommissioning(job.id);
  return presentCommissioningJob(job);
}

export async function advanceAutomaticCommissioning(jobId: number) {
  const candidate = await loadJob(jobId);
  if (!candidate || !["queued", "running"].includes(candidate.status)) return;
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const claimed = await db.update(crmCommissioningJobs).set({
    status: "running",
    attempt: candidate.attempt + 1,
    leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    progress: {
      ...(candidate.progress || {}),
      humanStatus: humanCommissioningStatus(candidate.state),
    },
  }).where(and(
    eq(crmCommissioningJobs.id, jobId),
    inArray(crmCommissioningJobs.status, ["queued", "running"]),
    or(
      isNull(crmCommissioningJobs.leaseExpiresAt),
      lt(crmCommissioningJobs.leaseExpiresAt, new Date())
    )
  ));
  if (Number(claimed[0].affectedRows || 0) !== 1) return;
  const job = await loadJob(jobId);
  if (!job) return;
  if (job.cancelRequested) {
    await updateJob(job.id, { status: "cancelled", completedAt: new Date(), leaseExpiresAt: null });
    return;
  }
  if (job.state === "AWAIT_SAFE_TEST_RECORD" && !job.safeTestRecord) return;
  try {
    const system = await systemForJob(job);
    let next = job.state as CommissioningState;
    let progress = { ...(job.progress || {}) } as Record<string, unknown>;
    let failures = { ...(job.optionalFailures || {}) };
    let discovered = [...(job.discoveredOperationKeys || [])];
    if (job.state === "AUTHENTICATE") {
      const adapter = getCrmAdapter(system.provider);
      const secret = await loadConnectionSecret({
        organisationId: job.organisationId,
        connectedSystemId: job.connectedSystemId,
        secretKind: system.connectionMethod === "oauth" ? "oauth" : "browser",
      });
      const correlationId = randomUUID();
      const test = await adapter.testConnection({ connection: toAdapterConnection(system), secret, correlationId });
      if (test.status === "failed") throw new Error(test.summary);
      await recordConnectionVerification({ organisationId: job.organisationId, connectedSystemId: job.connectedSystemId, correlationId, test });
      progress.authentication = "Ready";
      next = job.connectorClass === "native_api" ? "PUBLISH_PROVEN_OPERATIONS" : "DISCOVER_NAVIGATION";
    } else if (job.state === "DISCOVER_NAVIGATION") {
      const snapshot = await inspectBrowserCrmNavigation({
        connection: toAdapterConnection(system),
        provider: system.provider as "genie" | "custom_browser",
      });
      buildSecretFreeDiscoveryPrompt(snapshot);
      progress.discoverySnapshot = snapshot;
      progress.navigation = "Ready";
      next = "DISCOVER_CAPABILITIES";
    } else if (job.state === "DISCOVER_CAPABILITIES") {
      const snapshot = progress.discoverySnapshot as DiscoverySnapshot | undefined;
      if (!snapshot) throw new Error("Automatic discovery snapshot is missing; restart commissioning.");
      const inferred = inferBrowserOperationCandidates(snapshot);
      for (const candidate of inferred)
        if (await insertCandidate({ job, ...candidate })) discovered.push(candidate.operationKey);
      let genieDiscoveryTargets: string[] = [];
      if (system.provider === "genie") {
        const knownPack = await installKnownGeniePack(job, system);
        discovered.push(...knownPack.installed);
        genieDiscoveryTargets = knownPack.needsDiscovery;
        progress.placeholderOperationsRejected = knownPack.needsDiscovery;
      }
      if (system.provider === "custom_browser" || genieDiscoveryTargets.length) {
        const semantic = await discoverSemanticOperationDefinitions({
          job,
          snapshot,
          targetOperationKeys: genieDiscoveryTargets.length
            ? genieDiscoveryTargets
            : undefined,
          allowReplacement: system.provider === "genie",
        })
          .catch(() => ({ calls: getGenxReadiness().configured ? 1 : 0, installed: [] as string[] }));
        discovered.push(...semantic.installed);
        progress.semanticDiscoveryCalls = semantic.calls;
        if (genieDiscoveryTargets.length)
          progress.genieAutomaticallyDiscovered = semantic.installed;
      }
      discovered = Array.from(new Set(discovered));
      progress.discoveredCapabilityCount = discovered.length;
      progress.capabilities = "Ready";
      delete progress.discoverySnapshot;
      next = "TEST_SAFE_READS";
    } else if (job.state === "TEST_SAFE_READS") {
      const result = await testOperations({ job, mode: "read" });
      failures = result.failures;
      progress.safeReads = { status: "Ready", proven: result.proven, attempted: result.attempted };
      const matrix = await browserOperationReadinessForSystem({ organisationId: job.organisationId, connectedSystemId: job.connectedSystemId });
      progress.temporaryRecordSupported = connectorSupportsTemporaryTestRecord({
        connection: toAdapterConnection(system),
        adapter: getCrmAdapter(system.provider),
        contactCreateLiveProven: matrix.operations.some(operation =>
          operation.key === "contact.create" && operation.status === "LIVE_PROVEN"
        ),
      });
      const hasWrites = matrix.operations.some(operation => operation.mode === "write" && operation.status === "TEST_READY");
      next = nextCommissioningState({ state: job.state, hasWrites });
    } else if (job.state === "TEST_CONTROLLED_WRITES") {
      if (!job.safeTestRecord) throw new Error("AUTHORISED_TEST_RECORD_REQUIRED");
      const result = await testOperations({ job, mode: "write", safeTestRecord: job.safeTestRecord as SafeTestContext });
      failures = result.failures;
      progress.controlledWrites = { status: "Ready", proven: result.proven, attempted: result.attempted };
      next = "VERIFY_READBACK";
    } else if (job.state === "VERIFY_READBACK") {
      progress.readback = "Ready";
      next = "PUBLISH_PROVEN_OPERATIONS";
    } else if (job.state === "PUBLISH_PROVEN_OPERATIONS") {
      const adapter = getCrmAdapter(system.provider);
      const secret = await loadConnectionSecret({
        organisationId: job.organisationId,
        connectedSystemId: job.connectedSystemId,
        secretKind: system.connectionMethod === "oauth" ? "oauth" : "browser",
      });
      const correlationId = randomUUID();
      const test = await adapter.testConnection({ connection: toAdapterConnection(system), secret, correlationId });
      await recordConnectionVerification({ organisationId: job.organisationId, connectedSystemId: job.connectedSystemId, correlationId, test });
      const matrix = system.connectionMethod === "oauth" ? null : await browserOperationReadinessForSystem({ organisationId: job.organisationId, connectedSystemId: job.connectedSystemId });
      const statuses = new Map(matrix?.operations.map(operation => [operation.key, operation.status]) || []);
      const coreReady = system.connectionMethod === "oauth" || coreBrowserCommissioningReady(statuses);
      progress.published = "Ready";
      next = "READY";
      await updateJob(job.id, {
        state: "READY",
        status: coreReady ? "ready" : "needs_attention",
        progress: { ...progress, humanStatus: coreReady ? "Ready" : "Core functions need setup" },
        optionalFailures: failures,
        discoveredOperationKeys: discovered,
        completedAt: new Date(),
        leaseExpiresAt: null,
      });
      return;
    }
    const waiting = next === "AWAIT_SAFE_TEST_RECORD";
    await updateJob(job.id, {
      state: next,
      status: waiting ? "waiting_for_approval" : "queued",
      progress: { ...progress, humanStatus: humanCommissioningStatus(next) },
      optionalFailures: failures,
      discoveredOperationKeys: discovered,
      leaseExpiresAt: null,
      lastError: null,
    });
    if (!waiting && next !== "READY") scheduleAutomaticCommissioning(job.id);
  } catch (error) {
    const detail = safeText(error instanceof Error ? error.message : String(error), 2_000);
    await updateJob(job.id, {
      status: "needs_attention",
      lastError: detail,
      leaseExpiresAt: null,
      progress: { ...(job.progress || {}), humanStatus: "Needs setup" },
    });
  }
}

export async function resumeAutomaticCommissioningJobs() {
  const db = await getDb();
  if (!db) return 0;
  const jobs = await db.select({ id: crmCommissioningJobs.id }).from(crmCommissioningJobs).where(and(
    inArray(crmCommissioningJobs.status, ["queued", "running"]),
    or(isNull(crmCommissioningJobs.leaseExpiresAt), lt(crmCommissioningJobs.leaseExpiresAt, new Date()))
  )).limit(100);
  jobs.forEach(job => scheduleAutomaticCommissioning(job.id));
  return jobs.length;
}

export function startAutomaticCommissioningWorker(intervalMs = 10_000) {
  void resumeAutomaticCommissioningJobs().catch(error =>
    console.error("[crm-commissioning] resume failed", {
      detail: error instanceof Error ? error.message : String(error),
    })
  );
  const timer = setInterval(
    () => void resumeAutomaticCommissioningJobs().catch(error =>
      console.error("[crm-commissioning] poll failed", {
        detail: error instanceof Error ? error.message : String(error),
      })
    ),
    Math.max(2_000, intervalMs)
  );
  timer.unref();
  return timer;
}
