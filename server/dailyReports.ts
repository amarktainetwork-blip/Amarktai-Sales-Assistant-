import type { Express, Request, Response } from "express";
import { getAssistantDashboard, getDailyReportByTaskUid, markDailyReportDelivery, releaseDailyReportDelivery } from "./db";
import { sdk } from "./_core/sdk";
import { sendDailyWorkspaceReport } from "./smtp";

export function registerDailyReportRoutes(app: Express) {
  app.post("/api/scheduled/daily-report", async (req: Request, res: Response) => {
    try {
      const cronUser = await sdk.authenticateRequest(req);
      if (!cronUser.isCron || !cronUser.taskUid) return res.status(403).json({ error: "cron-only" });

      const report = await getDailyReportByTaskUid(cronUser.taskUid);
      if (!report || !report.isEnabled) return res.json({ ok: true, skipped: "orphan-or-disabled" });

      const deliveryKey = new Date().toISOString().slice(0, 10);
      if (report.lastDeliveryKey === deliveryKey) return res.json({ ok: true, skipped: "already-delivered", deliveryKey });

      await markDailyReportDelivery(report.id, deliveryKey);
      const dashboard = await getAssistantDashboard(report.userId);
      try {
        await sendDailyWorkspaceReport({ to: report.recipientEmail, ...dashboard.metrics });
      } catch (error) {
        await releaseDailyReportDelivery(report.id, deliveryKey);
        throw error;
      }

      return res.json({ ok: true, reportId: report.id, deliveryKey });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: detail, context: { url: req.originalUrl }, timestamp: new Date().toISOString() });
    }
  });
}
