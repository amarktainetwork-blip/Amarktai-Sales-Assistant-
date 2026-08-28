import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  companyKnowledgeJobs,
  type CompanyKnowledgeJob,
} from "../drizzle/schema";
import { discoverPublicWebsite, type DiscoveryResult } from "./companyDiscovery";
import {
  buildReviewedCompanyDiscovery,
  pagesForCompanyReview,
} from "./companyIntelligenceService";
import {
  buildCompanyPageInventory,
  synthesiseCompanyKnowledge,
  type CompanyKnowledgeMapResult,
} from "./companyKnowledgeSynthesis";
import {
  getDb,
  recordAudit,
  saveWebsiteDiscoveryReview,
} from "./db";

const JOB_LEASE_MS = 15 * 60_000;
const activeJobs = new Set<number>();

function safeText(value: unknown, maximum = 2_000) {
  return String(value || "")
    .replace(/genx/gi, "Amarktai intelligence")
    .replace(/provider/gi, "service")
    .replace(/playwright|chromium/gi, "website reader")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function humanPhase(phase: CompanyKnowledgeJob["phase"]) {
  const labels: Record<CompanyKnowledgeJob["phase"], string> = {
    SCANNING_WEBSITE: "Scanning website",
    CLASSIFYING_PAGES: "Classifying pages",
    UNDERSTANDING_OFFERINGS: "Understanding offerings",
    REVIEWING_PRICING_POLICIES: "Reviewing pricing and policies",
    RECONCILING_KNOWLEDGE: "Reconciling company knowledge",
    CHECKING_COMPLETENESS: "Checking completeness",
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

function resumableMapResultsForRetry(job: CompanyKnowledgeJob) {
  const results = (job.mapResults || []) as CompanyKnowledgeMapResult[];
  if (!/likely sellable offering page/i.test(job.lastError || ""))
    return results;
  const inventory = (job.pageInventory || []) as Array<{
    url?: string;
    likelyOffering?: boolean;
  }>;
  const likelyOfferingUrls = new Set(
    inventory
      .filter(page => page.likelyOffering && page.url)
      .map(page => page.url!)
  );
  return results.filter(result => {
    if (result.status !== "completed" || !likelyOfferingUrls.has(result.pageUrl))
      return true;
    return result.items.some(item =>
      item.classification === "company_offering"
      && Boolean(item.offering?.name)
      && item.sourceUrls.includes(result.pageUrl)
      && (
        item.reviewState === "conflict"
        || (item.trustEligible && item.reviewState === "review_required")
      )
    );
  });
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
    const leaseExpired =
      !active.leaseExpiresAt || active.leaseExpiresAt.getTime() <= Date.now();
    if (active.status === "queued" || leaseExpired)
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
    summary: "Complete company website learning started in the background.",
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
  const resumeMapResults = resumableMapResultsForRetry(job);
  await updateJob(job.id, {
    status: "queued",
    lastError: null,
    leaseExpiresAt: null,
    completedAt: null,
    attempt: job.attempt + 1,
    mapResults: resumeMapResults,
    progress: {
      ...(job.progress || {}),
      humanStatus: job.discoverySnapshot
        ? "Resuming retained website evidence"
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
    mapResults: resumeMapResults,
  });
}

async function advanceCompanyKnowledgeJob(jobId: number) {
  const claimed = await claimCompanyKnowledgeJob(jobId);
  if (!claimed) return;
  let job = await loadJob(jobId);
  if (!job || job.status !== "running") return;
  try {
    let discovery: DiscoveryResult;
    if (job.discoverySnapshot) {
      discovery = JSON.parse(job.discoverySnapshot) as DiscoveryResult;
    } else {
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
          humanStatus: "Classifying pages",
          pagesScanned: discovery.pages.length,
        },
        leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
      });
      job = { ...job, discoverySnapshot: JSON.stringify(discovery) };
    }

    const pages = pagesForCompanyReview(discovery);
    const inventory = buildCompanyPageInventory(pages);
    await updateJob(job.id, {
      phase: "CLASSIFYING_PAGES",
      pageInventory: inventory,
      progress: {
        ...(job.progress || {}),
        humanStatus: "Classifying pages",
        pagesScanned: discovery.pages.length,
        pagesClassified: inventory.length,
        pagesExcluded: inventory.filter(page => page.excludedReason).length,
      },
      leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
    });

    const resumeMapResults = (job.mapResults || []) as CompanyKnowledgeMapResult[];
    const review = await synthesiseCompanyKnowledge({
      userId: job.userId,
      organisationId: job.organisationId,
      pages,
      reference: `company-knowledge-job:${job.id}:attempt-${job.attempt}`,
      resumeMapResults,
      onCheckpoint: async mapResults => {
        await updateJob(job.id, {
          phase: "UNDERSTANDING_OFFERINGS",
          mapResults,
          progress: {
            ...(job.progress || {}),
            humanStatus: "Understanding offerings",
            pagesMapped: mapResults.filter(item => item.status === "completed").length,
            mapFailures: mapResults.filter(item => item.status === "failed").length,
          },
          leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
        });
      },
      onPhase: async phase => {
        const nextPhase = phase === "mapping"
          ? "UNDERSTANDING_OFFERINGS" as const
          : phase === "reviewing"
            ? "REVIEWING_PRICING_POLICIES" as const
          : phase === "reconciling"
            ? "RECONCILING_KNOWLEDGE" as const
            : "CHECKING_COMPLETENESS" as const;
        await updateJob(job.id, {
          phase: nextPhase,
          progress: { ...(job.progress || {}), humanStatus: humanPhase(nextPhase) },
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
          unavailableReason: null,
          review: canonical.aiReview,
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
      pageInventory: review.pageInventory,
      mapResults: review.mapResults,
      progress: {
        humanStatus: ready ? "Ready for review" : "Knowledge pack needs attention",
        ...review.completeness,
        knowledgePersisted: false,
        knowledgeApproved: false,
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
        ? "Complete company knowledge is ready for deliberate human review."
        : "Company knowledge remains incomplete and requires a recoverable retry.",
      metadata: {
        resultDiscoveryId: discoveryId,
        completenessStatus: review.completeness.status,
        pagesScanned: review.completeness.pagesScanned,
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
    console.error("[company-knowledge] resume failed", { detail: safeText(error) })
  );
  const timer = setInterval(
    () => void resumeCompanyKnowledgeJobs().catch(error =>
      console.error("[company-knowledge] poll failed", { detail: safeText(error) })
    ),
    Math.max(2_000, intervalMs)
  );
  timer.unref();
  return timer;
}
