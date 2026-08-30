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
import { finaliseCompanyKnowledgeRuntimeResult } from "./companyKnowledgeRuntimeFinalization";
import {
  buildCompanyInlineCorpusBatches,
  COMPANY_INLINE_BATCH_CONCURRENCY,
  InlineBatchWholeSiteModel,
  MAX_COMPANY_INLINE_REPAIRS,
  mergeCompanyKnowledgeBatchPacks,
  type CompanyLearningRepairBudget,
  type CompanyInlineCorpusBatch,
} from "./companyKnowledgeInlineRuntime";
import {
  GenxCompanyLearningClient,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";
import {
  CompanyKnowledgeOutputError,
  formatCompanyKnowledgeOutputDiagnostic,
  parseCanonicalCompanyKnowledgeOutput,
  type CompanyKnowledgeOutputContext,
} from "./companyKnowledgeModelOutput";

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
  const configured = Number.parseInt(
    process.env.GENX_COMPANY_TIMEOUT_MS || "",
    10
  );
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.min(600_000, configured)
    : DEFAULT_PARTIAL_BATCH_TIMEOUT_MS;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function parsePartialCompanyKnowledgeBatchDetailed(
  raw: unknown,
  context: CompanyKnowledgeOutputContext = { phase: "analysis" }
) {
  return parseCanonicalCompanyKnowledgeOutput({
    raw,
    mode: "partial_analysis",
    schema: partialPackSchema,
    context,
  });
}

export function parsePartialCompanyKnowledgeBatch(raw: unknown) {
  return parsePartialCompanyKnowledgeBatchDetailed(raw).data;
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
  private models?: Awaited<
    ReturnType<GenxCompanyLearningClient["selectModels"]>
  >;
  private analysisCalls = 0;
  private normalizationEvents = 0;
  private normalizedResponses = 0;
  private readonly repairBudget: CompanyLearningRepairBudget = { used: 0 };

  constructor(
    private readonly input: {
      userId: number;
      organisationId: number;
      reference: string;
      onResource?: (
        resources: CompanyLearningResourceState
      ) => Promise<void> | void;
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
      repairBudget: this.repairBudget,
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
      const prompt = `This is bounded corpus batch ${batch.index + 1}/${batch.total}.\n\nReturn a PARTIAL CompanyKnowledgePack. Use only top-level keys for facts actually present in this batch. OMIT the company key if company identity is not directly evidenced here. OMIT absent top-level categories instead of emitting placeholder objects. Empty arrays are allowed, but never return objects with blank required strings. Every included fact and offering must cite only PAGE_XXXX IDs visible in this batch. Preserve contradictory first-party facts; do not silently choose one.\n\nNested objects must follow the exact structures shown in this reference schema:\n${companyKnowledgeRepairTargetPrompt("analysis")}\n\nFor this partial response you MAY OMIT any top-level key not evidenced in this batch, including company. All offering text-list fields (including duration, support, certifications and outcomes) should be arrays of plain strings. Do not rename keys, add metadata, wrap the JSON, or output commentary.`;
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
      try {
        const parsed = parsePartialCompanyKnowledgeBatchDetailed(
          result.content,
          {
            phase: "analysis",
            batchIndex: batch.index + 1,
            batchTotal: batch.total,
            pageIds: batch.pageIds,
          }
        );
        this.noteNormalization(parsed.normalizationActions);
        return parsed.data;
      } catch (error) {
        if (error instanceof CompanyKnowledgeOutputError)
          this.noteNormalization(error.diagnostic.normalizationActions);
        const repaired = await this.repairBatch(
          batch,
          result.content,
          formatCompanyKnowledgeOutputDiagnostic(error)
        );
        const parsed = parsePartialCompanyKnowledgeBatchDetailed(repaired, {
          phase: "repair",
          batchIndex: batch.index + 1,
          batchTotal: batch.total,
          pageIds: batch.pageIds,
          repairAttempt: this.repairBudget.used,
        });
        this.noteNormalization(parsed.normalizationActions);
        return parsed.data;
      }
    } finally {
      await this.closeSession(sessionId);
    }
  }

  private noteNormalization(actions: string[]) {
    this.normalizationEvents += actions.length;
    if (actions.length) this.normalizedResponses += 1;
  }

  private async repairBatch(
    batch: CompanyInlineCorpusBatch,
    invalidOutput: string,
    validationDiagnostic: string
  ) {
    if (this.repairBudget.used >= MAX_COMPANY_INLINE_REPAIRS)
      throw new Error(
        `Company learning exceeded its bounded batch-repair contract. ${validationDiagnostic.slice(0, 4_000)}`
      );
    this.repairBudget.used += 1;
    const models = await this.ensureModels();
    const sessionId = await this.client.createSession({
      model: models.analysis.id,
      systemPrompt:
        "Repair invalid structured company-learning JSON into the exact partial target schema. Do not add, infer or change facts. Preserve only facts and PAGE_XXXX identifiers already present in the invalid output. Return JSON only.",
      title: `Amarktai partial company repair ${batch.index + 1}/${batch.total}`,
    });
    this.resources.sessionIds.push(sessionId);
    await this.noteResources();
    try {
      const result = await this.client.sendSessionMessage({
        sessionId,
        content: [
          {
            type: "text",
            text: `Repair attempt: ${this.repairBudget.used}/${MAX_COMPANY_INLINE_REPAIRS}\nValidation diagnostic: ${validationDiagnostic.slice(0, 4_000)}\n\nTARGET SCHEMA:\n${companyKnowledgeRepairTargetPrompt("analysis")}\n\nThis remains a PARTIAL batch response: omit top-level categories that were not present.\n\nINVALID OUTPUT:\n${invalidOutput.slice(0, 24_000)}`,
          },
        ] as unknown as string,
        fileIds: [],
        idempotencyKey: hashKey(
          `${this.input.reference}:partial-repair:${batch.index}:${this.repairBudget.used}`
        ),
        billing: {
          userId: this.input.userId,
          organisationId: this.input.organisationId,
          feature: "company_learning_repair",
          reference: `${this.input.reference}:partial-repair:batch-${batch.index + 1}:attempt-${this.repairBudget.used}`,
        },
      });
      return result.content;
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
      repair: this.repairBudget.used,
      normalizationEvents:
        this.normalizationEvents + auditStats.normalizationEvents,
      normalizedResponses:
        this.normalizedResponses + auditStats.normalizedResponses,
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
  return finaliseCompanyKnowledgeRuntimeResult(result);
}
