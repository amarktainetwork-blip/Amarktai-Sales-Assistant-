import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { connectedSystems, inboundMessages } from "../../drizzle/schema";
import { getDb } from "../db";
import { classifyInboundMessage } from "./inboundReview";
import { inboundIdempotencyKey, ingestInboundMessage } from "./inboundPipeline";

/**
 * Operator-only, local-cache correction for previously ingested SMS opt-outs.
 * Reprocesses exact stored source records through the idempotent ingestion and
 * suppression path; never invokes Genie or sends any external communication.
 */
async function main() {
  const organisationId = Number(process.env.AMARKTAI_COMMISSION_ORGANISATION_ID);
  const connectedSystemId = Number(process.env.AMARKTAI_COMMISSION_CONNECTED_SYSTEM_ID);
  const mailboxUserId = Number(process.env.AMARKTAI_COMMISSION_USER_ID);
  if (![organisationId, connectedSystemId, mailboxUserId].every(
    id => Number.isSafeInteger(id) && id > 0
  )) throw Error("EXPLICIT_MAILBOX_SOURCE_SCOPE_REQUIRED");
  const db = await getDb();
  if (!db) throw Error("DATABASE_UNAVAILABLE");
  const [system] = await db.select().from(connectedSystems).where(and(
    eq(connectedSystems.organisationId, organisationId),
    eq(connectedSystems.id, connectedSystemId)
  )).limit(1);
  if (!system || system.provider !== "genie" ||
      system.allowedWriteCapabilities.length !== 0)
    throw Error("EXPLICIT_READ_ONLY_GENIE_SCOPE_REQUIRED");

  const candidates = await db.select().from(inboundMessages).where(and(
    eq(inboundMessages.organisationId, organisationId),
    eq(inboundMessages.connectedSystemId, connectedSystemId),
    eq(inboundMessages.mailboxUserId, mailboxUserId),
    eq(inboundMessages.channel, "sms"),
    eq(inboundMessages.needsAction, true),
    sql.raw("LOWER(TRIM(inboundMessages.body)) IN ('stop','stop.','stop!','stopall','unsubscribe')")
  )).orderBy(inboundMessages.id).limit(100);
  let corrected = 0;
  for (const row of candidates) {
    if (!row.externalMessageId || !row.senderReference ||
        row.idempotencyKey !== inboundIdempotencyKey(
          organisationId, "sms", row.externalMessageId, mailboxUserId
        ) ||
        !Number.isFinite(row.receivedAt.getTime()) ||
        classifyInboundMessage({ subject: row.subject, body: row.body }).category !== "unsubscribe")
      throw Error("EXACT_STORED_SMS_OPT_OUT_SOURCE_REQUIRED");
    const metadata = row.classification &&
      typeof row.classification === "object" &&
      !Array.isArray(row.classification)
      ? row.classification as Record<string, unknown> : {};
    const result = await ingestInboundMessage({
      organisationId, mailboxUserId, connectedSystemId,
      envelope: {
        externalMessageId: row.externalMessageId,
        channel: "sms",
        senderReference: row.senderReference,
        ...(row.contactExternalId ? { contactExternalId: row.contactExternalId } : {}),
        ...(typeof metadata.conversationExternalId === "string"
          ? { conversationExternalId: metadata.conversationExternalId } : {}),
        ...(typeof metadata.recipientReference === "string"
          ? { recipientReference: metadata.recipientReference } : {}),
        subject: row.subject || undefined,
        body: row.body,
        receivedAt: row.receivedAt,
      },
    });
    if (result.id !== row.id || result.classification.category !== "unsubscribe" ||
        result.needsAction || result.replyEligible)
      throw Error("OPT_OUT_RECLASSIFICATION_DID_NOT_CONVERGE");
    corrected += 1;
  }
  console.log("CACHED_SMS_OPT_OUTS_RECONCILED", JSON.stringify({
    organisationScopeVerified: true,
    personalMailboxScopeVerified: true,
    boundedSourceRows: candidates.length,
    corrected,
    noExternalCRMReadsOrWrites: true,
    noOutboundSends: true,
  }));
  if (candidates.length === 100) process.exitCode = 2;
}
main().then(() => process.exit(typeof process.exitCode === "number" ? process.exitCode : 0))
  .catch(error => {
    console.error("SMS_OPT_OUT_RECONCILIATION_FAILED",
      String(error instanceof Error ? error.message : error).slice(0, 220));
    process.exit(1);
  });
