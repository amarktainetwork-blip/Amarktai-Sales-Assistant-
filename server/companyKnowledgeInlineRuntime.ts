import { createHash } from "node:crypto";
import type {
  CompanyCorpus,
  CompanyCorpusPage,
} from "./companyKnowledgeCorpus";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  companyKnowledgeRepairTargetPrompt,
  synthesiseCompanyKnowledge as synthesiseCompanyKnowledgeBase,
  type CompanyKnowledgeAudit,
  type CompanyKnowledgePack,
  type CompanyKnowledgeSynthesisResult,
  type ReviewPage,
  type WholeSiteCheckpoint,
  type WholeSiteLearningModel,
} from "./companyKnowledgeSynthesis";
import {
  GenxCompanyLearningClient,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";
import {
  CompanyKnowledgeOutputError,
  formatCompanyKnowledgeOutputDiagnostic,
  parseCanonicalCompanyKnowledgeOutput,
} from "./companyKnowledgeModelOutput";

export type {
  CompanyKnowledgePack,
  CompanyKnowledgeSynthesisResult,
  ReviewPage,
  WholeSiteCheckpoint,
} from "./companyKnowledgeSynthesis";

/**
 * Live GenX transport observations (2026-08-29):
 * - file_ids returned unrelated file contents and are unsafe for company learning;
 * - inline text is correct;
 * - one text part is limited to 64k characters;
 * - ~40k real Course2Career inline requests queue and complete reliably;
 * - ~197k combined inline requests fail while queueing.
 *
 * Keep source batches below the proven envelope and leave room for schema/audit
 * instructions. The canonical corpus itself remains unchanged and is still the
 * source-of-truth used by deterministic validation after model extraction.
 */
export const COMPANY_INLINE_SOURCE_BATCH_CHARS = 30_000;
export const COMPANY_INLINE_UNIT_CHARS = 24_000;
export const COMPANY_INLINE_BATCH_CONCURRENCY = 4;
export const MAX_COMPANY_INLINE_BATCHES = 96;
export const MAX_COMPANY_INLINE_REPAIRS = 3;

type TextPart = { type: "text"; text: string };

export type CompanyInlineCorpusBatch = {
  index: number;
  total: number;
  pageIds: string[];
  source: string;
  charCount: number;
};

type InlineClient = Pick<
  GenxCompanyLearningClient,
  | "selectModels"
  | "createSession"
  | "sendSessionMessage"
  | "closeSession"
  | "cleanup"
>;

type InlineCallStats = {
  analysis: number;
  audit: number;
  repair: number;
  normalizationEvents: number;
  normalizedResponses: number;
};

export type CompanyLearningRepairBudget = { used: number };

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9£$€]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLine(value: string | null | undefined, maximum = 2_000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function pageMetadataUnit(page: CompanyCorpusPage) {
  return [
    `PAGE_ID=${page.pageId}`,
    `URL=${page.url}`,
    `TITLE=${compactLine(page.title, 600)}`,
    `PRIMARY_HEADING=${compactLine(page.primaryHeading, 600)}`,
    `DESCRIPTION=${compactLine(page.description, 2_000)}`,
    `PAGE_HINT=${compactLine(page.pageHint, 200)}`,
    `HEADINGS=${page.headings
      .map(item => compactLine(item, 600))
      .filter(Boolean)
      .join(" | ")}`,
  ].join("\n");
}

function splitPageBody(
  page: CompanyCorpusPage,
  kind: "TEXT" | "JSON_LD",
  body: string,
  maximum = COMPANY_INLINE_UNIT_CHARS
) {
  if (!body.trim()) return [];
  const pieces: string[] = [];
  let cursor = 0;
  const prefixReserve = 300;
  const rawMaximum = Math.max(1_000, maximum - prefixReserve);
  while (cursor < body.length) {
    let end = Math.min(body.length, cursor + rawMaximum);
    if (end < body.length) {
      const boundary = Math.max(
        body.lastIndexOf("\n", end),
        body.lastIndexOf(". ", end)
      );
      if (boundary > cursor + Math.floor(rawMaximum * 0.6)) end = boundary + 1;
    }
    pieces.push(body.slice(cursor, end));
    cursor = end;
  }
  return pieces.map((piece, index) =>
    [
      `PAGE_ID=${page.pageId}`,
      `URL=${page.url}`,
      `CONTENT_KIND=${kind}`,
      `CONTENT_PART=${index + 1}/${pieces.length}`,
      piece,
    ].join("\n")
  );
}

function pageUnits(page: CompanyCorpusPage) {
  const units = [pageMetadataUnit(page)];
  units.push(...splitPageBody(page, "TEXT", page.text));
  if (page.jsonLd.length)
    units.push(...splitPageBody(page, "JSON_LD", JSON.stringify(page.jsonLd)));
  return units;
}

/**
 * Converts the canonical corpus into transport-only inline batches. PAGE_XXXX
 * identifiers are preserved even when an oversized page is split across
 * multiple transport units, so downstream provenance remains canonical.
 */
export function buildCompanyInlineCorpusBatches(
  corpus: CompanyCorpus,
  maximum = COMPANY_INLINE_SOURCE_BATCH_CHARS
): CompanyInlineCorpusBatch[] {
  if (maximum < COMPANY_INLINE_UNIT_CHARS + 1_000)
    throw new Error("Company-learning inline batch size is too small.");

  const units = corpus.pages.flatMap(page =>
    pageUnits(page).map(source => ({ source, pageId: page.pageId }))
  );
  const grouped: Array<{ source: string; pageIds: string[] }> = [];
  let current = "";
  let currentPageIds: string[] = [];

  for (const unit of units) {
    if (unit.source.length > maximum)
      throw new Error(
        `Company-learning source unit exceeds the bounded inline transport limit for ${unit.pageId}.`
      );
    const next = current ? `${current}\n\n${unit.source}` : unit.source;
    if (current && next.length > maximum) {
      grouped.push({ source: current, pageIds: unique(currentPageIds) });
      current = unit.source;
      currentPageIds = [unit.pageId];
    } else {
      current = next;
      currentPageIds.push(unit.pageId);
    }
  }
  if (current)
    grouped.push({ source: current, pageIds: unique(currentPageIds) });

  if (!grouped.length)
    throw new Error(
      "Company-learning inline corpus produced no readable batches."
    );
  if (grouped.length > MAX_COMPANY_INLINE_BATCHES)
    throw new Error(
      `Company-learning corpus requires ${grouped.length} bounded batches, exceeding the maximum of ${MAX_COMPANY_INLINE_BATCHES}.`
    );

  return grouped.map((batch, index) => ({
    index,
    total: grouped.length,
    pageIds: batch.pageIds,
    source: batch.source,
    charCount: batch.source.length,
  }));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = normalise(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeSourcedFacts(
  groups: Array<
    Array<{ title: string; details: string; sourcePageIds: string[] }>
  >
) {
  const merged = new Map<
    string,
    { title: string; details: string; sourcePageIds: string[] }
  >();
  for (const item of groups.flat()) {
    const key = `${normalise(item.title)}|${normalise(item.details)}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, { ...item, sourcePageIds: unique(item.sourcePageIds) });
  }
  return Array.from(merged.values());
}

function mergeContacts(groups: CompanyKnowledgePack["contacts"][]) {
  const merged = new Map<string, CompanyKnowledgePack["contacts"][number]>();
  for (const item of groups.flat()) {
    const key = `${item.type}|${normalise(item.value)}|${normalise(item.label)}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, { ...item, sourcePageIds: unique(item.sourcePageIds) });
  }
  return Array.from(merged.values());
}

function mergeLocations(groups: CompanyKnowledgePack["locations"][]) {
  const merged = new Map<string, CompanyKnowledgePack["locations"][number]>();
  for (const item of groups.flat()) {
    const key = `${normalise(item.name)}|${normalise(item.address)}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, { ...item, sourcePageIds: unique(item.sourcePageIds) });
  }
  return Array.from(merged.values());
}

function mergePrices(
  groups: CompanyKnowledgePack["offerings"][number]["prices"][]
) {
  const merged = new Map<
    string,
    CompanyKnowledgePack["offerings"][number]["prices"][number]
  >();
  for (const item of groups.flat()) {
    const key = `${normalise(item.value)}|${item.semanticType}|${normalise(item.label)}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, { ...item, sourcePageIds: unique(item.sourcePageIds) });
  }
  return Array.from(merged.values());
}

function mergeOfferings(groups: CompanyKnowledgePack["offerings"][]) {
  const merged = new Map<string, CompanyKnowledgePack["offerings"][number]>();
  for (const item of groups.flat()) {
    const key = item.id.trim()
      ? normalise(item.id)
      : `${normalise(item.name)}|${item.type}|${normalise(item.plans.join("|"))}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...item,
        plans: dedupeStrings(item.plans),
        prices: mergePrices([item.prices]),
        duration: dedupeStrings(item.duration),
        includedCourses: dedupeStrings(item.includedCourses),
        includedExams: dedupeStrings(item.includedExams),
        certifications: dedupeStrings(item.certifications),
        awardingBodies: dedupeStrings(item.awardingBodies),
        financeOptions: dedupeStrings(item.financeOptions),
        support: dedupeStrings(item.support),
        entryRequirements: dedupeStrings(item.entryRequirements),
        outcomes: dedupeStrings(item.outcomes),
        caveats: dedupeStrings(item.caveats),
        sourcePageIds: unique(item.sourcePageIds),
      });
      continue;
    }
    existing.description =
      existing.description.length >= item.description.length
        ? existing.description
        : item.description;
    existing.plans = dedupeStrings([...existing.plans, ...item.plans]);
    existing.prices = mergePrices([existing.prices, item.prices]);
    existing.duration = dedupeStrings([...existing.duration, ...item.duration]);
    existing.includedCourses = dedupeStrings([
      ...existing.includedCourses,
      ...item.includedCourses,
    ]);
    existing.includedExams = dedupeStrings([
      ...existing.includedExams,
      ...item.includedExams,
    ]);
    existing.certifications = dedupeStrings([
      ...existing.certifications,
      ...item.certifications,
    ]);
    existing.awardingBodies = dedupeStrings([
      ...existing.awardingBodies,
      ...item.awardingBodies,
    ]);
    existing.financeOptions = dedupeStrings([
      ...existing.financeOptions,
      ...item.financeOptions,
    ]);
    existing.support = dedupeStrings([...existing.support, ...item.support]);
    if (!existing.targetCustomer && item.targetCustomer)
      existing.targetCustomer = item.targetCustomer;
    existing.entryRequirements = dedupeStrings([
      ...existing.entryRequirements,
      ...item.entryRequirements,
    ]);
    existing.outcomes = dedupeStrings([...existing.outcomes, ...item.outcomes]);
    existing.caveats = dedupeStrings([...existing.caveats, ...item.caveats]);
    existing.sourcePageIds = unique([
      ...existing.sourcePageIds,
      ...item.sourcePageIds,
    ]);
  }
  return Array.from(merged.values());
}

function mergeExcluded(groups: CompanyKnowledgePack["excludedContent"][]) {
  const merged = new Map<
    string,
    CompanyKnowledgePack["excludedContent"][number]
  >();
  for (const item of groups.flat()) {
    const key = `${item.classification}|${normalise(item.reason)}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, { ...item, sourcePageIds: unique(item.sourcePageIds) });
  }
  return Array.from(merged.values());
}

function mergeConflicts(groups: CompanyKnowledgePack["conflicts"][]) {
  const merged = new Map<string, CompanyKnowledgePack["conflicts"][number]>();
  for (const item of groups.flat()) {
    const key = `${normalise(item.subject)}|${dedupeStrings(item.values).map(normalise).sort().join("|")}`;
    const existing = merged.get(key);
    if (existing)
      existing.sourcePageIds = unique([
        ...existing.sourcePageIds,
        ...item.sourcePageIds,
      ]);
    else
      merged.set(key, {
        ...item,
        values: dedupeStrings(item.values),
        sourcePageIds: unique(item.sourcePageIds),
      });
  }
  return Array.from(merged.values());
}

export function mergeCompanyKnowledgeBatchPacks(
  packs: CompanyKnowledgePack[],
  corpus: CompanyCorpus
): CompanyKnowledgePack {
  if (!packs.length)
    throw new Error("Company-learning analysis produced no batch packs.");
  const homepagePack = packs.find(pack =>
    pack.company.sourcePageIds.includes("PAGE_0001")
  );
  const base = homepagePack || packs[0];
  const companyKey = normalise(base.company.name);
  const matchingCompanies = packs.filter(
    pack => normalise(pack.company.name) === companyKey
  );
  const differentCompanies = packs.filter(
    pack => normalise(pack.company.name) !== companyKey
  );
  const identityConflict = differentCompanies.length
    ? [
        {
          subject: "Company identity",
          values: dedupeStrings(packs.map(pack => pack.company.name)),
          sourcePageIds: unique(
            packs.flatMap(pack => pack.company.sourcePageIds)
          ),
          explanation:
            "Different bounded analysis batches returned different company identities. Human review is required before approval.",
        },
      ]
    : [];

  return companyKnowledgePackSchema.parse({
    company: {
      name: base.company.name,
      legalName:
        matchingCompanies.find(pack => pack.company.legalName)?.company
          .legalName || base.company.legalName,
      description:
        matchingCompanies
          .map(pack => pack.company.description)
          .sort((left, right) => right.length - left.length)[0] || "",
      sourcePageIds: unique(
        matchingCompanies.flatMap(pack => pack.company.sourcePageIds)
      ),
    },
    contacts: mergeContacts(packs.map(pack => pack.contacts)),
    locations: mergeLocations(packs.map(pack => pack.locations)),
    offerings: mergeOfferings(packs.map(pack => pack.offerings)),
    finance: mergeSourcedFacts(packs.map(pack => pack.finance)),
    certificationsAndAccreditation: mergeSourcedFacts(
      packs.map(pack => pack.certificationsAndAccreditation)
    ),
    supportAndOutcomes: mergeSourcedFacts(
      packs.map(pack => pack.supportAndOutcomes)
    ),
    policies: mergeSourcedFacts(packs.map(pack => pack.policies)),
    refundCancellationTerms: mergeSourcedFacts(
      packs.map(pack => pack.refundCancellationTerms)
    ),
    contactKnowledge: mergeSourcedFacts(
      packs.map(pack => pack.contactKnowledge)
    ),
    faqs: mergeSourcedFacts(packs.map(pack => pack.faqs)),
    salesUsefulFacts: mergeSourcedFacts(
      packs.map(pack => pack.salesUsefulFacts)
    ),
    excludedContent: mergeExcluded(packs.map(pack => pack.excludedContent)),
    conflicts: mergeConflicts([
      ...packs.map(pack => pack.conflicts),
      identityConflict,
    ]),
    importantGaps: dedupeStrings(packs.flatMap(pack => pack.importantGaps)),
    sourceIndex: Object.fromEntries(
      corpus.pages.map(page => [page.pageId, page.url])
    ),
  });
}

function mergeAudits(audits: CompanyKnowledgeAudit[]): CompanyKnowledgeAudit {
  return companyKnowledgeAuditSchema.parse({
    addOfferings: mergeOfferings(audits.map(item => item.addOfferings)),
    replaceOfferings: mergeOfferings(audits.map(item => item.replaceOfferings)),
    removeOfferingIds: dedupeStrings(
      audits.flatMap(item => item.removeOfferingIds)
    ),
    addFinance: mergeSourcedFacts(audits.map(item => item.addFinance)),
    addCertificationsAndAccreditation: mergeSourcedFacts(
      audits.map(item => item.addCertificationsAndAccreditation)
    ),
    addSupportAndOutcomes: mergeSourcedFacts(
      audits.map(item => item.addSupportAndOutcomes)
    ),
    addPolicies: mergeSourcedFacts(audits.map(item => item.addPolicies)),
    addRefundCancellationTerms: mergeSourcedFacts(
      audits.map(item => item.addRefundCancellationTerms)
    ),
    addContactKnowledge: mergeSourcedFacts(
      audits.map(item => item.addContactKnowledge)
    ),
    addContacts: mergeContacts(audits.map(item => item.addContacts)),
    addConflicts: mergeConflicts(audits.map(item => item.addConflicts)),
    addExcludedContent: mergeExcluded(
      audits.map(item => item.addExcludedContent)
    ),
    importantGaps: dedupeStrings(audits.flatMap(item => item.importantGaps)),
  });
}

function intersects(sourcePageIds: string[], allowed: Set<string>) {
  return sourcePageIds.some(id => allowed.has(id));
}

function compactDraftForBatch(
  draft: CompanyKnowledgePack,
  batch: CompanyInlineCorpusBatch
) {
  const allowed = new Set(batch.pageIds);
  const facts = (
    items: Array<{ title: string; details: string; sourcePageIds: string[] }>
  ) =>
    items
      .filter(item => intersects(item.sourcePageIds, allowed))
      .map(item => ({
        title: item.title,
        details: item.details.slice(0, 1_000),
        sourcePageIds: item.sourcePageIds,
      }));
  return {
    company: draft.company,
    offerings: draft.offerings
      .filter(item => intersects(item.sourcePageIds, allowed))
      .map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        plans: item.plans,
        prices: item.prices,
        certifications: item.certifications,
        financeOptions: item.financeOptions,
        sourcePageIds: item.sourcePageIds,
      })),
    contacts: draft.contacts.filter(item =>
      intersects(item.sourcePageIds, allowed)
    ),
    finance: facts(draft.finance),
    certificationsAndAccreditation: facts(draft.certificationsAndAccreditation),
    supportAndOutcomes: facts(draft.supportAndOutcomes),
    policies: facts(draft.policies),
    refundCancellationTerms: facts(draft.refundCancellationTerms),
    contactKnowledge: facts(draft.contactKnowledge),
    conflicts: draft.conflicts.filter(item =>
      intersects(item.sourcePageIds, allowed)
    ),
  };
}

export class InlineBatchWholeSiteModel implements WholeSiteLearningModel {
  private readonly client: InlineClient;
  private resources: CompanyLearningResourceState = { sessionIds: [] };
  private models?: Awaited<
    ReturnType<GenxCompanyLearningClient["selectModels"]>
  >;
  private calls: Omit<InlineCallStats, "repair"> = {
    analysis: 0,
    audit: 0,
    normalizationEvents: 0,
    normalizedResponses: 0,
  };
  private readonly repairBudget: CompanyLearningRepairBudget;

  constructor(
    private readonly input: {
      userId: number;
      organisationId: number;
      reference: string;
      onResource?: (
        resources: CompanyLearningResourceState
      ) => Promise<void> | void;
      client?: InlineClient;
      repairBudget?: CompanyLearningRepairBudget;
    }
  ) {
    this.client = input.client || new GenxCompanyLearningClient();
    this.repairBudget = input.repairBudget || { used: 0 };
  }

  private async ensureModels() {
    this.models ||= await this.client.selectModels();
    return this.models;
  }

  private async noteResources() {
    await this.input.onResource?.(this.resourceState());
  }

  private async closeSession(sessionId: string) {
    try {
      await this.client.closeSession(sessionId);
      this.resources.sessionIds = this.resources.sessionIds.filter(
        id => id !== sessionId
      );
    } catch {
      // Keep the session in resource state so final cleanup can retry it.
    }
    await this.noteResources();
  }

  private async run(input: {
    batch: CompanyInlineCorpusBatch;
    kind: "analysis" | "audit" | "repair";
    systemPrompt: string;
    prompt: string;
    auditModel?: boolean;
    includeSource?: boolean;
  }) {
    const models = await this.ensureModels();
    const model = input.auditModel ? models.audit.id : models.analysis.id;
    const sessionId = await this.client.createSession({
      model,
      systemPrompt: input.systemPrompt,
      title: `Amarktai company ${input.kind} ${input.batch.index + 1}/${input.batch.total}`,
    });
    this.resources.sessionIds.push(sessionId);
    await this.noteResources();

    if (input.kind === "analysis") this.calls.analysis += 1;
    else if (input.kind === "audit") this.calls.audit += 1;

    try {
      const parts: TextPart[] = [];
      if (input.includeSource !== false)
        parts.push({
          type: "text",
          text: `CANONICAL_FIRST_PARTY_CORPUS_BATCH=${input.batch.index + 1}/${input.batch.total}\n${input.batch.source}`,
        });
      parts.push({ type: "text", text: input.prompt });
      const result = await this.client.sendSessionMessage({
        sessionId,
        // The live GenX sessions endpoint accepts multipart text content. The
        // legacy client type predates that contract; runtime JSON preserves it.
        content: parts as unknown as string,
        fileIds: [],
        idempotencyKey: hashKey(
          `${this.input.reference}:${input.kind}:${input.batch.index}:${input.batch.pageIds.join(",")}`
        ),
        billing: {
          userId: this.input.userId,
          organisationId: this.input.organisationId,
          feature: `company_learning_${input.kind}`,
          reference: `${this.input.reference}:${input.kind}:batch-${input.batch.index + 1}`,
        },
      });
      return result.content;
    } finally {
      await this.closeSession(sessionId);
    }
  }

  private async repairBatch(
    batch: CompanyInlineCorpusBatch,
    kind: "analysis" | "audit",
    invalidOutput: string,
    validationError: string
  ) {
    if (this.repairBudget.used >= MAX_COMPANY_INLINE_REPAIRS)
      throw new Error(
        `Company learning exceeded its bounded batch-repair contract. ${validationError.slice(0, 4_000)}`
      );
    this.repairBudget.used += 1;
    return this.run({
      batch,
      kind: "repair",
      auditModel: kind === "audit",
      includeSource: false,
      systemPrompt:
        "Repair invalid structured company-learning JSON into the exact target schema. Do not add, infer or change facts. Preserve only facts and PAGE_XXXX identifiers already present in the invalid output. Return JSON only.",
      prompt: `Repair this ${kind} batch output.\nRepair attempt: ${this.repairBudget.used}/${MAX_COMPANY_INLINE_REPAIRS}\nValidation diagnostic: ${validationError.slice(0, 4_000)}\n\nTARGET SCHEMA:\n${companyKnowledgeRepairTargetPrompt(kind)}\n\nINVALID OUTPUT:\n${invalidOutput.slice(0, 24_000)}`,
    });
  }

  private noteNormalization(actions: string[]) {
    this.calls.normalizationEvents += actions.length;
    if (actions.length) this.calls.normalizedResponses += 1;
  }

  private async parseBatch<T>(
    batch: CompanyInlineCorpusBatch,
    kind: "analysis" | "audit",
    raw: string,
    schema: { parse(value: unknown): T }
  ) {
    try {
      const parsed = parseCanonicalCompanyKnowledgeOutput({
        raw,
        mode: kind === "audit" ? "audit" : "full_analysis",
        schema: schema as never,
        context: {
          phase: kind,
          batchIndex: batch.index + 1,
          batchTotal: batch.total,
          pageIds: batch.pageIds,
        },
      });
      this.noteNormalization(parsed.normalizationActions);
      return parsed.data as T;
    } catch (error) {
      if (error instanceof CompanyKnowledgeOutputError)
        this.noteNormalization(error.diagnostic.normalizationActions);
      const repaired = await this.repairBatch(
        batch,
        kind,
        raw,
        formatCompanyKnowledgeOutputDiagnostic(error)
      );
      const parsed = parseCanonicalCompanyKnowledgeOutput({
        raw: repaired,
        mode: kind === "audit" ? "audit" : "full_analysis",
        schema: schema as never,
        context: {
          phase: "repair",
          batchIndex: batch.index + 1,
          batchTotal: batch.total,
          pageIds: batch.pageIds,
          repairAttempt: this.repairBudget.used,
        },
      });
      this.noteNormalization(parsed.normalizationActions);
      return parsed.data as T;
    }
  }

  async analyse({ corpus }: { corpus: CompanyCorpus }) {
    const batches = buildCompanyInlineCorpusBatches(corpus);
    const packs = await mapWithConcurrency(
      batches,
      COMPANY_INLINE_BATCH_CONCURRENCY,
      async batch => {
        const raw = await this.run({
          batch,
          kind: "analysis",
          systemPrompt:
            "You are a senior business analyst and sales-enablement architect. Use only the inline canonical first-party corpus batch in the current user message. Do not use prior knowledge or attachments. PAGE IDs may repeat when a long page is split; combine those segments. Extract every real company fact present in this batch and return strict JSON only.",
          prompt: `Build a PARTIAL CompanyKnowledgePack for only the supplied corpus batch. Use empty arrays when a category is absent. Every material fact must cite PAGE_XXXX IDs from this batch. Separate real offerings from categories, editorial pages, testimonials, examples, comparisons and competitors. Distinguish full current price, deposit, finance payment, alternative plan and other fees. Never silently resolve contradictory first-party facts.\n\n${companyKnowledgeRepairTargetPrompt("analysis")}\n\nDo not rename keys, add metadata keys, wrap the response, or use facts outside this batch. Return JSON only.`,
        });
        return this.parseBatch(
          batch,
          "analysis",
          raw,
          companyKnowledgePackSchema
        );
      }
    );
    return mergeCompanyKnowledgeBatchPacks(packs, corpus);
  }

  async audit({
    corpus,
    draft,
  }: {
    corpus: CompanyCorpus;
    draft: CompanyKnowledgePack;
  }) {
    const batches = buildCompanyInlineCorpusBatches(corpus);
    const audits = await mapWithConcurrency(
      batches,
      COMPANY_INLINE_BATCH_CONCURRENCY,
      async batch => {
        const compactDraft = compactDraftForBatch(draft, batch);
        const raw = await this.run({
          batch,
          kind: "audit",
          auditModel: true,
          systemPrompt:
            "You are an independent adversarial company-knowledge auditor. Use only the inline canonical first-party corpus batch in the current user message. Do not use prior knowledge or attachments. Find omissions, false offerings, merged plans, wrong prices, finance, contacts, policies, certification, support, contradictions and unsupported claims. Return only the strict requested patch JSON.",
          prompt: `Audit the current merged draft items relevant to this batch against the supplied source batch.\n\nCURRENT DRAFT SUBSET:\n${JSON.stringify(compactDraft)}\n\n${companyKnowledgeRepairTargetPrompt("audit")}\n\nOnly propose corrections grounded in PAGE_XXXX IDs visible in this batch. Do not rename keys, add metadata keys, wrap the response, or invent facts. Return JSON only.`,
        });
        return this.parseBatch(
          batch,
          "audit",
          raw,
          companyKnowledgeAuditSchema
        );
      }
    );
    return mergeAudits(audits);
  }

  async cleanup() {
    const failures = await this.client.cleanup(this.resources);
    if (!failures.length) this.resources = { sessionIds: [] };
    await this.noteResources();
    return failures;
  }

  resourceState() {
    return {
      sessionIds: [...this.resources.sessionIds],
    } satisfies CompanyLearningResourceState;
  }

  selectedModels() {
    return {
      analysis: this.models?.analysis.id,
      audit: this.models?.audit.id,
    };
  }

  callStats() {
    return { ...this.calls, repair: this.repairBudget.used };
  }
}

type BaseSynthesisInput = Parameters<typeof synthesiseCompanyKnowledgeBase>[0];

/**
 * Production company-learning runtime. It intentionally bypasses GenX file_ids
 * after live integrity testing proved that endpoint can return unrelated file
 * content. All model-visible source material is sent inline in bounded batches;
 * the existing deterministic source validation and completeness gate still run
 * over the unchanged canonical corpus afterwards.
 */
export async function synthesiseCompanyKnowledge(
  input: BaseSynthesisInput
): Promise<CompanyKnowledgeSynthesisResult> {
  if (input.model) return synthesiseCompanyKnowledgeBase(input);

  const model = new InlineBatchWholeSiteModel({
    userId: input.userId,
    organisationId: input.organisationId,
    reference: input.reference,
    onResource: resources =>
      input.onCheckpoint?.({
        kind: "resources",
        resources,
      } as WholeSiteCheckpoint),
  });
  const result = await synthesiseCompanyKnowledgeBase({ ...input, model });
  const stats = model.callStats();
  result.analysisCalls = stats.analysis;
  result.auditCalls = stats.audit;
  result.normalizationEvents = stats.normalizationEvents;
  result.repairCalls = stats.repair;
  result.totalAiCalls =
    result.analysisCalls + result.auditCalls + result.repairCalls;
  return result;
}
