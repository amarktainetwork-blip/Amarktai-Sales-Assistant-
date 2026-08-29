import {
  companyKnowledgeAuditSchema,
  type CompanyKnowledgePack,
  type CompanyKnowledgeSynthesisResult,
  type WholeSiteLearningModel,
} from "./companyKnowledgeSynthesis";
import {
  InlineBatchWholeSiteModel,
} from "./companyKnowledgeInlineRuntime";
import {
  PartialBatchWholeSiteModel,
  synthesiseCompanyKnowledge as synthesisePartialCompanyKnowledge,
} from "./companyKnowledgePartialBatchRuntime";
import {
  GenxCompanyLearningClient,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";

const DEFAULT_VERIFIED_TIMEOUT_MS = 600_000;

const AUDIT_TOP_LEVEL_KEYS = new Set([
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

const FACT_KEYS = [
  "addFinance",
  "addCertificationsAndAccreditation",
  "addSupportAndOutcomes",
  "addPolicies",
  "addRefundCancellationTerms",
  "addContactKnowledge",
] as const;

type InlineClient = Pick<
  GenxCompanyLearningClient,
  | "selectModels"
  | "createSession"
  | "sendSessionMessage"
  | "closeSession"
  | "cleanup"
>;

function timeoutFromEnvironment() {
  const configured = Number.parseInt(process.env.GENX_COMPANY_TIMEOUT_MS || "", 10);
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.min(DEFAULT_VERIFIED_TIMEOUT_MS, configured)
    : DEFAULT_VERIFIED_TIMEOUT_MS;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(raw: unknown) {
  if (typeof raw !== "string") return object(raw);
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first)
    throw new Error("Company-learning audit returned no JSON object.");
  const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
  const root = object(parsed);
  const entries = Object.entries(root);
  if (
    entries.length === 1 &&
    !AUDIT_TOP_LEVEL_KEYS.has(entries[0][0])
  ) {
    const inner = object(entries[0][1]);
    if (Object.keys(inner).length) return inner;
  }
  return root;
}

function primitiveText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function canonicalTextItem(value: unknown): string | undefined {
  const direct = primitiveText(value);
  if (direct) return direct;
  const record = object(value);
  if (!Object.keys(record).length) return undefined;

  const amount = primitiveText(record.value);
  const unit = primitiveText(record.unit);
  if (amount && unit) return `${amount} ${unit}`.trim();

  for (const key of [
    "text",
    "label",
    "name",
    "duration",
    "details",
    "description",
    "value",
  ]) {
    const candidate = primitiveText(record[key]);
    if (candidate) return candidate;
  }

  const scalarParts = Object.entries(record)
    .map(([key, item]) => {
      const text = primitiveText(item);
      return text ? `${key}: ${text}` : undefined;
    })
    .filter((item): item is string => Boolean(item));
  return scalarParts.length ? scalarParts.join("; ") : undefined;
}

function canonicalTextList(value: unknown) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map(canonicalTextItem)
        .filter((item): item is string => Boolean(item))
    )
  );
}

function canonicalPageIds(value: unknown) {
  return canonicalTextList(value).filter(item => /^PAGE_\d{4}$/.test(item));
}

function normalizeSourceIds(record: Record<string, unknown>) {
  if ("sourcePageIds" in record)
    record.sourcePageIds = canonicalPageIds(record.sourcePageIds);
  return record;
}

function normalizeOffering(value: unknown) {
  const offering = normalizeSourceIds(object(value));
  for (const key of OFFERING_TEXT_LIST_KEYS) {
    if (key in offering) offering[key] = canonicalTextList(offering[key]);
  }
  if (Array.isArray(offering.prices)) {
    offering.prices = offering.prices.map(item => {
      const price = normalizeSourceIds(object(item));
      const valueText = canonicalTextItem(price.value);
      const labelText = canonicalTextItem(price.label);
      if (valueText) price.value = valueText;
      if (labelText) price.label = labelText;
      return price;
    });
  }
  return offering;
}

function normalizeFact(value: unknown) {
  const fact = normalizeSourceIds(object(value));
  const title = canonicalTextItem(fact.title);
  const details = canonicalTextItem(fact.details);
  if (title) fact.title = title;
  if (details) fact.details = details;
  return fact;
}

function normalizeContact(value: unknown) {
  const contact = normalizeSourceIds(object(value));
  const text = canonicalTextItem(contact.value);
  const label = canonicalTextItem(contact.label);
  if (text) contact.value = text;
  if (label) contact.label = label;
  return contact;
}

function normalizeConflict(value: unknown) {
  const conflict = normalizeSourceIds(object(value));
  const subject = canonicalTextItem(conflict.subject);
  const explanation = canonicalTextItem(conflict.explanation);
  if (subject) conflict.subject = subject;
  if (explanation) conflict.explanation = explanation;
  if ("values" in conflict) conflict.values = canonicalTextList(conflict.values);
  return conflict;
}

function normalizeExcluded(value: unknown) {
  const excluded = normalizeSourceIds(object(value));
  const reason = canonicalTextItem(excluded.reason);
  if (reason) excluded.reason = reason;
  return excluded;
}

/**
 * Normalize only representational drift already present in the model response.
 * No company fact, enum, offering identity, price semantic, source id or patch
 * operation is invented. The existing strict audit schema still decides whether
 * the normalized response is valid and the existing bounded repair path remains
 * the fallback for genuinely invalid output.
 */
export function normalizeCompanyKnowledgeAuditOutput(raw: unknown) {
  const root = parseJsonObject(raw);

  for (const key of ["addOfferings", "replaceOfferings"] as const) {
    if (Array.isArray(root[key])) root[key] = root[key].map(normalizeOffering);
  }

  for (const key of FACT_KEYS) {
    if (Array.isArray(root[key])) root[key] = root[key].map(normalizeFact);
  }

  if (Array.isArray(root.addContacts))
    root.addContacts = root.addContacts.map(normalizeContact);
  if (Array.isArray(root.addConflicts))
    root.addConflicts = root.addConflicts.map(normalizeConflict);
  if (Array.isArray(root.addExcludedContent))
    root.addExcludedContent = root.addExcludedContent.map(normalizeExcluded);

  if ("removeOfferingIds" in root)
    root.removeOfferingIds = canonicalTextList(root.removeOfferingIds);
  if ("importantGaps" in root)
    root.importantGaps = canonicalTextList(root.importantGaps);

  return root;
}

export function parseNormalizedCompanyKnowledgeAudit(raw: unknown) {
  return companyKnowledgeAuditSchema.parse(
    normalizeCompanyKnowledgeAuditOutput(raw)
  );
}

class NormalizingAuditClient {
  readonly inner: InlineClient;
  normalizedResponses = 0;

  constructor(inner?: InlineClient) {
    this.inner =
      inner ||
      new GenxCompanyLearningClient({ timeoutMs: timeoutFromEnvironment() });
  }

  selectModels(...args: Parameters<InlineClient["selectModels"]>) {
    return this.inner.selectModels(...args);
  }

  createSession(...args: Parameters<InlineClient["createSession"]>) {
    return this.inner.createSession(...args);
  }

  async sendSessionMessage(
    ...args: Parameters<InlineClient["sendSessionMessage"]>
  ) {
    const result = await this.inner.sendSessionMessage(...args);
    try {
      const normalized = normalizeCompanyKnowledgeAuditOutput(result.content);
      this.normalizedResponses += 1;
      return { ...result, content: JSON.stringify(normalized) };
    } catch {
      return result;
    }
  }

  closeSession(...args: Parameters<InlineClient["closeSession"]>) {
    return this.inner.closeSession(...args);
  }

  cleanup(...args: Parameters<InlineClient["cleanup"]>) {
    return this.inner.cleanup(...args);
  }
}

class VerifiedCompanyLearningModel implements WholeSiteLearningModel {
  private readonly analysisModel: PartialBatchWholeSiteModel;
  private readonly auditModel: InlineBatchWholeSiteModel;
  private readonly auditClient: NormalizingAuditClient;

  constructor(input: {
    userId: number;
    organisationId: number;
    reference: string;
    onResource?: (resources: CompanyLearningResourceState) => Promise<void> | void;
  }) {
    this.analysisModel = new PartialBatchWholeSiteModel(input);
    this.auditClient = new NormalizingAuditClient();
    this.auditModel = new InlineBatchWholeSiteModel({
      ...input,
      reference: `${input.reference}:normalized-audit`,
      client: this.auditClient as never,
    });
  }

  analyse(input: Parameters<WholeSiteLearningModel["analyse"]>[0]) {
    return this.analysisModel.analyse(input);
  }

  audit(input: Parameters<WholeSiteLearningModel["audit"]>[0]) {
    return this.auditModel.audit(input);
  }

  async cleanup() {
    const analysisFailures = await this.analysisModel.cleanup();
    const auditFailures = await this.auditModel.cleanup();
    return Array.from(new Set([...analysisFailures, ...auditFailures]));
  }

  resourceState() {
    const analysis = this.analysisModel.resourceState();
    const audit = this.auditModel.resourceState();
    return {
      sessionIds: Array.from(new Set([...analysis.sessionIds, ...audit.sessionIds])),
    } satisfies CompanyLearningResourceState;
  }

  selectedModels() {
    return {
      analysis: this.analysisModel.selectedModels().analysis,
      audit: this.auditModel.selectedModels().audit,
    };
  }

  callStats() {
    const analysis = this.analysisModel.callStats();
    const audit = this.auditModel.callStats();
    return {
      analysis: analysis.analysis,
      audit: audit.audit,
      repair: analysis.repair + audit.repair,
      normalizedAuditResponses: this.auditClient.normalizedResponses,
    };
  }
}

type VerifiedSynthesisInput = Parameters<
  typeof synthesisePartialCompanyKnowledge
>[0];

export type VerifiedCompanyKnowledgeResult = CompanyKnowledgeSynthesisResult & {
  auditResponsesNormalized: number;
};

/**
 * Verifier-only whole-site runtime. Analysis uses the proven partial-batch
 * extractor; audit uses the existing bounded inline auditor with a deterministic
 * representational normalization boundary. Passing a caller-supplied model
 * preserves the base test seam.
 */
export async function synthesiseCompanyKnowledge(
  input: VerifiedSynthesisInput
): Promise<VerifiedCompanyKnowledgeResult> {
  if (input.model) {
    const result = await synthesisePartialCompanyKnowledge(input);
    return Object.assign(result, { auditResponsesNormalized: 0 });
  }

  const model = new VerifiedCompanyLearningModel({
    userId: input.userId,
    organisationId: input.organisationId,
    reference: input.reference,
    onResource: resources =>
      input.onCheckpoint?.({ kind: "resources", resources }),
  });
  const result = await synthesisePartialCompanyKnowledge({ ...input, model });
  const stats = model.callStats();
  result.analysisCalls = stats.analysis + stats.audit;
  result.repairCalls = stats.repair;
  result.totalAiCalls = result.analysisCalls + result.repairCalls;
  return Object.assign(result, {
    auditResponsesNormalized: stats.normalizedAuditResponses,
  });
}
