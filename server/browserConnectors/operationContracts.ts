import { createHash } from "node:crypto";
import {
  validateSavedBrowserScript,
  type BrowserScriptStep,
  type SavedBrowserScript,
} from "./scriptEngine";

export const BROWSER_OPERATION_STATUSES = [
  "NOT_LEARNED",
  "LEARNED",
  "TEST_READY",
  "LIVE_PROVEN",
  "DEGRADED",
  "BLOCKED",
] as const;
export type BrowserOperationStatus =
  (typeof BROWSER_OPERATION_STATUSES)[number];
export type BrowserOperationMode = "read" | "write";

export type BrowserTargetIdentity = {
  externalId?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  opportunityId?: string;
  taskId?: string;
};

export type BrowserPostcondition = {
  actualKey: string;
  expectedInput?: string;
  expectedValue?: string;
  comparator?: "equals" | "contains" | "exists" | "not_equals";
};

export type LearnedBrowserOperationDefinition = {
  mode: BrowserOperationMode;
  targetRead?: SavedBrowserScript;
  execute: SavedBrowserScript;
  postconditionRead?: SavedBrowserScript;
  resultKey?: string;
  cursorKey?: string;
};

export type GuidedBrowserStep = Pick<
  BrowserScriptStep,
  "action" | "selector" | "value"
>;
export type GuidedReadOutput = {
  action: "read_text" | "read_value" | "read_rows";
  selector: string;
  key: string;
  fields?: Array<{ key: string; selector?: string; attribute?: string }>;
};
export type GuidedTargetReview = {
  rowSelector: string;
  mode?: "must_match" | "must_not_exist";
  fields: Array<{
    key: keyof BrowserTargetIdentity;
    selector?: string;
    attribute?: string;
  }>;
};
export type GuidedPostconditionReview = {
  action: "read_text" | "read_value" | "read_attribute";
  selector: string;
  key: string;
  attribute?: string;
  expectedInput?: string;
  expectedValue?: string;
  comparator?: "equals" | "contains" | "exists" | "not_equals";
};
export type GuidedBrowserOperationReview = {
  steps: GuidedBrowserStep[];
  output?: GuidedReadOutput;
  target?: GuidedTargetReview;
  postcondition?: GuidedPostconditionReview;
};

export type BrowserOperationCatalogueItem = {
  key: string;
  label: string;
  area: string;
  mode: BrowserOperationMode;
  capability?: string;
  safeWatchdog: boolean;
};

export const BROWSER_OPERATION_CATALOGUE: BrowserOperationCatalogueItem[] = [
  {
    key: "auth.login",
    label: "Login",
    area: "Authentication",
    mode: "read",
    safeWatchdog: true,
  },
  {
    key: "home.open",
    label: "Open CRM home",
    area: "Getting started",
    mode: "read",
    capability: "home.read",
    safeWatchdog: true,
  },
  {
    key: "prospect.next",
    label: "Open next prospect or task",
    area: "Selling",
    mode: "read",
    capability: "next_prospect.read",
    safeWatchdog: true,
  },
  {
    key: "contact.search",
    label: "Search contacts",
    area: "Contacts",
    mode: "read",
    capability: "contacts.read",
    safeWatchdog: true,
  },
  {
    key: "contact.open",
    label: "Open exact contact",
    area: "Contacts",
    mode: "read",
    capability: "contacts.read",
    safeWatchdog: true,
  },
  {
    key: "contact.read",
    label: "Read contact",
    area: "Contacts",
    mode: "read",
    capability: "contacts.read",
    safeWatchdog: true,
  },
  {
    key: "contact.sync",
    label: "Synchronise contacts",
    area: "Sync",
    mode: "read",
    capability: "contacts.read",
    safeWatchdog: true,
  },
  {
    key: "contact.create",
    label: "Create contact",
    area: "Contacts",
    mode: "write",
    capability: "contacts.write",
    safeWatchdog: false,
  },
  {
    key: "company.sync",
    label: "Synchronise companies",
    area: "Sync",
    mode: "read",
    capability: "companies.read",
    safeWatchdog: true,
  },
  {
    key: "company.read",
    label: "Read company",
    area: "Contacts",
    mode: "read",
    capability: "companies.read",
    safeWatchdog: true,
  },
  {
    key: "company.create",
    label: "Create company",
    area: "Contacts",
    mode: "write",
    capability: "companies.write",
    safeWatchdog: false,
  },
  {
    key: "history.read",
    label: "Read conversation history",
    area: "History",
    mode: "read",
    capability: "activities.read",
    safeWatchdog: true,
  },
  {
    key: "note.read",
    label: "Read notes",
    area: "History",
    mode: "read",
    capability: "notes.read",
    safeWatchdog: true,
  },
  {
    key: "interaction.latest",
    label: "Read latest interaction",
    area: "History",
    mode: "read",
    capability: "activities.read",
    safeWatchdog: true,
  },
  {
    key: "communication.context",
    label: "Read communication context",
    area: "History",
    mode: "read",
    capability: "activities.read",
    safeWatchdog: true,
  },
  {
    key: "manual_action.sync",
    label: "Synchronise Manual Actions",
    area: "Tasks / Manual Actions",
    mode: "read",
    capability: "tasks.read",
    safeWatchdog: true,
  },
  {
    key: "task.list",
    label: "List tasks",
    area: "Tasks / Manual Actions",
    mode: "read",
    capability: "tasks.read",
    safeWatchdog: true,
  },
  {
    key: "task.read",
    label: "Read task",
    area: "Tasks / Manual Actions",
    mode: "read",
    capability: "tasks.read",
    safeWatchdog: true,
  },
  {
    key: "task.sync",
    label: "Synchronise tasks",
    area: "Sync",
    mode: "read",
    capability: "tasks.read",
    safeWatchdog: true,
  },
  {
    key: "task.complete",
    label: "Complete task",
    area: "Tasks / Manual Actions",
    mode: "write",
    capability: "tasks.write",
    safeWatchdog: false,
  },
  {
    key: "task.create_callback",
    label: "Create callback",
    area: "Tasks / Manual Actions",
    mode: "write",
    capability: "tasks.write",
    safeWatchdog: false,
  },
  {
    key: "task.create",
    label: "Create task",
    area: "Tasks / Manual Actions",
    mode: "write",
    capability: "tasks.write",
    safeWatchdog: false,
  },
  {
    key: "note.create",
    label: "Add and verify note",
    area: "Notes",
    mode: "write",
    capability: "notes.write",
    safeWatchdog: false,
  },
  {
    key: "opportunity.read",
    label: "Read opportunity",
    area: "Opportunities",
    mode: "read",
    capability: "opportunities.read",
    safeWatchdog: true,
  },
  {
    key: "opportunity.sync",
    label: "Synchronise opportunities",
    area: "Sync",
    mode: "read",
    capability: "opportunities.read",
    safeWatchdog: true,
  },
  {
    key: "opportunity.update",
    label: "Update opportunity",
    area: "Opportunities",
    mode: "write",
    capability: "opportunities.write",
    safeWatchdog: false,
  },
  {
    key: "opportunity.create",
    label: "Create opportunity",
    area: "Opportunities",
    mode: "write",
    capability: "opportunities.write",
    safeWatchdog: false,
  },
  {
    key: "contact.update",
    label: "Update contact status",
    area: "Contacts",
    mode: "write",
    capability: "contacts.write",
    safeWatchdog: false,
  },
  {
    key: "activity.sync",
    label: "Synchronise activities",
    area: "Sync",
    mode: "read",
    capability: "activities.read",
    safeWatchdog: true,
  },
  {
    key: "activity.create",
    label: "Create activity",
    area: "History",
    mode: "write",
    capability: "activities.write",
    safeWatchdog: false,
  },
  {
    key: "owner.sync",
    label: "Read owners",
    area: "Pipeline",
    mode: "read",
    capability: "owners.read",
    safeWatchdog: true,
  },
  {
    key: "pipeline.list",
    label: "Read pipelines and stages",
    area: "Pipeline",
    mode: "read",
    capability: "pipelines.read",
    safeWatchdog: true,
  },
  {
    key: "stage.read",
    label: "Read current stage and status",
    area: "Pipeline",
    mode: "read",
    capability: "pipelines.read",
    safeWatchdog: true,
  },
  {
    key: "stage.update",
    label: "Update opportunity stage",
    area: "Pipeline",
    mode: "write",
    capability: "stage.write",
    safeWatchdog: false,
  },
  {
    key: "owner.assign",
    label: "Assign owner",
    area: "Pipeline",
    mode: "write",
    capability: "owners.write",
    safeWatchdog: false,
  },
  {
    key: "dialler.launch",
    label: "Launch CRM dialler",
    area: "Communication",
    mode: "write",
    capability: "dialler.launch",
    safeWatchdog: false,
  },
  {
    key: "email.send",
    label: "Send template email",
    area: "Communication",
    mode: "write",
    capability: "email.send",
    safeWatchdog: false,
  },
  {
    key: "sms.send",
    label: "Send template SMS",
    area: "Communication",
    mode: "write",
    capability: "sms.send",
    safeWatchdog: false,
  },
  {
    key: "whatsapp.send",
    label: "Send template WhatsApp",
    area: "Communication",
    mode: "write",
    capability: "whatsapp.send",
    safeWatchdog: false,
  },
  {
    key: "sequence.apply",
    label: "Apply approved sequence",
    area: "Communication",
    mode: "write",
    capability: "sequences.apply",
    safeWatchdog: false,
  },
  {
    key: "appointment.book",
    label: "Book appointment",
    area: "Communication",
    mode: "write",
    capability: "appointments.write",
    safeWatchdog: false,
  },
  {
    key: "quote.create",
    label: "Create or send quote",
    area: "Communication",
    mode: "write",
    capability: "quotes.write",
    safeWatchdog: false,
  },
  {
    key: "workflow.execute",
    label: "Run permitted CRM workflow",
    area: "Automation",
    mode: "write",
    capability: "workflows.execute",
    safeWatchdog: false,
  },
];

export const ADAPTER_OPERATION_KEYS: Record<string, string> = {
  healthCheck: "auth.login",
  searchContacts: "contact.search",
  getContact: "contact.read",
  syncContacts: "contact.sync",
  createContact: "contact.create",
  syncCompanies: "company.sync",
  getCompany: "company.read",
  createCompany: "company.create",
  syncTasks: "task.sync",
  completeTask: "task.complete",
  createTask: "task.create",
  createCallback: "task.create_callback",
  getOpportunity: "opportunity.read",
  syncOpportunities: "opportunity.sync",
  updateOpportunity: "opportunity.update",
  createOpportunity: "opportunity.create",
  updateContact: "contact.update",
  syncActivities: "activity.sync",
  createActivity: "activity.create",
  createNote: "note.create",
  listPipelines: "pipeline.list",
  sendEmail: "email.send",
  sendSms: "sms.send",
  sendWhatsApp: "whatsapp.send",
  applySequence: "sequence.apply",
};

const CAPABILITY_REQUIREMENTS: Record<string, string[]> = {
  "home.read": ["home.open"],
  "next_prospect.read": ["prospect.next"],
  "contacts.read": ["contact.search", "contact.read", "contact.sync"],
  "contacts.write": ["contact.create", "contact.update"],
  "companies.read": ["company.read", "company.sync"],
  "companies.write": ["company.create"],
  "opportunities.read": ["opportunity.read", "opportunity.sync"],
  "opportunities.write": ["opportunity.create", "opportunity.update"],
  "tasks.read": ["task.list", "task.read", "task.sync"],
  "tasks.write": ["task.create", "task.complete", "task.create_callback"],
  "activities.read": [
    "history.read",
    "interaction.latest",
    "communication.context",
    "activity.sync",
  ],
  "activities.write": ["activity.create"],
  "notes.read": ["note.read"],
  "notes.write": ["note.create"],
  "owners.read": ["owner.sync"],
  "owners.write": ["owner.assign"],
  "pipelines.read": ["pipeline.list"],
  "stage.write": ["stage.update"],
  "email.send": ["email.send"],
  "sms.send": ["sms.send"],
  "whatsapp.send": ["whatsapp.send"],
  "sequences.apply": ["sequence.apply"],
  "dialler.launch": ["dialler.launch"],
  "appointments.write": ["appointment.book"],
  "quotes.write": ["quote.create"],
  "workflows.execute": ["workflow.execute"],
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Browser operation configuration must be an object.");
  return value as Record<string, unknown>;
}

export function validateOperationKey(value: string) {
  const key = value.trim();
  if (!/^[a-z][a-z0-9_.:-]{2,119}$/.test(key))
    throw new Error("A valid browser operation key is required.");
  return key;
}

export function assertBrowserOperationScope(
  operation: { organisationId: number; connectedSystemId: number },
  expected: { organisationId: number; connectedSystemId: number }
) {
  if (operation.organisationId !== expected.organisationId)
    throw new Error("OPERATION_ORGANISATION_MISMATCH");
  if (operation.connectedSystemId !== expected.connectedSystemId)
    throw new Error("OPERATION_CONNECTED_SYSTEM_MISMATCH");
}

export function assertBrowserOperationRuntimeStatus(
  status: BrowserOperationStatus | undefined,
  allowTestReady = false
) {
  if (!status || status === "NOT_LEARNED")
    throw new Error("OPERATION_NOT_LEARNED");
  if (status !== "LIVE_PROVEN" && !(allowTestReady && status === "TEST_READY"))
    throw new Error(`OPERATION_NOT_LIVE_PROVEN: operation is ${status}`);
}

export function validateLearnedOperationDefinition(
  value: unknown
): LearnedBrowserOperationDefinition {
  const source = object(value);
  const mode =
    source.mode === "read" || source.mode === "write" ? source.mode : undefined;
  if (!mode)
    throw new Error(
      "Browser operations must explicitly declare read or write mode."
    );
  const execute = validateSavedBrowserScript(
    object(source.execute) as unknown as SavedBrowserScript
  );
  const targetRead = source.targetRead
    ? validateSavedBrowserScript(
        object(source.targetRead) as unknown as SavedBrowserScript
      )
    : undefined;
  const postconditionRead = source.postconditionRead
    ? validateSavedBrowserScript(
        object(source.postconditionRead) as unknown as SavedBrowserScript
      )
    : undefined;
  if (mode === "write" && !targetRead)
    throw new Error(
      "A browser write operation requires a deterministic target-read script."
    );
  if (mode === "write" && !postconditionRead)
    throw new Error(
      "A browser write operation requires a deterministic postcondition-read script."
    );
  return {
    mode,
    targetRead,
    execute,
    postconditionRead,
    resultKey:
      typeof source.resultKey === "string"
        ? source.resultKey.slice(0, 120)
        : undefined,
    cursorKey:
      typeof source.cursorKey === "string"
        ? source.cursorKey.slice(0, 120)
        : undefined,
  };
}

export function operationChecksum(input: {
  operationKey: string;
  definition: unknown;
  prerequisites?: unknown;
  targetAssertions?: unknown;
  postconditionAssertions?: unknown;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function clean(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value === undefined || value === null
      ? ""
      : String(value).trim();
}
function normalized(field: keyof BrowserTargetIdentity, value: unknown) {
  const text = clean(value);
  if (field === "email") return text.toLowerCase();
  if (field === "phone")
    return text.replace(/[^0-9+]/g, "").replace(/^00/, "+");
  return text.toLowerCase().replace(/\s+/g, " ");
}

export type GuardianDecision = {
  ok: boolean;
  code:
    | "TARGET_VERIFIED"
    | "TARGET_IDENTITY_REQUIRED"
    | "TARGET_MISMATCH"
    | "AMBIGUOUS_TARGET";
  matchedFields: string[];
  detail: string;
};

/** External ID, or two non-conflicting stable fields, is required for writes. */
export function verifyBrowserTarget(
  expected: BrowserTargetIdentity,
  candidates: BrowserTargetIdentity[]
): GuardianDecision {
  const expectedFields = Object.entries(expected).filter(([, value]) =>
    clean(value)
  ) as Array<[keyof BrowserTargetIdentity, string]>;
  if (!expectedFields.length)
    return {
      ok: false,
      code: "TARGET_IDENTITY_REQUIRED",
      matchedFields: [],
      detail: "No stable expected CRM identifier was supplied.",
    };
  const evaluations = candidates.map(candidate => {
    const matched: string[] = [];
    const mismatched: string[] = [];
    for (const [field, value] of expectedFields) {
      const current = candidate[field];
      if (!clean(current)) continue;
      if (normalized(field, current) === normalized(field, value))
        matched.push(field);
      else mismatched.push(field);
    }
    const externalIdMatched =
      matched.includes("externalId") ||
      matched.includes("taskId") ||
      matched.includes("opportunityId");
    return {
      matched,
      mismatched,
      verified:
        mismatched.length === 0 && (externalIdMatched || matched.length >= 2),
    };
  });
  const verified = evaluations.filter(item => item.verified);
  if (verified.length > 1)
    return {
      ok: false,
      code: "AMBIGUOUS_TARGET",
      matchedFields: verified.flatMap(item => item.matched),
      detail: `${verified.length} CRM records satisfy the supplied identifiers; add an exact external record ID.`,
    };
  if (verified.length === 1)
    return {
      ok: true,
      code: "TARGET_VERIFIED",
      matchedFields: verified[0].matched,
      detail: `Target identity verified using ${verified[0].matched.join(", ")}.`,
    };
  if (candidates.length > 1)
    return {
      ok: false,
      code: "AMBIGUOUS_TARGET",
      matchedFields: [],
      detail: `${candidates.length} CRM records were found but none can be selected deterministically.`,
    };
  return {
    ok: false,
    code: candidates.length ? "TARGET_MISMATCH" : "TARGET_IDENTITY_REQUIRED",
    matchedFields: evaluations[0]?.matched ?? [],
    detail: candidates.length
      ? "The open CRM record does not match the expected stable identifiers."
      : "The CRM did not return a target record to verify.",
  };
}

export function verifyBrowserCreateTarget(
  expected: BrowserTargetIdentity,
  candidates: BrowserTargetIdentity[]
): GuardianDecision {
  const stable = Object.entries(expected).filter(([, value]) => clean(value));
  if (stable.length < 2 && !clean(expected.externalId))
    return {
      ok: false,
      code: "TARGET_IDENTITY_REQUIRED",
      matchedFields: [],
      detail:
        "Creating a CRM record requires at least two stable intended identifiers.",
    };
  if (candidates.length)
    return {
      ok: false,
      code: candidates.length > 1 ? "AMBIGUOUS_TARGET" : "TARGET_MISMATCH",
      matchedFields: [],
      detail:
        "A matching CRM record already exists; creation was blocked to prevent a duplicate.",
    };
  return {
    ok: true,
    code: "TARGET_VERIFIED",
    matchedFields: stable.map(([field]) => field),
    detail:
      "The intended new record has stable identifiers and deterministic search found no existing match.",
  };
}

export function verifyBrowserPostconditions(
  assertions: BrowserPostcondition[],
  actual: Record<string, string>,
  inputs: Record<string, unknown>
) {
  if (!assertions.length)
    return {
      ok: false,
      code: "EXECUTION_UNVERIFIED" as const,
      failures: ["No postcondition assertions are configured."],
    };
  const failures: string[] = [];
  for (const assertion of assertions) {
    const current = clean(actual[assertion.actualKey]);
    const expected = clean(
      assertion.expectedInput
        ? inputs[assertion.expectedInput]
        : assertion.expectedValue
    );
    const comparator = assertion.comparator ?? "equals";
    const passed =
      comparator === "exists"
        ? Boolean(current)
        : comparator === "contains"
          ? Boolean(expected) && current.includes(expected)
          : comparator === "not_equals"
            ? current !== expected
            : current === expected;
    if (!passed)
      failures.push(`${assertion.actualKey} did not satisfy ${comparator}.`);
  }
  return failures.length
    ? { ok: false, code: "EXECUTION_UNVERIFIED" as const, failures }
    : { ok: true, code: "POSTCONDITION_VERIFIED" as const, failures: [] };
}

export function deriveBrowserCapabilityReadiness(
  statuses: Record<string, BrowserOperationStatus>,
  capability: string
) {
  const required = CAPABILITY_REQUIREMENTS[capability] ?? [];
  const live = required.filter(key => statuses[key] === "LIVE_PROVEN");
  return {
    capability,
    state:
      !required.length || !live.length
        ? ("NOT_READY" as const)
        : live.length === required.length
          ? ("FULL" as const)
          : ("LIMITED" as const),
    requiredOperations: required,
    liveOperations: live,
    missingOperations: required.filter(key => statuses[key] !== "LIVE_PROVEN"),
  };
}

const secretName =
  /password|passcode|secret|token|cookie|authorization|bearer|csrf|credit.?card|security/i;
const allowedAttributes = new Set([
  "id",
  "name",
  "type",
  "role",
  "aria-label",
  "aria-labelledby",
  "data-testid",
  "data-test",
  "data-qa",
  "title",
]);

function trainingUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname
      .split("/")
      .map(segment =>
        /@|^\d{3,}$|^[0-9a-f]{8,}(?:-[0-9a-f-]+)?$/i.test(
          decodeURIComponent(segment)
        )
          ? ":record"
          : segment
      )
      .join("/");
    return url.toString().slice(0, 2_000);
  } catch {
    return undefined;
  }
}

function placeholder(event: Record<string, unknown>) {
  const semantic =
    `${clean(event.name)} ${clean(event.label)} ${clean(event.inputName)}`.toLowerCase();
  if (/email/.test(semantic)) return "{{contactEmail}}";
  if (/phone|mobile|tel/.test(semantic)) return "{{contactPhone}}";
  if (/note|comment|history/.test(semantic)) return "{{noteBody}}";
  if (/callback|due|date|time/.test(semantic)) return "{{callbackAt}}";
  if (/template/.test(semantic)) return "{{templateName}}";
  if (/name|contact|candidate/.test(semantic)) return "{{contactName}}";
  return "{{value}}";
}

/** Converts sidecar capture into semantic, value-free training evidence. */
export function sanitizeTrainingCapture(events: unknown[]) {
  if (!Array.isArray(events) || !events.length || events.length > 80)
    throw new Error(
      "Training capture must contain between one and eighty steps."
    );
  return events.map((item, index) => {
    const event = object(item);
    const inputType = clean(event.inputType || event.type).toLowerCase();
    const semanticName = `${clean(event.name)} ${clean(event.label)} ${clean(event.inputName)}`;
    if (
      inputType === "password" ||
      inputType === "hidden" ||
      secretName.test(semanticName)
    ) {
      return {
        index,
        action: clean(event.action || event.kind || "input"),
        redacted: true,
        reason: "sensitive_field",
      };
    }
    const attributes =
      event.attributes &&
      typeof event.attributes === "object" &&
      !Array.isArray(event.attributes)
        ? Object.fromEntries(
            Object.entries(event.attributes as Record<string, unknown>)
              .filter(
                ([key, value]) =>
                  allowedAttributes.has(key.toLowerCase()) &&
                  !secretName.test(key) &&
                  typeof value === "string"
              )
              .map(([key, value]) => [key, String(value).slice(0, 500)])
          )
        : undefined;
    const action = clean(event.action || event.kind || "unknown").slice(0, 80);
    return {
      index,
      action,
      url: trainingUrl(event.url),
      role: clean(event.role).slice(0, 120) || undefined,
      name: clean(event.name).slice(0, 500) || undefined,
      label: clean(event.label).slice(0, 500) || undefined,
      selector: clean(event.selector).slice(0, 2_000) || undefined,
      attributes,
      value: /input|fill|select/i.test(action) ? placeholder(event) : undefined,
    };
  });
}

const guidedCaptureActions = new Set([
  "click",
  "fill",
  "select",
  "select_option",
  "check",
  "uncheck",
  "press",
]);

/** Proposes declarative replay steps from already-sanitized capture evidence. */
export function proposeGuidedBrowserSteps(capture: unknown[]) {
  const events = sanitizeTrainingCapture(capture);
  const steps: GuidedBrowserStep[] = [];
  const firstUrl = events.find(event => event.url)?.url;
  if (firstUrl) steps.push({ action: "goto", value: firstUrl });
  for (const event of events) {
    if (
      event.redacted ||
      !guidedCaptureActions.has(event.action) ||
      !event.selector
    )
      continue;
    const action = event.action === "select" ? "select_option" : event.action;
    steps.push({
      action: action as GuidedBrowserStep["action"],
      selector: event.selector,
      value:
        action === "fill" || action === "select_option" || action === "press"
          ? event.value || "{{value}}"
          : undefined,
    });
  }
  if (!steps.length)
    throw new Error("The demonstration contains no reviewable browser steps.");
  return steps;
}

function guidedFields(
  fields: Array<{ key: string; selector?: string; attribute?: string }>
) {
  if (!fields.length || fields.length > 40)
    throw new Error(
      "Choose between one and forty structured extraction fields."
    );
  const result: Record<string, { selector?: string; attribute?: string }> = {};
  for (const field of fields) {
    const key = clean(field.key);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,119}$/.test(key))
      throw new Error("Structured extraction fields require a stable key.");
    if (result[key]) throw new Error(`Duplicate extraction field '${key}'.`);
    result[key] = {
      selector: clean(field.selector) || undefined,
      attribute: clean(field.attribute) || undefined,
    };
  }
  return result;
}

/** Builds the executable definition server-side from ordinary guided controls. */
export function compileGuidedBrowserOperation(input: {
  mode: BrowserOperationMode;
  review: GuidedBrowserOperationReview;
}) {
  const executeSteps = input.review.steps.map(step => ({
    action: step.action,
    selector: clean(step.selector) || undefined,
    value: clean(step.value) || undefined,
  })) as BrowserScriptStep[];
  if (input.mode === "read") {
    const output = input.review.output;
    if (!output)
      throw new Error("A read operation requires a structured result step.");
    executeSteps.push({
      action: output.action,
      selector: clean(output.selector),
      key: clean(output.key),
      fields:
        output.action === "read_rows"
          ? guidedFields(output.fields || [])
          : undefined,
    });
    const definition = validateLearnedOperationDefinition({
      mode: "read",
      execute: { steps: executeSteps },
      resultKey: clean(output.key),
    });
    return {
      definition,
      targetAssertions: {},
      postconditionAssertions: [] as BrowserPostcondition[],
    };
  }
  const target = input.review.target;
  const postcondition = input.review.postcondition;
  if (!target || !postcondition)
    throw new Error(
      "A write operation requires guided target and success verification."
    );
  const stableFields = target.fields.filter(field =>
    [
      "externalId",
      "taskId",
      "opportunityId",
      "name",
      "email",
      "phone",
      "company",
    ].includes(field.key)
  );
  const exact = stableFields.some(field =>
    ["externalId", "taskId", "opportunityId"].includes(field.key)
  );
  if (!exact && stableFields.length < 2)
    throw new Error(
      "Target verification requires an external ID or at least two stable identity fields."
    );
  const definition = validateLearnedOperationDefinition({
    mode: "write",
    targetRead: {
      steps: [
        {
          action: "read_rows",
          selector: clean(target.rowSelector),
          key: "targets",
          fields: guidedFields(stableFields),
        },
      ],
    },
    execute: { steps: executeSteps },
    postconditionRead: {
      steps: [
        {
          action: postcondition.action,
          selector: clean(postcondition.selector),
          key: clean(postcondition.key),
          attribute: clean(postcondition.attribute) || undefined,
        },
      ],
    },
  });
  const assertion: BrowserPostcondition = {
    actualKey: clean(postcondition.key),
    expectedInput: clean(postcondition.expectedInput) || undefined,
    expectedValue: clean(postcondition.expectedValue) || undefined,
    comparator: postcondition.comparator || "equals",
  };
  if (
    assertion.comparator !== "exists" &&
    !assertion.expectedInput &&
    !assertion.expectedValue
  )
    throw new Error(
      "Success verification requires an expected placeholder or exact value."
    );
  return {
    definition,
    targetAssertions: { mode: target.mode || "must_match" },
    postconditionAssertions: [assertion],
  };
}
