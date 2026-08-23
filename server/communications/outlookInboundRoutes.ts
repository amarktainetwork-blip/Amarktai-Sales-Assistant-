import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { enqueueOutlookInboundBatch } from "./outlookInboundQueue";

function sameSecret(actual: unknown, expected: string) {
  const left = Buffer.from(typeof actual === "string" ? actual : "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createOutlookInboundHandler(
  input: {
    enqueue?: typeof enqueueOutlookInboundBatch;
  } = {}
) {
  const enqueue = input.enqueue || enqueueOutlookInboundBatch;
  return async (req: Request, res: Response) => {
    const validationToken =
      typeof req.query.validationToken === "string"
        ? req.query.validationToken
        : "";
    if (validationToken)
      return res
        .type("text/plain")
        .status(200)
        .send(validationToken.slice(0, 2_000));
    const clientState = process.env.OUTLOOK_WEBHOOK_CLIENT_STATE?.trim() || "";
    const organisationId = Number(
      process.env.OUTLOOK_INBOUND_ORGANISATION_ID || 0
    );
    if (
      clientState.length < 24 ||
      !Number.isInteger(organisationId) ||
      organisationId <= 0
    )
      return res
        .status(202)
        .json({ accepted: true, processingStatus: "not_configured" });
    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
    const queued: Array<{
      organisationId: number;
      messageId: string;
      subscriptionId?: string;
    }> = [];
    let rejected = 0;
    for (const notification of notifications.slice(0, 100)) {
      if (
        !notification ||
        typeof notification !== "object" ||
        !sameSecret(
          (notification as Record<string, unknown>).clientState,
          clientState
        )
      ) {
        rejected += 1;
        continue;
      }
      const source = notification as {
        resourceData?: { id?: string };
        resource?: string;
      };
      const messageId =
        source.resourceData?.id ||
        source.resource?.match(/messages\/([^/?]+)/i)?.[1];
      if (!messageId) {
        rejected += 1;
        continue;
      }
      let decodedMessageId = "";
      try {
        decodedMessageId = decodeURIComponent(messageId);
      } catch {
        rejected += 1;
        continue;
      }
      queued.push({
        organisationId,
        messageId: decodedMessageId,
        subscriptionId:
          typeof (notification as Record<string, unknown>).subscriptionId ===
          "string"
            ? String((notification as Record<string, unknown>).subscriptionId)
            : undefined,
      });
    }
    const result = await enqueue(queued);
    return res.status(202).json({
      accepted: true,
      queued: result.accepted,
      rejected,
    });
  };
}

export function registerOutlookInboundRoutes(app: Express) {
  app.post("/api/outlook/inbound", createOutlookInboundHandler());
}
