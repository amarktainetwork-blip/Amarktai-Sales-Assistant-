import { eq } from "drizzle-orm";
import { organisations } from "../drizzle/schema";
import { getDb } from "./db";
import {
  canManageOrganisationForUser,
  requireOrganisationMembership,
} from "./organisation";

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
  /** Semantic task purpose -> primary exact client CRM task title/alias. */
  taskAliases: Record<string, string>;
  /** Additional exact titles accepted for the same current-task purpose. */
  taskAliasAlternatives?: Record<string, string[]>;
  /** Ordered semantic task purposes for attempt/follow-up progression. */
  taskSequence: string[];
  /** Ordered action tokens, e.g. send_sms_template:first_contact. */
  sequence: string[];
  /** Optional exact action sequence by semantic current-task purpose. */
  sequenceByTaskPurpose?: Record<string, string[]>;
  /** Plain normalized substrings used to select a workflow variant from one current opportunity name. */
  opportunityNameContains?: string[];
  /**
   * Exact sequence tokens that may be skipped only when their exact current
   * target does not exist. Ambiguous multiple targets still fail closed.
   */
  optionalActions?: string[];
  eligibilityStatuses: string[];
  stopStatuses: string[];
  opportunityMappings: Record<string, string>;
  /** Optional current-stage -> target-stage maps for workflows whose outcome depends on the live current stage. */
  opportunityStageTransitions?: Record<string, Record<string, string>>;
  statusMappings: Record<string, string>;
  /** Semantic sequence purpose -> exact CRM sequence name. */
  sequenceMappings?: Record<string, string>;
  /** Extra reviewed fields to apply to the exact current opportunity for a semantic purpose. */
  opportunityFieldMappings?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  /** Extra reviewed fields to apply to the exact current contact for a semantic purpose. */
  contactFieldMappings?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  /** Static exact note text for a semantic purpose when no factual call outcome supplies the note. */
  noteMappings?: Record<string, string>;
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

export const SUPPORTED_CONFIGURED_WORKFLOW_ACTIONS = new Set([
  "verify_contact_context",
  "append_contact_note",
  "schedule_callback",
  "complete_active_task",
  "update_contact_status",
  "update_contact",
  "update_current_opportunity",
  "update_opportunity",
  "send_email_template",
  "send_sms_template",
  "send_whatsapp_template",
  "apply_sequence",
]);

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
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && Boolean(entry[1].trim())
      )
      .slice(0, maximum)
      .map(([key, item]) => [key.slice(0, 120), item.trim().slice(0, 240)])
  );
}

function stringArrayMap(value: unknown, maximum = 100, preserveEmpty = false) {
  return Object.fromEntries(
    Object.entries(object(value))
      .slice(0, maximum)
      .map(([purpose, raw]) => [purpose.slice(0, 120), strings(raw, 40)])
      .filter(([, values]) => preserveEmpty || (values as string[]).length)
  ) as Record<string, string[]>;
}

function nestedStringMap(value: unknown, maximum = 100) {
  return Object.fromEntries(
    Object.entries(object(value))
      .slice(0, maximum)
      .map(([purpose, mapping]) => [
        purpose.slice(0, 120),
        stringMap(mapping, 120),
      ])
      .filter(
        ([, mapping]) => Object.keys(mapping as Record<string, string>).length
      )
  ) as Record<string, Record<string, string>>;
}

function scalarFieldMap(value: unknown, maximum = 100) {
  const output: Record<
    string,
    Record<string, string | number | boolean | null>
  > = {};
  for (const [purpose, rawFields] of Object.entries(object(value)).slice(
    0,
    maximum
  )) {
    const fields: Record<string, string | number | boolean | null> = {};
    for (const [field, rawValue] of Object.entries(object(rawFields)).slice(
      0,
      80
    )) {
      const exactField = field.trim().slice(0, 120);
      if (
        !exactField ||
        /[\u0000-\u001f\u007f]/.test(exactField) ||
        ["__proto__", "prototype", "constructor"].includes(
          exactField.toLowerCase()
        )
      )
        continue;
      if (
        rawValue === null ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean"
      )
        fields[exactField] = rawValue;
      else if (typeof rawValue === "string" && rawValue.trim())
        fields[exactField] = rawValue.trim().slice(0, 2_000);
    }
    if (Object.keys(fields).length) output[purpose.slice(0, 120)] = fields;
  }
  return output;
}

function noteMap(value: unknown, maximum = 100) {
  return Object.fromEntries(
    Object.entries(object(value))
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && Boolean(entry[1].trim())
      )
      .slice(0, maximum)
      .map(([key, item]) => [key.slice(0, 120), item.trim().slice(0, 10_000)])
  );
}

function workflow(value: unknown): WorkflowActionConfiguration {
  const source = object(value);
  return {
    ...EMPTY_WORKFLOW,
    taskAliases: stringMap(source.taskAliases),
    taskAliasAlternatives: stringArrayMap(source.taskAliasAlternatives),
    taskSequence: strings(source.taskSequence),
    sequence: strings(source.sequence),
    sequenceByTaskPurpose: stringArrayMap(
      source.sequenceByTaskPurpose,
      100,
      true
    ),
    opportunityNameContains: strings(source.opportunityNameContains, 40),
    optionalActions: strings(source.optionalActions),
    eligibilityStatuses: strings(source.eligibilityStatuses),
    stopStatuses: strings(source.stopStatuses),
    opportunityMappings: stringMap(source.opportunityMappings),
    opportunityStageTransitions: nestedStringMap(
      source.opportunityStageTransitions
    ),
    statusMappings: stringMap(source.statusMappings),
    sequenceMappings: stringMap(source.sequenceMappings),
    opportunityFieldMappings: scalarFieldMap(source.opportunityFieldMappings),
    contactFieldMappings: scalarFieldMap(source.contactFieldMappings),
    noteMappings: noteMap(source.noteMappings),
    templates: stringMap(source.templates),
    timingRules: stringMap(source.timingRules),
    duplicateRules: strings(source.duplicateRules),
    requiredPostconditions: strings(source.requiredPostconditions),
  };
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  max: number
) {
  const value = source[key];
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function template(
  value: unknown,
  fallbackKey: string
): ConfiguredTemplate | null {
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

function normalizedKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function workflowToken(token: string) {
  const [rawAction, ...rest] = token.split(":");
  return {
    actionType: rawAction.trim(),
    purpose: rest.join(":").trim() || rawAction.trim(),
  };
}

function validateOfficeHoursSource(
  rawValue: unknown,
  normalized: ClientActionConfiguration["officeHours"]
) {
  if (rawValue == null) return;
  const raw = object(rawValue);
  if (!Object.keys(raw).length)
    throw new Error(
      "CLIENT_WORKFLOW_OFFICE_HOURS_INVALID: officeHours must be omitted or fully configured."
    );
  if (!normalized || !normalized.days.length || !normalized.timezone)
    throw new Error(
      "CLIENT_WORKFLOW_OFFICE_HOURS_INVALID: configure timezone, contact days and HH:MM start/end times."
    );
  const [startHour, startMinute] = normalized.start.split(":").map(Number);
  const [endHour, endMinute] = normalized.end.split(":").map(Number);
  if (startHour * 60 + startMinute >= endHour * 60 + endMinute)
    throw new Error(
      "CLIENT_WORKFLOW_OFFICE_HOURS_INVALID: end time must be later than start time on the same day."
    );
  try {
    new Intl.DateTimeFormat("en-GB", {
      timeZone: normalized.timezone,
    }).format(new Date());
  } catch {
    throw new Error(
      `CLIENT_WORKFLOW_OFFICE_HOURS_INVALID: '${normalized.timezone}' is not a valid timezone.`
    );
  }
}

function expectedTemplateChannel(
  actionType: string
): CommunicationChannel | undefined {
  if (actionType === "send_email_template") return "email";
  if (actionType === "send_sms_template") return "sms";
  if (actionType === "send_whatsapp_template") return "whatsapp";
  return undefined;
}

function validateWorkflowTemplate(input: {
  workflowKey: string;
  actionType: string;
  purpose: string;
  workflow: WorkflowActionConfiguration;
  configuration: ClientActionConfiguration;
}) {
  const channel = expectedTemplateChannel(input.actionType);
  if (!channel) return;
  const templateKey = input.workflow.templates[input.purpose];
  if (!templateKey)
    throw new Error(
      `CLIENT_WORKFLOW_TEMPLATE_MAPPING_REQUIRED: '${input.workflowKey}' must map '${input.purpose}' to an approved ${channel.toUpperCase()} template.`
    );
  const template = input.configuration.templates[templateKey];
  if (!template)
    throw new Error(
      `CLIENT_WORKFLOW_TEMPLATE_REQUIRED: configured template '${templateKey}' does not exist.`
    );
  if (template.channel !== channel)
    throw new Error(
      `CLIENT_WORKFLOW_TEMPLATE_CHANNEL_MISMATCH: '${templateKey}' is ${template.channel}, not ${channel}.`
    );
  if (template.source !== "organisation_approved" && !template.body)
    throw new Error(
      `CLIENT_WORKFLOW_TEMPLATE_CONTENT_REQUIRED: '${templateKey}' must contain the exact commissioned template body.`
    );
  if (
    channel === "email" &&
    template.source !== "organisation_approved" &&
    !template.requiredSubject
  )
    throw new Error(
      `CLIENT_WORKFLOW_TEMPLATE_SUBJECT_REQUIRED: '${templateKey}' must preserve its exact approved email subject.`
    );
  if (channel !== "email") {
    const approved = input.configuration.approvedSenders[channel] || [];
    if (template.senderIdentity && !approved.includes(template.senderIdentity))
      throw new Error(
        `CLIENT_WORKFLOW_SENDER_NOT_APPROVED: '${template.senderIdentity}' is not an approved ${channel.toUpperCase()} sender.`
      );
    if (!template.senderIdentity && approved.length !== 1)
      throw new Error(
        `CLIENT_WORKFLOW_SENDER_REQUIRED: '${templateKey}' needs one unambiguous approved ${channel.toUpperCase()} sender.`
      );
  }
}

export function validateClientActionConfigurationForCommissioning(
  value: unknown
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "CLIENT_WORKFLOW_CONFIGURATION_INVALID: configuration must be a JSON object."
    );
  const source = value as Record<string, unknown>;
  const configuration = normalizeClientActionConfiguration(source);
  validateOfficeHoursSource(source.officeHours, configuration.officeHours);

  for (const [workflowKey, workflow] of Object.entries(
    configuration.workflows
  )) {
    const sequenceTitles = workflow.taskSequence.map(purpose => {
      const title = workflow.taskAliases[purpose]?.trim();
      if (!title)
        throw new Error(
          `CLIENT_WORKFLOW_TASK_ALIAS_REQUIRED: '${workflowKey}' task purpose '${purpose}' has no exact CRM task title.`
        );
      return title;
    });
    if (
      new Set(sequenceTitles.map(normalizedKey)).size !== sequenceTitles.length
    )
      throw new Error(
        `CLIENT_WORKFLOW_TASK_ALIAS_DUPLICATE: '${workflowKey}' contains duplicate task titles in its progression.`
      );
    for (const [purpose, alternatives] of Object.entries(
      workflow.taskAliasAlternatives || {}
    )) {
      if (!workflow.taskAliases[purpose])
        throw new Error(
          `CLIENT_WORKFLOW_TASK_ALIAS_REQUIRED: '${workflowKey}' alternative titles for '${purpose}' require one primary exact CRM task title.`
        );
      const all = [workflow.taskAliases[purpose], ...alternatives].map(
        normalizedKey
      );
      if (new Set(all).size !== all.length)
        throw new Error(
          `CLIENT_WORKFLOW_TASK_ALIAS_DUPLICATE: '${workflowKey}' contains duplicate primary/alternative task titles for '${purpose}'.`
        );
    }
    const progressionAliases = workflow.taskSequence.flatMap(purpose =>
      [
        workflow.taskAliases[purpose],
        ...(workflow.taskAliasAlternatives?.[purpose] || []),
      ].map(normalizedKey)
    );
    if (new Set(progressionAliases).size !== progressionAliases.length)
      throw new Error(
        `CLIENT_WORKFLOW_TASK_ALIAS_DUPLICATE: '${workflowKey}' maps one task title to multiple outreach purposes.`
      );
    for (const purpose of Object.keys(workflow.sequenceByTaskPurpose || {})) {
      if (!workflow.taskSequence.includes(purpose))
        throw new Error(
          "CLIENT_WORKFLOW_TASK_SEQUENCE_PURPOSE_INVALID: '" +
            workflowKey +
            "' has an action sequence for unknown task purpose '" +
            purpose +
            "'."
        );
    }
    if (
      Object.values(workflow.sequenceByTaskPurpose || {}).some(
        sequence => !sequence.length
      )
    )
      throw new Error(
        `CLIENT_WORKFLOW_TASK_SEQUENCE_EMPTY: '${workflowKey}' contains an empty attempt-specific sequence.`
      );
    const allActionTokens = Array.from(
      new Set([
        ...workflow.sequence,
        ...Object.values(workflow.sequenceByTaskPurpose || {}).flat(),
      ])
    );
    const unknownOptional = (workflow.optionalActions || []).find(
      token => !allActionTokens.includes(token)
    );
    if (unknownOptional)
      throw new Error(
        `CLIENT_WORKFLOW_OPTIONAL_ACTION_INVALID: '${unknownOptional}' is not present in workflow '${workflowKey}' sequence.`
      );
    const stop = new Set(workflow.stopStatuses.map(normalizedKey));
    const overlap = workflow.eligibilityStatuses.find(status =>
      stop.has(normalizedKey(status))
    );
    if (overlap)
      throw new Error(
        `CLIENT_WORKFLOW_STATUS_CONFLICT: '${overlap}' is both eligible and a stop status in '${workflowKey}'.`
      );

    if (workflow.taskSequence.length > 1) {
      for (const purpose of workflow.taskSequence.slice(1)) {
        if (!workflow.timingRules[purpose] && !workflow.timingRules.follow_up)
          throw new Error(
            `CLIENT_WORKFLOW_TIMING_REQUIRED: '${workflowKey}' has no timing rule for next task purpose '${purpose}'.`
          );
      }
    }

    for (const token of allActionTokens) {
      const { actionType, purpose } = workflowToken(token);
      if (!SUPPORTED_CONFIGURED_WORKFLOW_ACTIONS.has(actionType))
        throw new Error(
          `CLIENT_WORKFLOW_ACTION_INVALID: '${workflowKey}' uses unsupported action '${actionType}'.`
        );
      validateWorkflowTemplate({
        workflowKey,
        actionType,
        purpose,
        workflow,
        configuration,
      });
      if (
        actionType === "complete_active_task" &&
        !workflow.taskAliases[purpose]
      )
        throw new Error(
          `CLIENT_WORKFLOW_TASK_ALIAS_REQUIRED: '${workflowKey}' must map '${purpose}' to the exact current task title before it can complete a task.`
        );
      if (
        actionType === "schedule_callback" &&
        !workflow.taskSequence.length &&
        !workflow.taskAliases[purpose]
      )
        throw new Error(
          `CLIENT_WORKFLOW_TASK_ALIAS_REQUIRED: '${workflowKey}' must map callback purpose '${purpose}' to an exact CRM task title.`
        );
      if (
        ["update_current_opportunity", "update_opportunity"].includes(
          actionType
        ) &&
        !workflow.opportunityMappings[purpose] &&
        !Object.keys(workflow.opportunityStageTransitions?.[purpose] || {})
          .length
      )
        throw new Error(
          `CLIENT_WORKFLOW_OPPORTUNITY_MAPPING_REQUIRED: '${workflowKey}' must map '${purpose}' to an exact CRM opportunity stage or current-stage transition table.`
        );
      if (
        actionType === "update_contact_status" &&
        !workflow.statusMappings[purpose] &&
        !configuration.closureMapping[purpose]
      )
        throw new Error(
          `CLIENT_WORKFLOW_STATUS_MAPPING_REQUIRED: '${workflowKey}' must map '${purpose}' to an exact CRM contact status.`
        );
      if (
        actionType === "apply_sequence" &&
        !workflow.sequenceMappings?.[purpose]
      )
        throw new Error(
          `CLIENT_WORKFLOW_SEQUENCE_MAPPING_REQUIRED: '${workflowKey}' must map '${purpose}' to an exact CRM sequence name.`
        );
    }
  }

  return {
    valid: true as const,
    configuration,
    workflowKeys: Object.keys(configuration.workflows),
    templateKeys: Object.keys(configuration.templates),
  };
}

export async function saveClientActionConfiguration(input: {
  userId: number;
  organisationId: number;
  configuration: unknown;
}) {
  const membership = await requireOrganisationMembership(
    input.userId,
    input.organisationId
  );
  if (!(await canManageOrganisationForUser(input.userId, membership.role)))
    throw new Error(
      "Only organisation owners and managers can change client workflow rules."
    );
  const validated = validateClientActionConfigurationForCommissioning(
    input.configuration
  );
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
  await db
    .update(organisations)
    .set({
      settings: {
        ...settings,
        salesAssistantConfig: validated.configuration,
      },
    })
    .where(eq(organisations.id, input.organisationId));
  return validated;
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
      const externalId = stableExternalId(
        url.searchParams.get(rule.idQueryParam)
      );
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
