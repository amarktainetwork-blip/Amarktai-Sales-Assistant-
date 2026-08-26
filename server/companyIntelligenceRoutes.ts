import type { Express, Response } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { websiteDiscoveries } from "../drizzle/schema";
import { discoverAndReviewCompanyIntelligence, retainedPagesForCompanyReview, reviewStoredCompanyIntelligence } from "./companyIntelligenceService";
import {
  getCompanySetup,
  getDb,
  recordAudit,
  saveWebsiteDiscoveryReview,
} from "./db";
import { requireLocalHttpContext } from "./httpAuth";
import { canManageOrganisation } from "./organisation";

function sendError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /AUTH_REQUIRED/.test(message)
    ? 401
    : /TWO_FACTOR_REQUIRED/.test(message)
      ? 403
      : /MANAGER_REQUIRED/.test(message)
        ? 403
        : 400;
  return res.status(status).json({ error: message.slice(0, 1_000) });
}

async function requireManager(req: Parameters<typeof requireLocalHttpContext>[0]) {
  const context = await requireLocalHttpContext(req);
  if (!canManageOrganisation(context.membership.role))
    throw new Error("MANAGER_REQUIRED");
  return context;
}

export function registerCompanyIntelligenceRoutes(app: Express) {
  app.post("/api/company-intelligence/discover", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const setup = await getCompanySetup(userId, membership.organisationId);
      if (!setup.profile?.websiteUrl)
        throw new Error("Save a public company website before learning the business.");

      const canonical = await discoverAndReviewCompanyIntelligence({
        userId,
        organisationId: membership.organisationId,
        websiteUrl: setup.profile.websiteUrl,
        reference: `website-review:http:${setup.profile.id}:${Date.now()}`,
      });
      const { discovery, proposedKnowledge: reviewedCandidates, aiReview, reviewState, reviewUnavailable } = canonical;

      const discoveryId = await saveWebsiteDiscoveryReview({
        userId,
        organisationId: membership.organisationId,
        companyProfileId: setup.profile.id,
        sourceUrl: discovery.sourceUrl,
        pageTitle: discovery.pageTitle,
        extractedText: discovery.extractedText,
        proposedFacts: {
          ...discovery.proposedFacts,
          pages: discovery.pages,
          aiReview,
          reviewState,
          reviewUnavailable: reviewUnavailable || null,
          discoveryVersion: new Date().toISOString(),
        },
        proposedKnowledge: reviewedCandidates,
      });

      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const olderDrafts = await db
        .select({ id: websiteDiscoveries.id })
        .from(websiteDiscoveries)
        .where(
          and(
            eq(websiteDiscoveries.organisationId, membership.organisationId),
            eq(websiteDiscoveries.companyProfileId, setup.profile.id),
            eq(websiteDiscoveries.status, "review_required"),
            ne(websiteDiscoveries.id, discoveryId)
          )
        )
        .orderBy(desc(websiteDiscoveries.createdAt));
      if (olderDrafts.length) {
        await db
          .update(websiteDiscoveries)
          .set({ status: "rejected", reviewedAt: new Date() })
          .where(
            and(
              eq(websiteDiscoveries.organisationId, membership.organisationId),
              eq(websiteDiscoveries.companyProfileId, setup.profile.id),
              eq(websiteDiscoveries.status, "review_required"),
              ne(websiteDiscoveries.id, discoveryId)
            )
          );
        await recordAudit({
          userId,
          organisationId: membership.organisationId,
          eventType: "website_discovery_superseded",
          entityType: "website_discovery",
          entityId: String(discoveryId),
          summary: "A fresh website review superseded older unapproved drafts.",
          metadata: { supersededDiscoveryIds: olderDrafts.map(item => item.id) },
        });
      }

      return res.json({
        ...discovery,
        proposedKnowledge: reviewedCandidates,
        discoveryId,
        aiReview,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/company-intelligence/:id/review", async (req, res) => {
    try {
      const { userId, membership } = await requireManager(req);
      const discoveryId = Number(req.params.id);
      if (!Number.isInteger(discoveryId) || discoveryId < 1)
        throw new Error("A valid website review is required.");
      const db = await getDb();
      if (!db) throw new Error("Database connection is unavailable.");
      const discovery = (
        await db
          .select()
          .from(websiteDiscoveries)
          .where(
            and(
              eq(websiteDiscoveries.id, discoveryId),
              eq(websiteDiscoveries.organisationId, membership.organisationId),
              eq(websiteDiscoveries.userId, userId),
              eq(websiteDiscoveries.status, "review_required")
            )
          )
          .limit(1)
      )[0];
      if (!discovery)
        throw new Error("That website review is unavailable or already completed.");
      const setup = await getCompanySetup(userId, membership.organisationId);
      if (!setup.profile) throw new Error("Company profile is unavailable.");
      const retainedMetadata = Array.isArray((discovery.proposedFacts as { pages?: unknown }).pages)
        ? ((discovery.proposedFacts as { pages: Array<{ url: string; title?: string | null; fetchedAt?: string }> }).pages)
        : [];
      const retainedPages = retainedPagesForCompanyReview(discovery.extractedText || "", retainedMetadata);
      const reviewed = await reviewStoredCompanyIntelligence({
        userId,
        organisationId: membership.organisationId,
        discoveryId: discovery.id,
        pages: retainedPages,
      });
      await db
        .update(websiteDiscoveries)
        .set({
          proposedKnowledge: reviewed.proposedKnowledge,
          proposedFacts: { ...discovery.proposedFacts, aiReview: reviewed.aiReview, reviewState: "completed", reviewUnavailable: null },
        })
        .where(eq(websiteDiscoveries.id, discovery.id));
      await recordAudit({
        userId,
        organisationId: membership.organisationId,
        eventType: "company_intelligence_review_retried",
        entityType: "website_discovery",
        entityId: String(discovery.id),
        summary: "AI interpretation was retried from retained raw page evidence without recrawling the website.",
          metadata: { candidateCount: reviewed.proposedKnowledge.length, canonicalService: true, retainedEvidenceOnly: true },
      });
      return res.json({
        discoveryId: discovery.id,
        proposedKnowledge: reviewed.proposedKnowledge,
        aiReview: reviewed.aiReview,
        reviewState: "completed",
      });
    } catch (error) {
      return sendError(res, error);
    }
  });
}
