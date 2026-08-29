import { createHash } from "node:crypto";
import {
  companyKnowledgePackSchema,
  companyKnowledgeRepairTargetPrompt,
  synthesiseCompanyKnowledge as synthesiseCompanyKnowledgeBase,
  type CompanyKnowledgePack,
  type CompanyKnowledgeSynthesisResult,
  type ReviewPage,
  type WholeSiteCheckpoint,
  type WholeSiteLearningModel,
} from "./companyKnowledgeSynthesis";
import type { CompanyCorpus } from "./companyKnowledgeCorpus";
import {
  buildCompanyInlineCorpusBatches,
  COMPANY_INLINE_BATCH_CONCURRENCY,
  InlineBatchWholeSiteModel,
  mergeCompanyKnowledgeBatchPacks,
  type CompanyInlineCorpusBatch,
} from "./companyKnowledgeInlineRuntime";
import {
  GenxCompanyLearningClient,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";

export type {
  CompanyKnowledgePack,
  CompanyKnowledgeSynthesisResult,
  ReviewPage,
  WholeSiteCheckpoint,
} from "./companyKnowledgeSynthesis";

const DEFAULT_PARTIAL_BATCH_TIMEOUT_MS = 600_000;
const partialPackSchema = companyKnowledgePackSchema.partial();
type PartialPack = ReturnType<typeof partialPackSchema.parse>;
type TextPart = { type: "text"; text: string };

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
    ? Math.min(600_000, configured)
    : DEFAULT_PARTIAL_BATCH_TIMEOUT_MS;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
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
    throw new Error("Company-learning batch returned no JSON object.");
  const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
  const root = object(parsed);
  const entries = Object.entries(root);
  if (entries.length === 1) {
    const inner = object(entries[0][1]);
    if (Object.keys(inner).length) return inner;
  }
  return root;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function sanitizePartialEnvelope(raw: unknown) {
  const root = parseJsonObject(raw);

  const company = object(root.company);
  if (!nonEmpty(company.name)) delete root.company;

  const filterRecords = (
    key: string,
    valid: (record: Record<string, unknown>) => boolean
  ) => {
    if (!Array.isArray(root[key])) return;
    root[key] = (root[key] as unknown[])
      .map(object)
      .filter(record => Object.keys(record).length > 0 && valid(record));
  };

  filterRecords("contacts", record => nonEmpty(record.value));
  filterRecords("locations", record => nonEmpty(record.name));
  filterRecords(
    "offerings",
    record => nonEmpty(record.id) && nonEmpty(record.name)
  );

  const factKeys = [
    "finance",
    "certificationsAndAccreditation",
    "supportAndOutcomes",
    "policies",
    "refundCancellationTerms",
    "contactKnowledge",
    "faqs",
    "salesUsefulFacts",
  ];
  for (const key of factKeys)
    filterRecords(key, record => nonEmpty(record.title) && nonEmpty(record.details));

  filterRecords("excludedContent", record => nonEmpty(record.reason));
  filterRecords(
    "conflicts",
    record =>
      nonEmpty(record.subject) &&
      nonEmpty(record.explanation) &&
      Array.isArray(record.values) &&
      record.values.some(nonEmpty)
  );

  if (Array.isArray(root.offerings)) {
    root.offerings = (root.offerings as Array<Record<string, unknown>>).map(
      offering => {
        if (Array.isArray(offering.prices)) {
          offering.prices = offering.prices
            .map(object)
            .filter(price => nonEmpty(price.value) && nonEmpty(price.label));
        }
        return offering;
      }
    );
  }

  const sourceIndex = object(root.sourceIndex);
  root.sourceIndex = Object.fromEntries(
    Object.entries(sourceIndex).filter(
      ([pageId, url]) =>
        /^PAGE_\d{4}$/.test(pageId) &&
        typeof url === "string" &&
        /^https?:\/\//i.test(url)
    )
  );

  return root;
}

export function parsePartialCompanyKnowledgeBatch(raw: unknown) {
  return partialPackSchema.parse(sanitizePartialEnvelope(raw));
}

function fullPackFromPartial(
  partial: PartialPack,
  fallbackCompany: CompanyKnowledgePack["company"]
): CompanyKnowledgePack {
  return companyKnowledgePackSchema.parse({
    company: partial.company || fallbackCompany,
    contacts: partial.contacts || [],
    locations: partial.locations || [],
    offerings: partial.offerings || [],
    finance: partial.finance || [],
    certificationsAndAccreditation:
      partial.certificationsAndAccreditation || [],
    supportAndOutcomes: partial.supportAndOutcomes || [],
    policies: partial.policies || [],
    refundCancellationTerms: partial.refundCancellationTerms || [],
    contactKnowledge: partial.contactKnowledge || [],
    faqs: partial.faqs || [],
    salesUsefulFacts: partial.salesUsefulFacts || [],
    excludedContent: partial.excludedContent || [],
    conflicts: partial.conflicts || [],
    importantGaps: partial.importantGaps || [],
    sourceIndex: partial.sourceIndex || {},
  });
}

export function mergePartialCompanyKnowledgeBatches(
  partials: PartialPack[],
  corpus: CompanyCorpus
) {
  const withIdentity = partials.filter(
    partial => partial.company?.name?.trim().length
  );
  const preferred =
    withIdentity.find(partial =>
      partial.company?.sourcePageIds?.includes("PAGE_0001")
    ) || withIdentity[0];
  if (!preferred?.company)
    throw new Error(
      "Company-learning batches did not return a source-grounded company identity."
    );

  const packs = partials.map(partial =>
    fullPackFromPartial(partial, preferred.company!)
  );
  return mergeCompanyKnowledgeBatchPacks(packs, corpus);
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

export class PartialBatchWholeSiteModel implements WholeSiteLearningModel {
  private readonly client: InlineClient;
  private readonly auditDelegate: InlineBatchWholeSiteModel;
  private resources: CompanyLearningResourceState = { sessionIds: [] };
  private models?: Awaited<ReturnType<GenxCompanyLearningClient["selectModels"]>>;
  private analysisCalls = 0;

  constructor(
    private readonly input: {
      userId: number;
      organisationId: number;
      reference: string;
      onResource?: (resources: CompanyLearningResourceState) => Promise<void> | void;
      client?: InlineClient;
    }
  ) {
    this.client =
      input.client ||
      new GenxCompanyLearningClient({ timeoutMs: timeoutFromEnvironment() });
    this.auditDelegate = new InlineBatchWholeSiteModel({
      userId: input.userId,
      organisationId: input.organisationId,
      reference: `${input.reference}:audit`,
      onResource: input.onResource,
      client: this.client as never,
    });
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
      // Keep failed cleanup in resource state for the final cleanup retry.
    }
    await this.noteResources();
  }

  private async analyseBatch(batch: CompanyInlineCorpusBatch) {
    const models = await this.ensureModels();
    const sessionId = await this.client.createSession({
      model: models.analysis.id,
      systemPrompt:
        "You are a precise business analyst. Use only the inline first-party website material in the current user message. Extract only facts present in this batch. Never use attachments, prior knowledge, or guessed company information. Return JSON only.",
      title: `Amarktai partial company analysis ${batch.index + 1}/${batch.total}`,
    });
    this.resources.sessionIds.push(sessionId);
    await this.noteResources();
    this.analysisCalls += 1;

    try {
      const prompt = `This is bounded corpus batch ${batch.index + 1}/${batch.total}.\n\nReturn a PARTIAL CompanyKnowledgePack. Use only top-level keys for facts actually present in this batch. OMIT the company key if company identity is not directly evidenced here. OMIT absent top-level categories instead of emitting placeholder objects. Empty arrays are allowed, but never return objects with blank required strings. Every included fact and offering must cite only PAGE_XXXX IDs visible in this batch. Preserve contradictory first-party facts; do not silently choose one.\n\nNested objects must follow the exact structures shown in this reference schema:\n${companyKnowledgeRepairTargetPrompt("analysis")}\n\nFor this partial response you MAY OMIT any top-level key not evidenced in this batch, including company. Do not rename keys, add metadata, wrap the JSON, or output commentary.`;
      const parts: TextPart[] = [
        {
          type: "text",
          text: `CANONICAL_FIRST_PARTY_CORPUS_BATCH=${batch.index + 1}/${batch.total}\n${batch.source}`,
        },
        { type: "text", text: prompt },
      ];
      const result = await this.client.sendSessionMessage({
        sessionId,
        content: parts as unknown as string,
        fileIds: [],
        idempotencyKey: hashKey(
          `${this.input.reference}:partial-analysis:${batch.index}:${batch.pageIds.join(",")}`
        ),
        billing: {
          userId: this.input.userId,
          organisationId: this.input.organisationId,
          feature: "company_learning_analysis",
          reference: `${this.input.reference}:partial-analysis:batch-${batch.index + 1}`,
        },
      });
      return parsePartialCompanyKnowledgeBatch(result.content);
    } finally {
      await this.closeSession(sessionId);
    }
  }

  async analyse({ corpus }: { corpus: CompanyCorpus }) {
    const batches = buildCompanyInlineCorpusBatches(corpus);
    const partials = await mapWithConcurrency(
      batches,
      COMPANY_INLINE_BATCH_CONCURRENCY,
      batch => this.analyseBatch(batch)
    );
    return mergePartialCompanyKnowledgeBatches(partials, corpus);
  }

  audit(input: { corpus: CompanyCorpus; draft: CompanyKnowledgePack }) {
    return this.auditDelegate.audit(input);
  }

  async cleanup() {
    const ownFailures = await this.client.cleanup(this.resources);
    if (!ownFailures.length) this.resources = { sessionIds: [] };
    await this.noteResources();
    const auditFailures = await this.auditDelegate.cleanup();
    return Array.from(new Set([...ownFailures, ...auditFailures]));
  }

  resourceState() {
    return {
      sessionIds: [...this.resources.sessionIds],
    } satisfies CompanyLearningResourceState;
  }

  selectedModels() {
    return {
      analysis: this.models?.analysis.id,
      audit: this.auditDelegate.selectedModels().audit,
    };
  }

  callStats() {
    const auditStats = this.auditDelegate.callStats();
    return {
      analysis: this.analysisCalls,
      audit: auditStats.audit,
      repair: auditStats.repair,
    };
  }
}

type BaseSynthesisInput = Parameters<typeof synthesiseCompanyKnowledgeBase>[0];

export async function synthesiseCompanyKnowledge(
  input: BaseSynthesisInput
): Promise<CompanyKnowledgeSynthesisResult> {
  if (input.model) return synthesiseCompanyKnowledgeBase(input);

  const model = new PartialBatchWholeSiteModel({
    userId: input.userId,
    organisationId: input.organisationId,
    reference: input.reference,
    onResource: resources =>
      input.onCheckpoint?.({ kind: "resources", resources } as WholeSiteCheckpoint),
  });
  const result = await synthesiseCompanyKnowledgeBase({ ...input, model });
  const stats = model.callStats();
  result.analysisCalls = stats.analysis + stats.audit;
  result.repairCalls = stats.repair;
  result.totalAiCalls = result.analysisCalls + result.repairCalls;
  return result;
}
