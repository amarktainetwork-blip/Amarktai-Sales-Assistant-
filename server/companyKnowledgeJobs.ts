import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  companyKnowledgeJobs,
  type CompanyKnowledgeJob,
} from "../drizzle/schema";
import {
  discoverPublicWebsite,
  type DiscoveryResult,
} from "./companyDiscovery";
import {
  buildReviewedCompanyDiscovery,
  pagesForCompanyReview,
} from "./companyIntelligenceService";
import {
  companyKnowledgeAuditSchema,
  companyKnowledgePackSchema,
  type CompanyKnowledgeAudit,
  type CompanyKnowledgePack,
} from "./companyKnowledgeSynthesis";
import {
  synthesiseCompanyKnowledge,
  type WholeSiteCheckpoint,
} from "./companyKnowledgePartialBatchRuntime";
import { type CompanyCorpus } from "./companyKnowledgeCorpus";
import {
  GenxCompanyLearningClient,
  type CompanyLearningResourceState,
} from "./genxCompanyLearning";
import { getDb, recordAudit, saveWebsiteDiscoveryReview } from "./db";

const JOB_LEASE_MS = 15 * 60_000;
const activeJobs = new Set<number>();

function safeText(value: unknown, maximum = 2_000) {
  return String(value || "")
    .replace(/genx/gi, "Amarktai intelligence")
    .replace(/provider/gi, "service")
    .replace(
      /claude|openai|anthropic|gemini|grok|gpt[-\w.]*/gi,
      "Amarktai intelligence"
    )
    .replace(/playwright|chromium/gi, "website reader")
    .replace(/gnxk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function humanPhase(phase: CompanyKnowledgeJob["phase"]) {
  const labels: Record<CompanyKnowledgeJob["phase"], string> = {
    SCANNING_WEBSITE: "Scanning website",
    CLASSIFYING_PAGES: "Building company corpus",
    UNDERSTANDING_OFFERINGS: "Understanding company",
    REVIEWING_PRICING_POLICIES: "Checking products and pricing",
    RECONCILING_KNOWLEDGE: "Auditing company knowledge",
    CHECKING_COMPLETENESS: "Verifying sources",
    READY_FOR_REVIEW: "Ready for review",
  };
  return labels[phase];
}

export function presentCompanyKnowledgeJob(job: CompanyKnowledgeJob) {
  return {
    id: job.id,
    companyProfileId: job.companyProfileId,
    phase: job.phase,
    status: job.status,
    humanStatus: humanPhase(job.phase),
    progress: job.progress,
    attempt: job.attempt,
    resultDiscoveryId: job.resultDiscoveryId,
    lastError: job.lastError ? safeText(job.lastError, 500) : null,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

async function loadJob(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  return (
    await db
      .select()
      .from(companyKnowledgeJobs)
      .where(eq(companyKnowledgeJobs.id, jobId))
      .limit(1)
  )[0];
}

async function updateJob(
  jobId: number,
  values: Partial<typeof companyKnowledgeJobs.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  await db
    .update(companyKnowledgeJobs)
    .set(values)
    .where(eq(companyKnowledgeJobs.id, jobId));
}

async function claimCompanyKnowledgeJob(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const now = new Date();
  const result = await db
    .update(companyKnowledgeJobs)
    .set({
      status: "running",
      leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
      lastError: null,
    })
    .where(
      and(
        eq(companyKnowledgeJobs.id, jobId),
        or(
          eq(companyKnowledgeJobs.status, "queued"),
          and(
            eq(companyKnowledgeJobs.status, "running"),
            or(
              isNull(companyKnowledgeJobs.leaseExpiresAt),
              lt(companyKnowledgeJobs.leaseExpiresAt, now)
            )
          )
        )
      )
    );
  return Number(result[0]?.affectedRows || 0) === 1;
}

function parseCheckpoint<T>(
  value: string | null,
  parser: (value: unknown) => T
) {
  if (!value) return undefined;
  try {
    return parser(JSON.parse(value));
  } catch {
    return undefined;
  }
}

async function cleanupAbandonedResources(job: CompanyKnowledgeJob) {
  const raw =
    job.temporaryResources as Partial<CompanyLearningResourceState> | null;
  if (!raw || (!raw.fileId && !raw.sessionIds?.length)) return;
  const resources = {
    fileId: raw.fileId,
    sessionIds: Array.isArray(raw.sessionIds)
      ? raw.sessionIds.filter(value => typeof value === "string")
      : [],
  };
  const failures = await new GenxCompanyLearningClient().cleanup(resources);
  if (failures.length)
    throw new Error(
      "Temporary company-learning resources could not be cleaned up safely."
    );
  await updateJob(job.id, { temporaryResources: {} });
}

export function scheduleCompanyKnowledgeJob(jobId: number) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  setImmediate(() => {
    void advanceCompanyKnowledgeJob(jobId)
      .catch(error =>
        console.error("[company-knowledge] background job failed", {
          jobId,
          detail: safeText(error),
        })
      )
      .finally(() => activeJobs.delete(jobId));
  });
}

export async function startCompanyKnowledgeJob(input: {
  userId: number;
  organisationId: number;
  companyProfileId: number;
  websiteUrl: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const active = (
    await db
      .select()
      .from(companyKnowledgeJobs)
      .where(
        and(
          eq(companyKnowledgeJobs.userId, input.userId),
          eq(companyKnowledgeJobs.organisationId, input.organisationId),
          eq(companyKnowledgeJobs.companyProfileId, input.companyProfileId),
          inArray(companyKnowledgeJobs.status, ["queued", "running"])
        )
      )
      .orderBy(desc(companyKnowledgeJobs.createdAt))
      .limit(1)
  )[0];
  if (active) {
    if (
      active.status === "queued" ||
      !active.leaseExpiresAt ||
      active.leaseExpiresAt.getTime() <= Date.now()
    )
      scheduleCompanyKnowledgeJob(active.id);
    return presentCompanyKnowledgeJob(active);
  }
  const result = await db.insert(companyKnowledgeJobs).values({
    userId: input.userId,
    organisationId: input.organisationId,
    companyProfileId: input.companyProfileId,
    websiteUrl: input.websiteUrl,
    phase: "SCANNING_WEBSITE",
    status: "queued",
    progress: {
      humanStatus: "Scanning website",
      knowledgePersisted: false,
      knowledgeApproved: false,
      crmTouched: false,
      genieTouched: false,
    },
    attempt: 0,
    startedAt: new Date(),
  });
  const job = await loadJob(Number(result[0].insertId));
  await recordAudit({
    userId: input.userId,
    organisationId: input.organisationId,
    eventType: "company_knowledge_job_started",
    entityType: "company_knowledge_job",
    entityId: String(job.id),
    summary: "Whole-site company learning started in the background.",
    metadata: { companyProfileId: input.companyProfileId },
  });
  scheduleCompanyKnowledgeJob(job.id);
  return presentCompanyKnowledgeJob(job);
}

export async function getLatestCompanyKnowledgeJob(input: {
  userId: number;
  organisationId: number;
  companyProfileId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const job = (
    await db
      .select()
      .from(companyKnowledgeJobs)
      .where(
        and(
          eq(companyKnowledgeJobs.userId, input.userId),
          eq(companyKnowledgeJobs.organisationId, input.organisationId),
          eq(companyKnowledgeJobs.companyProfileId, input.companyProfileId)
        )
      )
      .orderBy(desc(companyKnowledgeJobs.createdAt))
      .limit(1)
  )[0];
  return job ? presentCompanyKnowledgeJob(job) : null;
}

export async function retryCompanyKnowledgeJob(input: {
  jobId: number;
  userId: number;
  organisationId: number;
  companyProfileId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database connection is unavailable.");
  const job = (
    await db
      .select()
      .from(companyKnowledgeJobs)
      .where(
        and(
          eq(companyKnowledgeJobs.id, input.jobId),
          eq(companyKnowledgeJobs.userId, input.userId),
          eq(companyKnowledgeJobs.organisationId, input.organisationId),
          eq(companyKnowledgeJobs.companyProfileId, input.companyProfileId)
        )
      )
      .limit(1)
  )[0];
  if (!job) throw new Error("The company-learning job is unavailable.");
  if (!["needs_attention", "failed"].includes(job.status))
    return presentCompanyKnowledgeJob(job);
  await updateJob(job.id, {
    status: "queued",
    lastError: null,
    leaseExpiresAt: null,
    completedAt: null,
    attempt: job.attempt + 1,
    progress: {
      ...(job.progress || {}),
      humanStatus: job.discoverySnapshot
        ? "Resuming retained company evidence"
        : "Scanning website",
    },
  });
  scheduleCompanyKnowledgeJob(job.id);
  return presentCompanyKnowledgeJob({
    ...job,
    status: "queued",
    lastError: null,
    completedAt: null,
    attempt: job.attempt + 1,
  });
}

async function checkpoint(
  job: CompanyKnowledgeJob,
  value: WholeSiteCheckpoint
) {
  const common = { leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) };
  if (value.kind === "resources") {
    await updateJob(job.id, { ...common, temporaryResources: value.resources });
    return;
  }
  if (value.kind === "corpus") {
    await updateJob(job.id, {
      ...common,
      phase: "CLASSIFYING_PAGES",
      corpusSnapshot: JSON.stringify(value.corpus),
      corpusHash: value.corpus.corpusHash,
      sourceHashes: value.corpus.sourceHashes,
      pageInventory: value.corpus.pages.map(page => ({
        pageId: page.pageId,
        url: page.url,
        contentHash: page.contentHash,
        pageHint: page.pageHint,
      })),
      progress: {
        ...(job.progress || {}),
        humanStatus: "Building company corpus",
        corpusPages: value.corpus.pageCount,
        corpusBytes: value.corpus.byteSize,
      },
    });
    return;
  }
  if (value.kind === "analysis") {
    await updateJob(job.id, {
      ...common,
      phase: "REVIEWING_PRICING_POLICIES",
      analysisDraft: JSON.stringify(value.draft),
      analysisCalls: 1,
      progress: {
        ...(job.progress || {}),
        humanStatus: "Checking products and pricing",
        analysisComplete: true,
      },
    });
    return;
  }
  await updateJob(job.id, {
    ...common,
    phase: "RECONCILING_KNOWLEDGE",
    auditDraft: JSON.stringify(value.audit),
    progress: {
      ...(job.progress || {}),
      humanStatus: "Auditing company knowledge",
      auditComplete: true,
    },
  });
}

async function advanceCompanyKnowledgeJob(jobId: number) {
  if (!(await claimCompanyKnowledgeJob(jobId))) return;
  let job = await loadJob(jobId);
  if (!job || job.status !== "running") return;
  try {
    await cleanupAbandonedResources(job);
    let discovery: DiscoveryResult;
    if (job.discoverySnapshot)
      discovery = JSON.parse(job.discoverySnapshot) as DiscoveryResult;
    else {
      await updateJob(job.id, {
        phase: "SCANNING_WEBSITE",
        progress: { ...(job.progress || {}), humanStatus: "Scanning website" },
      });
      discovery = await discoverPublicWebsite(job.websiteUrl);
      await updateJob(job.id, {
        discoverySnapshot: JSON.stringify(discovery),
        phase: "CLASSIFYING_PAGES",
        progress: {
          ...(job.progress || {}),
          humanStatus: "Building company corpus",
          pagesScanned: discovery.pages.length,
        },
        leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
      });
      job = { ...job, discoverySnapshot: JSON.stringify(discovery) };
    }
    const corpus = parseCheckpoint(
      job.corpusSnapshot,
      value => value as CompanyCorpus
    );
    const draft = parseCheckpoint(job.analysisDraft, value =>
      companyKnowledgePackSchema.parse(value)
    );
    const audit = parseCheckpoint(job.auditDraft, value =>
      companyKnowledgeAuditSchema.parse(value)
    );
    const review = await synthesiseCompanyKnowledge({
      userId: job.userId,
      organisationId: job.organisationId,
      pages: pagesForCompanyReview(discovery),
      reference: `company-knowledge-job:${job.id}:attempt-${job.attempt}`,
      resume: { corpus, draft, audit },
      onCheckpoint: value => checkpoint(job, value),
      onPhase: async phase => {
        const nextPhase =
          phase === "corpus"
            ? ("CLASSIFYING_PAGES" as const)
            : phase === "analysis"
              ? ("UNDERSTANDING_OFFERINGS" as const)
              : phase === "audit"
                ? ("RECONCILING_KNOWLEDGE" as const)
                : ("CHECKING_COMPLETENESS" as const);
        await updateJob(job.id, {
          phase: nextPhase,
          progress: {
            ...(job.progress || {}),
            humanStatus: humanPhase(nextPhase),
          },
          leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
        });
      },
    });
    const canonical = buildReviewedCompanyDiscovery(discovery, review);
    const discoveryId = await saveWebsiteDiscoveryReview({
      userId: job.userId,
      organisationId: job.organisationId,
      companyProfileId: job.companyProfileId,
      sourceUrl: canonical.discovery.sourceUrl,
      pageTitle: canonical.discovery.pageTitle,
      extractedText: canonical.discovery.extractedText,
      proposedFacts: {
        ...canonical.discovery.proposedFacts,
        pages: canonical.discovery.pages,
        companyIntelligenceReview: {
          agentKey: "company_intelligence_review",
          state: canonical.reviewState,
        },
      },
      proposedKnowledge: canonical.proposedKnowledge,
      reviewAgentKey: "company_intelligence_review",
      reviewState: canonical.reviewState,
    });
    const ready = review.completeness.status !== "incomplete";
    await updateJob(job.id, {
      phase: ready ? "READY_FOR_REVIEW" : "CHECKING_COMPLETENESS",
      status: ready ? "ready" : "needs_attention",
      resultDiscoveryId: discoveryId,
      validatedPack: JSON.stringify(review.pack),
      analysisCalls: review.analysisCalls,
      auditCalls: review.auditCalls,
      normalizationEvents: review.normalizationEvents,
      repairCalls: review.repairCalls,
      temporaryResources: {},
      progress: {
        humanStatus: ready
          ? "Ready for review"
          : "Company knowledge needs attention",
        ...review.completeness,
        corpusPages: review.corpus.pageCount,
        corpusBytes: review.corpus.byteSize,
        analysisCalls: review.analysisCalls,
        auditCalls: review.auditCalls,
        normalizationEvents: review.normalizationEvents,
        repairCalls: review.repairCalls,
        totalAiCalls: review.totalAiCalls,
        knowledgePersisted: false,
        knowledgeApproved: false,
        crmTouched: false,
        genieTouched: false,
      },
      lastError: ready ? null : review.completeness.importantGaps.join(" "),
      leaseExpiresAt: null,
      completedAt: new Date(),
    });
    await recordAudit({
      userId: job.userId,
      organisationId: job.organisationId,
      eventType: ready
        ? "company_knowledge_job_ready"
        : "company_knowledge_job_incomplete",
      entityType: "company_knowledge_job",
      entityId: String(job.id),
      summary: ready
        ? "Whole-site company knowledge is ready for deliberate human review."
        : "Whole-site company knowledge requires a recoverable retry.",
      metadata: {
        resultDiscoveryId: discoveryId,
        completenessStatus: review.completeness.status,
        corpusHash: review.corpus.corpusHash,
        totalAiCalls: review.totalAiCalls,
      },
    });
  } catch (error) {
    const detail = safeText(error);
    await updateJob(job.id, {
      status: "needs_attention",
      lastError: detail,
      leaseExpiresAt: null,
      completedAt: new Date(),
      progress: {
        ...(job.progress || {}),
        humanStatus: "Company learning needs attention",
        knowledgePersisted: false,
        knowledgeApproved: false,
        crmTouched: false,
        genieTouched: false,
      },
    });
  }
}

export async function resumeCompanyKnowledgeJobs() {
  const db = await getDb();
  if (!db) return 0;
  const jobs = await db
    .select({ id: companyKnowledgeJobs.id })
    .from(companyKnowledgeJobs)
    .where(
      and(
        inArray(companyKnowledgeJobs.status, ["queued", "running"]),
        or(
          isNull(companyKnowledgeJobs.leaseExpiresAt),
          lt(companyKnowledgeJobs.leaseExpiresAt, new Date())
        )
      )
    )
    .limit(100);
  jobs.forEach(job => scheduleCompanyKnowledgeJob(job.id));
  return jobs.length;
}

export function startCompanyKnowledgeWorker(intervalMs = 10_000) {
  void resumeCompanyKnowledgeJobs().catch(error =>
    console.error("[company-knowledge] resume failed", {
      detail: safeText(error),
    })
  );
  const timer = setInterval(
    () =>
      void resumeCompanyKnowledgeJobs().catch(error =>
        console.error("[company-knowledge] poll failed", {
          detail: safeText(error),
        })
      ),
    Math.max(2_000, intervalMs)
  );
  timer.unref();
  return timer;
}
