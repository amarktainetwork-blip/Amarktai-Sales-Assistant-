import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  companyKnowledgeJobs,
  companyProfiles,
  websiteDiscoveries,
} from "../drizzle/schema";
import { getDb } from "./db";
import { startCompanyKnowledgeJob } from "./companyKnowledgeJobs";

const HOUR_MS = 60 * 60_000;

export function companyKnowledgeAutoRefreshIntervalMs() {
  const configured = Number(
    process.env.COMPANY_KNOWLEDGE_AUTO_REFRESH_HOURS || 24
  );
  if (!Number.isFinite(configured) || configured <= 0) return 24 * HOUR_MS;
  return Math.max(6, Math.min(168, configured)) * HOUR_MS;
}

export function shouldQueueCompanyKnowledgeRefresh(input: {
  now: Date;
  intervalMs: number;
  latestJobCreatedAt?: Date | null;
  pendingReview: boolean;
  activeJob: boolean;
}) {
  if (input.pendingReview || input.activeJob) return false;
  if (!input.latestJobCreatedAt) return true;
  return (
    input.latestJobCreatedAt.valueOf() <=
    input.now.valueOf() - input.intervalMs
  );
}

/**
 * Re-checks already-confirmed company websites without ever overwriting trusted
 * knowledge. Every refresh runs through the existing bounded crawler + GenX
 * synthesis pipeline and produces a new manager review. A pending review blocks
 * another refresh so we do not stack drafts or spend AI credits pointlessly.
 */
export async function enqueueDueCompanyKnowledgeRefreshes(now = new Date()) {
  const db = await getDb();
  if (!db) return 0;
  const intervalMs = companyKnowledgeAutoRefreshIntervalMs();
  const profiles = await db
    .select({
      id: companyProfiles.id,
      userId: companyProfiles.userId,
      organisationId: companyProfiles.organisationId,
      websiteUrl: companyProfiles.websiteUrl,
    })
    .from(companyProfiles)
    .where(
      and(
        eq(companyProfiles.discoveryStatus, "confirmed"),
        isNotNull(companyProfiles.organisationId),
        isNotNull(companyProfiles.websiteUrl)
      )
    )
    .limit(50);

  let queued = 0;
  for (const profile of profiles) {
    if (!profile.organisationId || !profile.websiteUrl) continue;
    const [pendingReview, latestJob, activeJob] = await Promise.all([
      db
        .select({ id: websiteDiscoveries.id })
        .from(websiteDiscoveries)
        .where(
          and(
            eq(websiteDiscoveries.companyProfileId, profile.id),
            eq(websiteDiscoveries.status, "review_required")
          )
        )
        .limit(1),
      db
        .select({ createdAt: companyKnowledgeJobs.createdAt })
        .from(companyKnowledgeJobs)
        .where(eq(companyKnowledgeJobs.companyProfileId, profile.id))
        .orderBy(desc(companyKnowledgeJobs.createdAt))
        .limit(1),
      db
        .select({ id: companyKnowledgeJobs.id })
        .from(companyKnowledgeJobs)
        .where(
          and(
            eq(companyKnowledgeJobs.companyProfileId, profile.id),
            inArray(companyKnowledgeJobs.status, ["queued", "running"])
          )
        )
        .limit(1),
    ]);

    if (
      !shouldQueueCompanyKnowledgeRefresh({
        now,
        intervalMs,
        latestJobCreatedAt: latestJob[0]?.createdAt,
        pendingReview: pendingReview.length > 0,
        activeJob: activeJob.length > 0,
      })
    )
      continue;

    await startCompanyKnowledgeJob({
      userId: profile.userId,
      organisationId: profile.organisationId,
      companyProfileId: profile.id,
      websiteUrl: profile.websiteUrl,
    });
    queued += 1;
  }
  return queued;
}

export function startCompanyKnowledgeAutoRefreshWorker(
  pollMs = HOUR_MS
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const queued = await enqueueDueCompanyKnowledgeRefreshes();
      if (queued)
        console.log(
          JSON.stringify({
            event: "company_knowledge_auto_refresh_queued",
            queued,
          })
        );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "company_knowledge_auto_refresh_failed",
          detail:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        })
      );
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), Math.max(5 * 60_000, pollMs));
  timer.unref();
  return timer;
}
