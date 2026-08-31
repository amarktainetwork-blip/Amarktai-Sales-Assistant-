import { z } from "zod";
import {
  CompanyKnowledgeOutputError,
  canonicalizeCompanyKnowledgeOutput as canonicalizeCompanyKnowledgeOutputCore,
  formatCompanyKnowledgeOutputDiagnostic,
  parseCanonicalCompanyKnowledgeOutput as parseCanonicalCompanyKnowledgeOutputCore,
  type CompanyKnowledgeOutputContext,
  type CompanyKnowledgeOutputDiagnostic,
  type CompanyKnowledgeOutputMode,
  type CompanyKnowledgeOutputPhase,
} from "./companyKnowledgeModelOutputCore";

export {
  CompanyKnowledgeOutputError,
  formatCompanyKnowledgeOutputDiagnostic,
};
export type {
  CompanyKnowledgeOutputContext,
  CompanyKnowledgeOutputDiagnostic,
  CompanyKnowledgeOutputMode,
  CompanyKnowledgeOutputPhase,
};

type JsonObject = Record<string, unknown>;

const CANONICAL_PRICE_SEMANTICS = new Set([
  "full_current_price",
  "original_price",
  "deposit",
  "finance_payment_plan",
  "alternative_plan",
  "other_fee",
]);

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function semanticKey(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function moneyAmount(value: unknown) {
  const compact = text(value).replace(/,/g, "");
  const match = compact.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sourceIds(price: JsonObject) {
  return Array.isArray(price.sourcePageIds)
    ? price.sourcePageIds.filter(
        (value): value is string =>
          typeof value === "string" && /^PAGE_\d{4}$/.test(value)
      )
    : [];
}

function sameMoney(left: JsonObject, right: JsonObject) {
  const leftAmount = moneyAmount(left.value);
  const rightAmount = moneyAmount(right.value);
  return (
    leftAmount !== undefined &&
    rightAmount !== undefined &&
    leftAmount === rightAmount
  );
}

function sourcesOverlap(left: JsonObject, right: JsonObject) {
  const rightIds = new Set(sourceIds(right));
  return sourceIds(left).some(id => rightIds.has(id));
}

function normalizeSchemaPriceDuplicates(
  offering: JsonObject,
  path: string,
  actions: string[]
) {
  if (!Array.isArray(offering.prices)) return;
  const prices = offering.prices.map(object);
  offering.prices = offering.prices.filter((value, index) => {
    const price = prices[index];
    if (!price || semanticKey(price.semanticType) !== "schema_price") return true;
    if (!/schema(?:\.org)?/i.test(text(price.label))) return true;
    if (!sourceIds(price).length) return true;

    const duplicate = prices.some((candidate, candidateIndex) => {
      if (!candidate || candidateIndex === index) return false;
      if (!CANONICAL_PRICE_SEMANTICS.has(semanticKey(candidate.semanticType)))
        return false;
      return sameMoney(price, candidate) && sourcesOverlap(price, candidate);
    });

    if (!duplicate) return true;
    actions.push(`${path}.prices[${index}]:dropped_duplicate_schema_price`);
    return false;
  });
}

function hasExplicitEmptyPriceProvenance(offering: JsonObject) {
  return (
    Array.isArray(offering.prices) &&
    offering.prices.some(value => {
      const price = object(value);
      return Boolean(
        price &&
          Array.isArray(price.sourcePageIds) &&
          price.sourcePageIds.length === 0
      );
    })
  );
}

function identityKey(value: unknown) {
  return text(value).toLowerCase();
}

function offeringLabel(offering: JsonObject, index: number) {
  return text(offering.name) || text(offering.id) || `offering ${index + 1}`;
}

function appendGap(root: JsonObject, gap: string) {
  const existing = Array.isArray(root.importantGaps)
    ? root.importantGaps.filter((value): value is string => typeof value === "string")
    : [];
  if (!existing.includes(gap)) existing.push(gap);
  root.importantGaps = existing;
}

function normalizeAuditOfferingChanges(
  root: JsonObject,
  key: "addOfferings" | "replaceOfferings",
  actions: string[]
) {
  if (!Array.isArray(root[key])) return new Set<string>();
  const droppedIds = new Set<string>();
  const retained: unknown[] = [];

  root[key].forEach((value, index) => {
    const offering = object(value);
    if (!offering) {
      retained.push(value);
      return;
    }

    const path = `${key}[${index}]`;
    normalizeSchemaPriceDuplicates(offering, path, actions);

    if (!hasExplicitEmptyPriceProvenance(offering)) {
      retained.push(offering);
      return;
    }

    const id = identityKey(offering.id);
    if (id) droppedIds.add(id);
    const gap = `Audit offering change ignored because one or more prices lacked source provenance: ${offeringLabel(offering, index)}.`;
    appendGap(root, gap);
    actions.push(`${path}:ignored_unproven_price_provenance`);
  });

  root[key] = retained;
  return droppedIds;
}

function applyAuditCompatibility(value: unknown, actions: string[]) {
  const root = object(value);
  if (!root) return value;

  normalizeAuditOfferingChanges(root, "addOfferings", actions);
  const droppedReplacementIds = normalizeAuditOfferingChanges(
    root,
    "replaceOfferings",
    actions
  );

  if (droppedReplacementIds.size && Array.isArray(root.removeOfferingIds)) {
    root.removeOfferingIds = root.removeOfferingIds.filter(value => {
      const key = identityKey(value);
      if (!key || !droppedReplacementIds.has(key)) return true;
      actions.push(
        `removeOfferingIds:preserved_draft_for_ignored_replacement:${key}`
      );
      return false;
    });
  }

  return root;
}

function reviewableAuditSchemaError(error: CompanyKnowledgeOutputError) {
  const paths = error.diagnostic.schemaErrorPaths;
  if (!paths.length) return false;
  if (paths.some(path => path === "$json" || path.includes("unsupported source")))
    return false;
  return true;
}

function auditHumanReviewGap(
  context: CompanyKnowledgeOutputContext,
  error: CompanyKnowledgeOutputError
) {
  const batch = context.batchIndex
    ? `${context.batchIndex}/${context.batchTotal || "?"}`
    : "unknown";
  const pages = (context.pageIds || [])
    .filter(id => /^PAGE_\d{4}$/.test(id))
    .join(", ");
  const issues = error.diagnostic.schemaErrorPaths
    .slice(0, 8)
    .map(path => path.replace(/\s+/g, " ").slice(0, 350))
    .join("; ");
  return [
    `Human review required for audit batch ${batch}${pages ? ` (${pages})` : ""}.`,
    "The audit proposed a change that could not be represented safely, so the complete audit patch for this batch was quarantined and the previously validated company draft was left unchanged.",
    issues ? `Review reason: ${issues}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4_000);
}

function quarantinedAuditPatch(
  context: CompanyKnowledgeOutputContext,
  error: CompanyKnowledgeOutputError
) {
  return {
    addOfferings: [],
    replaceOfferings: [],
    removeOfferingIds: [],
    addFinance: [],
    addCertificationsAndAccreditation: [],
    addSupportAndOutcomes: [],
    addPolicies: [],
    addRefundCancellationTerms: [],
    addContactKnowledge: [],
    addContacts: [],
    addConflicts: [],
    addExcludedContent: [],
    importantGaps: [auditHumanReviewGap(context, error)],
  };
}

export function canonicalizeCompanyKnowledgeOutput(
  raw: unknown,
  mode: CompanyKnowledgeOutputMode
) {
  const core = canonicalizeCompanyKnowledgeOutputCore(raw, mode);
  if (mode !== "audit") return core;
  const actions = [...core.actions];
  const value = applyAuditCompatibility(structuredClone(core.value), actions);
  return { value, actions: Array.from(new Set(actions)) };
}

export function parseCanonicalCompanyKnowledgeOutput<T>(input: {
  raw: unknown;
  mode: CompanyKnowledgeOutputMode;
  schema: z.ZodType<T>;
  context: CompanyKnowledgeOutputContext;
}) {
  if (input.mode !== "audit") {
    return parseCanonicalCompanyKnowledgeOutputCore(input);
  }

  let normalized: ReturnType<typeof canonicalizeCompanyKnowledgeOutput>;
  try {
    normalized = canonicalizeCompanyKnowledgeOutput(input.raw, input.mode);
  } catch {
    // Malformed JSON and other pre-schema failures still fail closed and may use
    // the existing bounded model-repair path. Human review never bypasses an
    // unreadable model response.
    return parseCanonicalCompanyKnowledgeOutputCore(input);
  }

  try {
    const parsed = parseCanonicalCompanyKnowledgeOutputCore({
      ...input,
      raw: normalized.value,
    });
    return {
      data: parsed.data,
      normalizationActions: Array.from(
        new Set([...normalized.actions, ...parsed.normalizationActions])
      ),
    };
  } catch (error) {
    if (!(error instanceof CompanyKnowledgeOutputError)) throw error;
    const normalizationActions = Array.from(
      new Set([
        ...normalized.actions,
        ...error.diagnostic.normalizationActions,
      ])
    ).slice(0, 100);

    // Audit-only uncertainty is quarantined for deliberate human review rather
    // than allowed to consume the global repair budget or abort the whole-site
    // job. The quarantine is an empty mutation: no disputed audit fact is
    // trusted, no source is invented, and the already validated draft remains
    // unchanged. Malformed JSON and out-of-batch provenance remain hard errors.
    if (reviewableAuditSchemaError(error)) {
      const quarantined = parseCanonicalCompanyKnowledgeOutputCore({
        ...input,
        raw: quarantinedAuditPatch(input.context, error),
      });
      return {
        data: quarantined.data,
        normalizationActions: Array.from(
          new Set([
            ...normalizationActions,
            "$:quarantined_audit_schema_for_human_review",
            ...quarantined.normalizationActions,
          ])
        ),
      };
    }

    throw new CompanyKnowledgeOutputError(error.message, {
      ...error.diagnostic,
      normalizationActions,
    });
  }
}
