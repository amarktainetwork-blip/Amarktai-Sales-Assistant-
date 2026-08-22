import type { Express } from "express";
import { isAuthorisedDomain } from "../connectedSystems";
import { getTodayWork } from "../today";
import { validateSidecarSession } from "./sidecarSessions";

function bearer(header?: string) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/**
 * The extension receives only a short-lived user session and non-sensitive
 * workspace context. It cannot reach CRM secrets or arbitrary browser pages.
 */
export function registerSidecarRoutes(app: Express) {
  app.get("/api/sidecar/context", async (req, res) => {
    try {
      const token = bearer(req.header("authorization"));
      const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
      if (!token || !rawUrl) return res.status(400).json({ error: "A browser sidecar session and page URL are required." });
      const page = new URL(rawUrl);
      if (page.protocol !== "https:" && page.protocol !== "http:") return res.status(400).json({ error: "Only browser business pages can be evaluated." });
      const session = await validateSidecarSession(token);
      const allowed = await isAuthorisedDomain({ organisationId: session.organisationId, hostname: page.hostname, pathname: page.pathname });
      if (!allowed) return res.status(403).json({ error: "This page is not an authorised organisation business domain." });
      const today = await getTodayWork({ userId: session.userId, organisationId: session.organisationId });
      const priority = today.queues.priority.slice(0, 3).map(record => ({ id: record.id, name: record.name, stage: record.stage, valueMinor: record.valueMinor, currency: record.currency, reasons: record.reasons }));
      res.setHeader("Cache-Control", "no-store");
      return res.json({ authorised: true, page: { hostname: page.hostname, pathname: page.pathname }, today: { metrics: today.metrics, priority }, calibrationNotice: "Record-specific extraction is available only after this system’s reviewed page detector and record extractor have been calibrated." });
    } catch (error) {
      return res.status(401).json({ error: error instanceof Error ? error.message : "Unable to establish browser sidecar context." });
    }
  });
}
