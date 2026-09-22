export const SKILL_STEP_ACTIONS = [
  "read_customer",
  "read_tasks",
  "read_history",
  "read_opportunity",
  "set_internal_priority",
  "prepare_note",
  "prepare_email",
  "prepare_sms",
  "prepare_whatsapp",
  "prepare_task",
  "prepare_contact_update",
  "prepare_opportunity_update",
  "complete_task_after_review",
] as const;

export type SkillStepAction = (typeof SKILL_STEP_ACTIONS)[number];

export const SKILL_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "one_of",
  "exists",
  "not_exists",
  "before",
  "after",
] as const;

export type SkillCondition = {
  source: "customer" | "task" | "opportunity" | "history" | "time";
  field: string;
  operator: (typeof SKILL_CONDITION_OPERATORS)[number];
  value?: string | string[] | number | boolean;
};

export type SkillStep = {
  id: string;
  action: SkillStepAction;
  label: string;
  templateKey?: string;
  timingRule?: string;
  inputs?: Record<string, string | number | boolean | null>;
  requiresInput?: string[];
  requiredEvidence?: string[];
};

export type SkillDefinition = {
  schemaVersion: 1;
  kind: "workflow" | "priority" | "guard";
  source: "natural_language" | "seed" | "manual";
  sourcePrompt?: string;
  summary: string;
  trigger: string;
  match: {
    all: SkillCondition[];
    any: SkillCondition[];
    stopIf: SkillCondition[];
  };
  eligibility: string[];
  stopConditions: string[];
  decisionRules: string[];
  requiredReadCapabilities: string[];
  requiredWriteCapabilities: string[];
  requiredOperations: string[];
  requiredMappings: string[];
  writeApproval: {
    status: "not_required" | "approval_required" | "approved_for_commissioning";
    approvedCapabilities: string[];
    approvedOperations: string[];
    connectedSystemId?: number;
    approvedAt?: string;
  };
  steps: SkillStep[];
  assertions: string[];
  parameters?: Record<string, string>;
  demoReserved?: boolean;
};

export type SkillSimulationCheck = {
  key: string;
  passed: boolean;
  detail: string;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function strings(value: unknown, maximum = 40) {
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

function conditions(value: unknown, maximum = 40): SkillCondition[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum).flatMap(raw => {
    const item = object(raw);
    const source = text(item.source, 30);
    const field = text(item.field, 160);
    const operator = text(item.operator, 30);
    if (
      !["customer", "task", "opportunity", "history", "time"].includes(source) ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,159}$/.test(field) ||
      !SKILL_CONDITION_OPERATORS.includes(
        operator as (typeof SKILL_CONDITION_OPERATORS)[number]
      )
    )
      return [];
    const rawValue = item.value;
    const value =
      Array.isArray(rawValue)
        ? rawValue
            .filter((entry): entry is string => typeof entry === "string")
            .map(entry => entry.trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 40)
        : typeof rawValue === "string"
          ? rawValue.trim().slice(0, 1_000)
          : typeof rawValue === "number" || typeof rawValue === "boolean"
            ? rawValue
            : undefined;
    return [
      {
        source: source as SkillCondition["source"],
        field,
        operator: operator as SkillCondition["operator"],
        ...(value !== undefined ? { value } : {}),
      },
    ];
  });
}

export function normalizeSkillDefinition(value: unknown): SkillDefinition {
  const source = object(value);
  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const steps = rawSteps.slice(0, 40).flatMap((raw, index) => {
    const step = object(raw);
    const action = text(step.action, 80);
    const label = text(step.label, 240);
    if (
      !SKILL_STEP_ACTIONS.includes(action as SkillStepAction) ||
      !label
    )
      return [];
    const safeInputs = Object.fromEntries(
      Object.entries(object(step.inputs))
        .filter(([key, item]) =>
          /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(key) &&
          (item === null ||
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean")
        )
        .slice(0, 60)
        .map(([key, item]) => [
          key,
          typeof item === "string" ? item.trim().slice(0, 4_000) : item,
        ])
    ) as Record<string, string | number | boolean | null>;
    return [
      {
        id: text(step.id, 80) || `step-${index + 1}`,
        action: action as SkillStepAction,
        label,
        templateKey: text(step.templateKey, 140) || undefined,
        timingRule: text(step.timingRule, 140) || undefined,
        inputs: Object.keys(safeInputs).length ? safeInputs : undefined,
        requiresInput: strings(step.requiresInput, 30).filter(key =>
          /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(key)
        ),
        requiredEvidence: strings(step.requiredEvidence, 20),
      },
    ];
  });
  return {
    schemaVersion: 1,
    kind:
      source.kind === "priority" || source.kind === "guard"
        ? source.kind
        : "workflow",
    source:
      source.source === "natural_language" || source.source === "seed"
        ? source.source
        : "manual",
    sourcePrompt: text(source.sourcePrompt, 30_000) || undefined,
    summary: text(source.summary, 3_000),
    trigger: text(source.trigger, 1_000),
    match: {
      all: conditions(object(source.match).all),
      any: conditions(object(source.match).any),
      stopIf: conditions(object(source.match).stopIf),
    },
    eligibility: strings(source.eligibility),
    stopConditions: strings(source.stopConditions),
    decisionRules: strings(source.decisionRules, 100),
    requiredReadCapabilities: strings(
      source.requiredReadCapabilities ?? source.requiredCapabilities,
      60
    ).filter(item => !/\.write$|\.send$|\.apply$|\.execute$|dialler\.launch$/i.test(item)),
    requiredWriteCapabilities: strings(
      source.requiredWriteCapabilities ??
        strings(source.requiredCapabilities, 60).filter(item =>
          /\.write$|\.send$|\.apply$|\.execute$|dialler\.launch$/i.test(item)
        ),
      60
    ),
    requiredOperations: strings(source.requiredOperations, 80).filter(item =>
      /^(?:custom\.(?:read|write)\.[a-z0-9_.-]+|[a-z][a-z0-9_]*\.[a-z0-9_.-]+)$/i.test(item)
    ),
    requiredMappings: strings(source.requiredMappings, 80),
    writeApproval: (() => {
      const approval = object(source.writeApproval);
      const approvedCapabilities = strings(approval.approvedCapabilities, 60);
      const approvedOperations = strings(approval.approvedOperations, 80);
      const requestedOperations = strings(source.requiredOperations, 80).filter(
        item => item.startsWith("custom.write.")
      );
      const requestedWrites = strings(
        source.requiredWriteCapabilities ??
          strings(source.requiredCapabilities, 60).filter(item =>
            /\.write$|\.send$|\.apply$|\.execute$|dialler\.launch$/i.test(item)
          ),
        60
      );
      const status =
        approval.status === "approved_for_commissioning"
          ? "approved_for_commissioning"
          : requestedWrites.length || requestedOperations.length
            ? "approval_required"
            : "not_required";
      return {
        status,
        approvedCapabilities:
          status === "approved_for_commissioning"
            ? approvedCapabilities.filter(item => requestedWrites.includes(item))
            : [],
        approvedOperations:
          status === "approved_for_commissioning"
            ? approvedOperations.filter(item =>
                requestedOperations.includes(item)
              )
            : [],
        connectedSystemId:
          status === "approved_for_commissioning" &&
          Number.isInteger(Number(approval.connectedSystemId)) &&
          Number(approval.connectedSystemId) > 0
            ? Number(approval.connectedSystemId)
            : undefined,
        approvedAt:
          status === "approved_for_commissioning"
            ? text(approval.approvedAt, 80) || undefined
            : undefined,
      };
    })(),
    steps,
    assertions: strings(source.assertions),
    parameters: Object.fromEntries(
      Object.entries(object(source.parameters))
        .filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && Boolean(entry[1].trim())
        )
        .slice(0, 40)
        .map(([key, item]) => [
          key.trim().slice(0, 120),
          item.trim().slice(0, 1_000),
        ])
    ),
    demoReserved: source.demoReserved === true,
  };
}

export function simulateSkillDefinition(
  value: unknown
): { valid: boolean; checks: SkillSimulationCheck[]; trace: string[] } {
  const skill = normalizeSkillDefinition(value);
  const identifiers = skill.steps.map(step => step.id);
  const uniqueIds = new Set(identifiers);
  const prepareSteps = skill.steps.filter(
    step =>
      step.action.startsWith("prepare_") ||
      step.action === "set_internal_priority"
  );
  const writeLikeSteps = skill.steps.filter(
    step => step.action === "complete_task_after_review"
  );
  const missingTemplate = skill.steps.filter(
    step =>
      ["prepare_email", "prepare_sms", "prepare_whatsapp"].includes(
        step.action
      ) && !step.templateKey
  );
  const missingEvidence = writeLikeSteps.filter(
    step => !step.requiredEvidence?.length
  );
  const checks: SkillSimulationCheck[] = [
    {
      key: "trigger",
      passed: Boolean(skill.trigger),
      detail: skill.trigger
        ? "A deterministic trigger is present."
        : "Add the exact business event that starts this skill.",
    },
    {
      key: "steps",
      passed: skill.steps.length > 0,
      detail: skill.steps.length
        ? `${skill.steps.length} ordered step(s) are defined.`
        : "Add at least one bounded step.",
    },
    {
      key: "unique_step_ids",
      passed: uniqueIds.size === identifiers.length,
      detail:
        uniqueIds.size === identifiers.length
          ? "Every step has a unique stable identifier."
          : "Step identifiers must be unique for idempotent replay.",
    },
    {
      key: "approved_templates",
      passed: missingTemplate.length === 0,
      detail:
        missingTemplate.length === 0
          ? "Every communication step references a template key."
          : "Communication steps may not invent content; select an approved template.",
    },
    {
      key: "review_boundary",
      passed: missingEvidence.length === 0,
      detail:
        missingEvidence.length === 0
          ? "Consequential completion steps require evidence and review."
          : "Task completion needs explicit postcondition evidence.",
    },
    {
      key: "outcome",
      passed: prepareSteps.length > 0 || skill.assertions.length > 0,
      detail:
        prepareSteps.length > 0 || skill.assertions.length > 0
          ? "The simulation has an observable outcome."
          : "Add a prepared action or a test assertion.",
    },
    {
      key: "demo_reservation",
      passed: !skill.demoReserved,
      detail: skill.demoReserved
        ? "Reserved for a supervised live teaching demonstration; publishing is blocked."
        : "This skill is eligible for reviewed publication.",
    },
  ];
  return {
    valid: checks.every(check => check.passed),
    checks,
    trace: skill.steps.map(
      (step, index) =>
        `${index + 1}. ${step.label} [${step.action}]${
          step.templateKey ? ` using ${step.templateKey}` : ""
        }`
    ),
  };
}
