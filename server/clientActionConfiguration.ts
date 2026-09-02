import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb } from "./db";

export type CommunicationChannel = "email" | "sms" | "whatsapp";
export type TemplateSourceKind =
  | "organisation_approved"
  | "crm_saved"
  | "client_configuration";

export type ConfiguredTemplate = {
  key: string;
  channel: CommunicationChannel;
  source: TemplateSourceKind;
  templateName: string;
  body?: string;
  requiredSubject?: string;
  senderIdentity?: string;
  sourceReference?: string;
  sourceVersion?: string;
  commissionedAt?: string;
};

export type WorkflowActionConfiguration = {
  /** Semantic task purpose -> exact client CRM task title/alias. */
  taskAliases: Record<string, string>;
  /** Ordered semantic task purposes for attempt/follow-up progression. */
  taskSequence: string[];
  /** Ordered action tokens, e.g. send_sms_template:first_contact. */
  sequence: string[];
  eligibilityStatuses: string[];
  stopStatuses: string[];
  opportunityMappings: Record<string, string>;
  statusMappings: Record<string, string>;
  /** Semantic template purpose -> configured template key. */
  templates: Record<string, string>;
  timingRules: Record<string, string>;
  duplicateRules: string[];
  requiredPostconditions: string[];
};

export type CrmCurrentRecordRule = {
  provider?: string;
  entity: "contact";
  pathPrefix?: string;
  idSegmentFromEnd?: number;
  idQueryParam?: string;
};

export type ClientActionConfiguration = {
  workflows: Record<string, WorkflowActionConfiguration>;
  templates: Record<string, ConfiguredTemplate>;
  approvedSenders: Partial<Record<CommunicationChannel, string[]>>;
  officeHours?: {
    timezone?: string;
    days: number[];
    start: string;
    end: string;
  };
  duplicateRules: string[];
  closureMapping: Record<string, string>;
  requiredPostconditions: Record<string, string[]>;
  currentRecordRules: CrmCurrentRecordRule[];
};

const EMPTY_WORKFLOW: WorkflowActionConfiguration = {
  taskAliases: {},
  taskSequence: [],
  sequence: [],
  eligibilityStatuses: [],
  stopStatuses: [],
  opportunityMappings: {},
  statusMappings: {},
  templates: {},
  timingRules: {},
  duplicateRules: [],
  requiredPostconditions: [],
};

export const EMPTY_CLIENT_ACTION_CONFIGURATION: ClientActionConfiguration = {
  workflows: {},
  templates: {},
  approvedSenders: {},
  duplicateRules: [],
  closureMapping: {},
  requiredPostconditions: {},
  currentRecordRules: [],
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown, maximum = 80) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
    )
  ).slice(0, maximum);
}

function stringMap(value: unknown, maximum = 100) {
  return Object.fromEntries(
    Object.entries(object(value))
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && Boolean(entry[1].trim())
      )
      .slice(0, maximum)
      .map(([key, item]) => [key.slice(0, 120), item.trim().slice(0, 240)])
  );
}

function workflow(value: unknown): WorkflowActionConfiguration {
  const source = object(value);
  return {
    ...EMPTY_WORKFLOW,
    taskAliases: stringMap(source.taskAliases),
    taskSequence: strings(source.taskSequence),
    sequence: strings(source.sequence),
    eligibilityStatuses: strings(source.eligibilityStatuses),
    stopStatuses: strings(source.stopStatuses),
    opportunityMappings: stringMap(source.opportunityMappings),
    statusMappings: stringMap(source.statusMappings),
    templates: stringMap(source.templates),
    timingRules: stringMap(source.timingRules),
    duplicateRules: strings(source.duplicateRules),
    requiredPostconditions: strings(source.requiredPostconditions),
  };
}

function optionalString(source: Record<string, unknown>, key: string, max: number) {
  const value = source[key];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function template(value: unknown, fallbackKey: string): ConfiguredTemplate | null {
  const source = object(value);
  const channel = source.channel;
  const sourceKind = source.source;
  const templateName =
    typeof source.templateName === "string" ? source.templateName.trim() : "";
  if (
    !["email", "sms", "whatsapp"].includes(String(channel)) ||
    !["organisation_approved", "crm_saved", "client_configuration"].includes(
      String(sourceKind)
    ) ||
    !templateName
  )
    return null;
  return {
    key:
      typeof source.key === "string" && source.key.trim()
        ? source.key.trim().slice(0, 120)
        : fallbackKey.slice(0, 120),
    channel: channel as CommunicationChannel,
    source: sourceKind as TemplateSourceKind,
    templateName: templateName.slice(0, 200),
    body:
      typeof source.body === "string" && source.body.trim()
        ? source.body.trim().slice(0, 30_000)
        : undefined,
    requiredSubject: optionalString(source, "requiredSubject", 240),
    senderIdentity: optionalString(source, "senderIdentity", 240),
    sourceReference: optionalString(source, "sourceReference", 500),
    sourceVersion: optionalString(source, "sourceVersion", 160),
    commissionedAt: optionalString(source, "commissionedAt", 80),
  };
}

function currentRecordRule(value: unknown): CrmCurrentRecordRule | null {
  const source = object(value);
  if (source.entity !== "contact") return null;
  const pathPrefix =
    typeof source.pathPrefix === "string" && source.pathPrefix.trim()
      ? source.pathPrefix.trim().slice(0, 300)
      : undefined;
  const idQueryParam =
    typeof source.idQueryParam === "string" &&
    /^[A-Za-z0-9_.:-]{1,80}$/.test(source.idQueryParam.trim())
      ? source.idQueryParam.trim()
      : undefined;
  const idSegmentFromEnd =
    Number.isInteger(source.idSegmentFromEnd) &&
    Number(source.idSegmentFromEnd) >= 1 &&
    Number(source.idSegmentFromEnd) <= 10
      ? Number(source.idSegmentFromEnd)
      : undefined;
  if (!idQueryParam && (!pathPrefix || !idSegmentFromEnd)) return null;
  return {
    provider:
      typeof source.provider === "string" && source.provider.trim()
        ? source.provider.trim().slice(0, 80)
        : undefined,
    entity: "contact",
    pathPrefix,
    idSegmentFromEnd,
    idQueryParam,
  };
}

function officeHours(value: unknown): ClientActionConfiguration["officeHours"] {
  const source = object(value);
  const start = typeof source.start === "string" ? source.start.trim() : "";
  const end = typeof source.end === "string" ? source.end.trim() : "";
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)
  )
    return undefined;
  const days = Array.isArray(source.days)
    ? Array.from(
        new Set(
          source.days
            .map(Number)
            .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      )
    : [];
  return {
    timezone:
      typeof source.timezone === "string" && source.timezone.trim()
        ? source.timezone.trim().slice(0, 100)
        : undefined,
    days,
    start,
    end,
  };
}

export function normalizeClientActionConfiguration(
  value: unknown
): ClientActionConfiguration {
  const source = object(value);
  const workflowSource = object(source.workflows);
  const templateSource = object(source.templates);
  const workflows = Object.fromEntries(
    Object.entries(workflowSource)
      .slice(0, 80)
      .map(([key, item]) => [key.slice(0, 120), workflow(item)])
  );
  const templates: Record<string, ConfiguredTemplate> = {};
  for (const [key, item] of Object.entries(templateSource).slice(0, 160)) {
    const parsed = template(item, key);
    if (parsed) templates[key.slice(0, 120)] = parsed;
  }
  const senderSource = object(source.approvedSenders);
  const requiredPostconditions = Object.fromEntries(
    Object.entries(object(source.requiredPostconditions))
      .slice(0, 100)
      .map(([key, item]) => [key.slice(0, 120), strings(item, 40)])
  );
  return {
    workflows,
    templates,
    approvedSenders: {
      email: strings(senderSource.email, 40),
      sms: strings(senderSource.sms, 40),
      whatsapp: strings(senderSource.whatsapp, 40),
    },
    officeHours: officeHours(source.officeHours),
    duplicateRules: strings(source.duplicateRules, 80),
    closureMapping: stringMap(source.closureMapping, 80),
    requiredPostconditions,
    currentRecordRules: Array.isArray(source.currentRecordRules)
      ? source.currentRecordRules
          .map(currentRecordRule)
          .filter((rule): rule is CrmCurrentRecordRule => Boolean(rule))
          .slice(0, 40)
      : [],
  };
}

export async function getClientActionConfiguration(input: {
  organisationId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const row = (
    await db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, input.organisationId))
      .limit(1)
  )[0];
  if (!row) throw new Error("Organisation was not found.");
  const settings = object(row.settings);
  return normalizeClientActionConfiguration(settings.salesAssistantConfig);
}

function stableExternalId(value: string | null | undefined) {
  if (!value) return undefined;
  const decoded = decodeURIComponent(value).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(decoded)
    ? decoded
    : undefined;
}

/**
 * Resolves only a stable CRM external identifier from an explicitly configured
 * URL rule. A displayed customer name is never treated as identity evidence.
 */
export function resolveConfiguredCurrentContact(input: {
  authorisedUrl: string;
  provider?: string;
  configuration: ClientActionConfiguration;
}) {
  let url: URL;
  try {
    url = new URL(input.authorisedUrl);
  } catch {
    return null;
  }
  for (const rule of input.configuration.currentRecordRules) {
    if (rule.provider && input.provider && rule.provider !== input.provider)
      continue;
    if (rule.idQueryParam) {
      const externalId = stableExternalId(url.searchParams.get(rule.idQueryParam));
      if (externalId)
        return {
          entity: "contact" as const,
          externalId,
          source: "configured_query_parameter" as const,
        };
    }
    if (
      rule.pathPrefix &&
      rule.idSegmentFromEnd &&
      url.pathname.startsWith(rule.pathPrefix)
    ) {
      const segments = url.pathname.split("/").filter(Boolean);
      const externalId = stableExternalId(
        segments[segments.length - rule.idSegmentFromEnd]
      );
      if (externalId)
        return {
          entity: "contact" as const,
          externalId,
          source: "configured_path_rule" as const,
        };
    }
  }
  return null;
}
