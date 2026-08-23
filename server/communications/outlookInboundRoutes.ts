import { timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { ingestInboundMessage } from "./inboundPipeline";
import { readOutlookInboundMessage } from "../outlook";

function sameSecret(actual: unknown, expected: string) {
  const left = Buffer.from(typeof actual === "string" ? actual : "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function registerOutlookInboundRoutes(app: Express) {
  app.post("/api/outlook/inbound", async (req, res) => {
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
    const results: Array<Record<string, unknown>> = [];
    for (const notification of notifications.slice(0, 100)) {
      if (
        !notification ||
        typeof notification !== "object" ||
        !sameSecret(
          (notification as Record<string, unknown>).clientState,
          clientState
        )
      ) {
        results.push({ accepted: false, reason: "client_state_mismatch" });
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
        results.push({ accepted: false, reason: "message_id_missing" });
        continue;
      }
      try {
        results.push({
          accepted: true,
          ...(await ingestInboundMessage({
            organisationId,
            envelope: await readOutlookInboundMessage(
              decodeURIComponent(messageId)
            ),
          })),
        });
      } catch (error) {
        results.push({
          accepted: false,
          reason:
            error instanceof Error
              ? error.message.slice(0, 300)
              : String(error).slice(0, 300),
        });
      }
    }
    return res
      .status(202)
      .json({
        accepted: true,
        processed: results.filter(result => result.accepted).length,
        results,
      });
  });
}
