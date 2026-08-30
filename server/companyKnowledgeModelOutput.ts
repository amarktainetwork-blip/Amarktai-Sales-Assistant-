import { z } from "zod";

export type CompanyKnowledgeOutputMode =
  | "full_analysis"
  | "partial_analysis"
  | "audit";

export type CompanyKnowledgeOutputPhase = "analysis" | "audit" | "repair";

export type CompanyKnowledgeOutputContext = {
  phase: CompanyKnowledgeOutputPhase;
  batchIndex?: number;
  batchTotal?: number;
  pageIds?: string[];
  repairAttempt?: number;
};

export type CompanyKnowledgeOutputDiagnostic = {
  phase: CompanyKnowledgeOutputPhase;
  batchIndex?: number;
  batchTotal?: number;
  pageIds: string[];
  schemaErrorPaths: string[];
  normalizationActions: string[];
  repairAttempt: number;
};

export class CompanyKnowledgeOutputError extends Error {
  readonly diagnostic: CompanyKnowledgeOutputDiagnostic;

  constructor(message: string, diagnostic: CompanyKnowledgeOutputDiagnostic) {
    super(message);
    this.name = "CompanyKnowledgeOutputError";
    this.diagnostic = diagnostic;
  }
}

type NormalizationState = {
  actions: string[];
};

const ANALYSIS_ROOT_KEYS = new Set([
  "company",
  "contacts",
  "locations",
  "offerings",
  "finance",
  "certificationsAndAccreditation",
  "supportAndOutcomes",
  "policies",
  "refundCancellationTerms",
  "contactKnowledge",
  "faqs",
  "salesUsefulFacts",
  "excludedContent",
  "conflicts",
  "importantGaps",
  "sourceIndex",
]);

const AUDIT_ROOT_KEYS = new Set([
  "addOfferings",
  "replaceOfferings",
  "removeOfferingIds",
  "addFinance",
  "addCertificationsAndAccreditation",
  "addSupportAndOutcomes",
  "addPolicies",
  "addRefundCancellationTerms",
  "addContactKnowledge",
  "addContacts",
  "addConflicts",
  "addExcludedContent",
  "importantGaps",
]);

const ANALYSIS_FACT_KEYS = [
  "finance",
  "certificationsAndAccreditation",
  "supportAndOutcomes",
  "policies",
  "refundCancellationTerms",
  "contactKnowledge",
  "faqs",
  "salesUsefulFacts",
] as const;

const AUDIT_FACT_KEYS = [
  "addFinance",
  "addCertificationsAndAccreditation",
  "addSupportAndOutcomes",
  "addPolicies",
  "addRefundCancellationTerms",
  "addContactKnowledge",
] as const;

const OFFERING_TEXT_LIST_KEYS = [
  "plans",
  "duration",
  "includedCourses",
  "includedExams",
  "certifications",
  "awardingBodies",
  "financeOptions",
  "support",
  "entryRequirements",
  "outcomes",
  "caveats",
] as const;

const EXCLUDED_CLASSIFICATIONS = new Set([
  "category",
  "editorial",
  "testimonial",
  "comparison",
  "competitor",
  "example",
  "duplicate",
  "navigation",
  "other_non_company_content",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown) {
  return isRecord(value) ? value : {};
}

function note(state: NormalizationState, action: string) {
  if (!state.actions.includes(action)) state.actions.push(action);
}

function primitiveText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Converts only recognisable scalar text representations. It deliberately does
 * not stringify arbitrary nested objects or join unknown keys into prose.
 */
function representedText(value: unknown): string | undefined {
  const direct = primitiveText(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;

  const amount = primitiveText(value.value);
  const unit = primitiveText(value.unit);
  if (amount && unit) return `${amount} ${unit}`;

  for (const key of [
    "text",
    "label",
    "name",
    "duration",
    "description",
    "details",
    "value",
  ]) {
    const candidate = primitiveText(value[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function isEmptyJunk(value: unknown) {
  return (
    value == null ||
    (typeof value === "string" && !value.trim()) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function canonicalArray(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  if (value == null) {
    note(state, `${path}:null_to_empty_array`);
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  if (!Array.isArray(value)) note(state, `${path}:scalar_to_array`);
  const filtered = values.filter(item => !isEmptyJunk(item));
  if (filtered.length !== values.length)
    note(state, `${path}:removed_empty_items`);
  return filtered;
}

function canonicalTextList(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const values = canonicalArray(value, path, state);
  const output: string[] = [];
  values.forEach((item, index) => {
    const text = representedText(item);
    if (!text) {
      note(state, `${path}[${index}]:dropped_unrepresentable_text`);
      return;
    }
    if (text !== item) note(state, `${path}[${index}]:structured_to_text`);
    if (!output.includes(text)) output.push(text);
  });
  if (output.length !== values.length)
    note(state, `${path}:deduplicated_or_dropped`);
  return output;
}

function normalizeTextField(
  item: Record<string, unknown>,
  key: string,
  path: string,
  state: NormalizationState
) {
  if (!(key in item)) return;
  const text = representedText(item[key]);
  if (text !== undefined && text !== item[key]) {
    item[key] = text;
    note(state, `${path}.${key}:structured_to_text`);
  }
}

function normalizeSourcePageIds(
  item: Record<string, unknown>,
  path: string,
  state: NormalizationState
) {
  if (!("sourcePageIds" in item)) return item;
  const values = canonicalArray(
    item.sourcePageIds,
    `${path}.sourcePageIds`,
    state
  );
  item.sourcePageIds = values.map((value, index) => {
    const text = primitiveText(value);
    if (text !== undefined && text !== value)
      note(state, `${path}.sourcePageIds[${index}]:scalar_to_text`);
    // Invalid strings intentionally survive to strict PAGE_XXXX validation.
    return text ?? value;
  });
  return item;
}

function normalizePrice(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const price = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(price, "value", path, state);
  normalizeTextField(price, "label", path, state);
  if (!primitiveText(price.label)) {
    const semanticType = primitiveText(price.semanticType);
    if (semanticType) {
      price.label = semanticType.replace(/_/g, " ");
      note(state, `${path}.label:derived_from_semantic_type`);
    }
  }
  return price;
}

function normalizeOffering(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const offering = normalizeSourcePageIds(record(value), path, state);
  for (const key of ["id", "name", "description", "targetCustomer"])
    normalizeTextField(offering, key, path, state);
  for (const key of OFFERING_TEXT_LIST_KEYS) {
    if (key in offering)
      offering[key] = canonicalTextList(offering[key], `${path}.${key}`, state);
  }
  if ("prices" in offering) {
    offering.prices = canonicalArray(
      offering.prices,
      `${path}.prices`,
      state
    ).map((price, index) =>
      normalizePrice(price, `${path}.prices[${index}]`, state)
    );
  }
  return offering;
}

function normalizeAuditOffering(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const offering = record(value);
  if ("courses" in offering && !("includedCourses" in offering)) {
    offering.includedCourses = offering.courses;
    delete offering.courses;
    note(state, `${path}.courses:renamed_to_includedCourses`);
  }
  return normalizeOffering(offering, path, state);
}

function normalizeFact(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const fact = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(fact, "title", path, state);
  normalizeTextField(fact, "details", path, state);
  return fact;
}

function normalizeContact(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const contact = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(contact, "value", path, state);
  normalizeTextField(contact, "label", path, state);
  return contact;
}

function normalizeLocation(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const location = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(location, "name", path, state);
  normalizeTextField(location, "address", path, state);
  return location;
}

function normalizeConflict(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const conflict = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(conflict, "subject", path, state);
  normalizeTextField(conflict, "explanation", path, state);
  if ("values" in conflict)
    conflict.values = canonicalTextList(
      conflict.values,
      `${path}.values`,
      state
    );
  return conflict;
}

function incompleteConflictCandidate(value: Record<string, unknown>) {
  const subject = primitiveText(value.subject);
  const explanation = primitiveText(value.explanation);
  const values = Array.isArray(value.values)
    ? value.values
        .map(item => primitiveText(item))
        .filter((item): item is string => Boolean(item))
    : [];
  const sourcePageIds = Array.isArray(value.sourcePageIds)
    ? value.sourcePageIds
        .map(item => primitiveText(item))
        .filter((item): item is string => Boolean(item))
    : [];
  return (
    !subject ||
    !explanation ||
    new Set(values).size < 2 ||
    new Set(sourcePageIds).size < 2
  );
}

function normalizeExcluded(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const excluded = normalizeSourcePageIds(record(value), path, state);
  normalizeTextField(excluded, "reason", path, state);
  return excluded;
}

function normalizeAuditExcluded(
  value: unknown,
  path: string,
  state: NormalizationState
) {
  const excluded = normalizeExcluded(value, path, state);
  const classification = primitiveText(excluded.classification);
  if (!classification) return excluded;
  const canonical = classification
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (canonical !== classification && EXCLUDED_CLASSIFICATIONS.has(canonical)) {
    excluded.classification = canonical;
    note(state, `${path}.classification:canonicalized_format`);
  }
  return excluded;
}

function normalizeRecordArray(
  root: Record<string, unknown>,
  key: string,
  state: NormalizationState,
  transform: (
    value: unknown,
    path: string,
    state: NormalizationState
  ) => Record<string, unknown>,
  removeBlank?: (value: Record<string, unknown>) => boolean
) {
  if (!(key in root)) return;
  const values = canonicalArray(root[key], key, state)
    .map((value, index) => transform(value, `${key}[${index}]`, state))
    .filter((value, index) => {
      if (!removeBlank?.(value)) return true;
      note(state, `${key}[${index}]:removed_blank_placeholder`);
      return false;
    });
  root[key] = values;
}

function parseJsonObject(raw: unknown, state: NormalizationState) {
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (unfenced !== trimmed) note(state, "$:removed_markdown_json_fence");
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first < 0 || last <= first)
      throw new Error("No structured JSON object was returned.");
    if (first !== 0 || last !== unfenced.length - 1)
      note(state, "$:extracted_json_object");
    value = JSON.parse(unfenced.slice(first, last + 1)) as unknown;
  }
  if (!isRecord(value))
    throw new Error("The model response root is not an object.");
  return structuredClone(value);
}

function unwrapResponse(
  root: Record<string, unknown>,
  canonicalKeys: Set<string>,
  state: NormalizationState
) {
  let current = root;
  for (let depth = 0; depth < 4; depth += 1) {
    const entries = Object.entries(current);
    if (entries.length !== 1 || canonicalKeys.has(entries[0][0])) break;
    if (!isRecord(entries[0][1])) break;
    note(state, `$:unwrapped_${entries[0][0]}`);
    current = entries[0][1];
  }
  return current;
}

function normalizeAnalysisRoot(
  root: Record<string, unknown>,
  mode: "full_analysis" | "partial_analysis",
  state: NormalizationState
) {
  if ("company" in root && isRecord(root.company)) {
    const company = normalizeSourcePageIds(root.company, "company", state);
    for (const key of ["name", "legalName", "description"])
      normalizeTextField(company, key, "company", state);
    if (
      mode === "partial_analysis" &&
      (!primitiveText(company.name) || !company.sourcePageIds)
    ) {
      delete root.company;
      note(state, "company:removed_blank_partial_placeholder");
    }
  }

  normalizeRecordArray(
    root,
    "contacts",
    state,
    normalizeContact,
    item => !primitiveText(item.value)
  );
  normalizeRecordArray(
    root,
    "locations",
    state,
    normalizeLocation,
    item => !primitiveText(item.name)
  );
  normalizeRecordArray(root, "offerings", state, normalizeOffering);
  for (const key of ANALYSIS_FACT_KEYS)
    normalizeRecordArray(
      root,
      key,
      state,
      normalizeFact,
      item => !primitiveText(item.title) || !primitiveText(item.details)
    );
  normalizeRecordArray(root, "excludedContent", state, normalizeExcluded);
  normalizeRecordArray(
    root,
    "conflicts",
    state,
    normalizeConflict,
    mode === "partial_analysis" ? incompleteConflictCandidate : undefined
  );
  if ("importantGaps" in root)
    root.importantGaps = canonicalTextList(
      root.importantGaps,
      "importantGaps",
      state
    );

  // sourceIndex is deliberately not cleaned: strict key and URL validation must
  // reject fabricated PAGE IDs and placeholder URLs rather than hiding them.
  return root;
}

function normalizeAuditRoot(
  root: Record<string, unknown>,
  state: NormalizationState
) {
  for (const key of ["addOfferings", "replaceOfferings"])
    normalizeRecordArray(root, key, state, normalizeAuditOffering);
  for (const key of AUDIT_FACT_KEYS)
    normalizeRecordArray(
      root,
      key,
      state,
      normalizeFact,
      item => !primitiveText(item.title) || !primitiveText(item.details)
    );
  normalizeRecordArray(
    root,
    "addContacts",
    state,
    normalizeContact,
    item => !primitiveText(item.value)
  );
  normalizeRecordArray(
    root,
    "addConflicts",
    state,
    normalizeConflict,
    incompleteConflictCandidate
  );
  normalizeRecordArray(
    root,
    "addExcludedContent",
    state,
    normalizeAuditExcluded
  );
  if ("removeOfferingIds" in root)
    root.removeOfferingIds = canonicalTextList(
      root.removeOfferingIds,
      "removeOfferingIds",
      state
    );
  if ("importantGaps" in root)
    root.importantGaps = canonicalTextList(
      root.importantGaps,
      "importantGaps",
      state
    );
  return root;
}

export function canonicalizeCompanyKnowledgeOutput(
  raw: unknown,
  mode: CompanyKnowledgeOutputMode
) {
  const state: NormalizationState = { actions: [] };
  const canonicalKeys = mode === "audit" ? AUDIT_ROOT_KEYS : ANALYSIS_ROOT_KEYS;
  const root = unwrapResponse(
    parseJsonObject(raw, state),
    canonicalKeys,
    state
  );
  const value =
    mode === "audit"
      ? normalizeAuditRoot(root, state)
      : normalizeAnalysisRoot(root, mode, state);
  return { value, actions: state.actions };
}

function diagnostic(
  context: CompanyKnowledgeOutputContext,
  actions: string[],
  schemaErrorPaths: string[]
): CompanyKnowledgeOutputDiagnostic {
  return {
    phase: context.phase,
    batchIndex: context.batchIndex,
    batchTotal: context.batchTotal,
    pageIds: (context.pageIds || []).filter(id => /^PAGE_\d{4}$/.test(id)),
    schemaErrorPaths: schemaErrorPaths.slice(0, 30),
    normalizationActions: actions.slice(0, 100),
    repairAttempt: context.repairAttempt || 0,
  };
}

function unsupportedSourcePaths(
  value: unknown,
  allowedPageIds: Set<string>,
  path = "$"
): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      unsupportedSourcePaths(item, allowedPageIds, `${path}[${index}]`)
    );
  if (!isRecord(value)) return [];
  const errors: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (key === "sourcePageIds" && Array.isArray(item)) {
      item.forEach((id, index) => {
        if (typeof id === "string" && !allowedPageIds.has(id))
          errors.push(`${childPath}[${index}]: unsupported source ${id}`);
      });
      continue;
    }
    if (key === "sourceIndex" && isRecord(item)) {
      Object.keys(item).forEach(id => {
        if (!allowedPageIds.has(id))
          errors.push(`${childPath}.${id}: unsupported source ${id}`);
      });
      continue;
    }
    errors.push(...unsupportedSourcePaths(item, allowedPageIds, childPath));
  }
  return errors;
}

export function parseCanonicalCompanyKnowledgeOutput<T>(input: {
  raw: unknown;
  mode: CompanyKnowledgeOutputMode;
  schema: z.ZodType<T>;
  context: CompanyKnowledgeOutputContext;
}) {
  let normalized: ReturnType<typeof canonicalizeCompanyKnowledgeOutput>;
  try {
    normalized = canonicalizeCompanyKnowledgeOutput(input.raw, input.mode);
  } catch (error) {
    const details = diagnostic(input.context, [], ["$json"]);
    throw new CompanyKnowledgeOutputError(
      error instanceof Error ? error.message : "Invalid model JSON.",
      details
    );
  }
  const parsed = input.schema.safeParse(normalized.value);
  if (!parsed.success) {
    const paths = parsed.error.issues.map(issue => {
      const path = issue.path.length
        ? issue.path.reduce<string>((current, part) => {
            if (typeof part === "number") return `${current}[${part}]`;
            const label = String(part);
            return current ? `${current}.${label}` : label;
          }, "")
        : "$";
      return `${path}: ${issue.message}`;
    });
    throw new CompanyKnowledgeOutputError(
      "Company-learning model output failed strict schema validation.",
      diagnostic(input.context, normalized.actions, paths)
    );
  }
  if (input.context.pageIds?.length) {
    const unsupported = unsupportedSourcePaths(
      parsed.data,
      new Set(input.context.pageIds)
    );
    if (unsupported.length)
      throw new CompanyKnowledgeOutputError(
        "Company-learning model output cited sources outside its bounded batch.",
        diagnostic(input.context, normalized.actions, unsupported)
      );
  }
  return { data: parsed.data, normalizationActions: normalized.actions };
}

export function formatCompanyKnowledgeOutputDiagnostic(error: unknown) {
  if (error instanceof CompanyKnowledgeOutputError)
    return JSON.stringify(error.diagnostic).slice(0, 8_000);
  return JSON.stringify({
    phase: "analysis",
    schemaErrorPaths: [
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : String(error).slice(0, 1_000),
    ],
    normalizationActions: [],
    pageIds: [],
    repairAttempt: 0,
  }).slice(0, 8_000);
}