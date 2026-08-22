import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { connectedSystems, connectionSecrets, connectorWebhookReceipts } from "../../drizzle/schema";
import { getDb } from "../db";
import { decryptConnectionSecret } from "../security/connectionSecrets";
import { assessWebhookIntake } from "./webhookIntake";

type WebhookSecret = { secret?: string; algorithm?: "sha256" | "sha512" };

function header(req: Request, name: string) {
  const value = req.header(name);
  return value?.trim() || undefined;
}

export function registerConnectorWebhookRoutes(app: Express) {
  app.post("/api/connector-webhooks/:connectedSystemId", async (req: Request, res: Response) => {
    const connectedSystemId = Number(req.params.connectedSystemId);
    const payload = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const eventId = header(req, "x-event-id") || createHash("sha256").update(payload).digest("hex");
    const eventType = header(req, "x-event-type") || "unknown";
    const signature = header(req, "x-amarktai-signature") || header(req, "x-hub-signature-256") || header(req, "x-signature");
    try {
      if (!Number.isInteger(connectedSystemId) || connectedSystemId <= 0 || !payload) return res.status(202).json({ accepted: true, processingStatus: "ignored" });
      const db = await getDb(); if (!db) return res.status(503).json({ accepted: false, error: "database_unavailable" });
      const system = (await db.select().from(connectedSystems).where(eq(connectedSystems.id, connectedSystemId)).limit(1))[0];
      if (!system) return res.status(202).json({ accepted: true, processingStatus: "ignored" });
      const secretRecord = (await db.select().from(connectionSecrets).where(and(eq(connectionSecrets.connectedSystemId, connectedSystemId), eq(connectionSecrets.secretKind, "webhook_hmac"))).limit(1))[0];
      const secret = secretRecord ? decryptConnectionSecret<WebhookSecret>(secretRecord) : {};
      const decision = assessWebhookIntake({ status: system.status, verifiedCapabilities: system.verifiedCapabilities, webhookSecret: secret.secret, webhookAlgorithm: secret.algorithm }, payload, signature);
      const payloadHash = createHash("sha256").update(payload).digest("hex");
      await db.insert(connectorWebhookReceipts).values({ organisationId: system.organisationId, connectedSystemId, eventId: eventId.slice(0, 220), eventType: eventType.slice(0, 160), signatureStatus: decision.signatureStatus, processingStatus: decision.processingStatus, payloadHash });
      return res.status(202).json({ accepted: true, processingStatus: decision.processingStatus });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "connector_webhook_intake_error", connectedSystemId, detail: detail.slice(0, 240) }));
      return res.status(202).json({ accepted: true, processingStatus: "ignored" });
    }
  });
}
