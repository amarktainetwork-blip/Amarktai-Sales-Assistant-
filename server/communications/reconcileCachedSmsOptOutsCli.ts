import "dotenv/config";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { connectedSystems, contactCommunicationSuppressions, inboundMessages } from "../../drizzle/schema";
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

  // Include archived/handled historical STOP records if their classification
  // or suppression was never corrected. The one-per-sender suppression may
  // point to a newer message, so match the organisation/channel/sender rather
  // than requiring every old message to be the suppression sourceMessageId.
  const candidates = (await db.select({ message: inboundMessages })
    .from(inboundMessages)
    .leftJoin(contactCommunicationSuppressions, and(
      eq(contactCommunicationSuppressions.organisationId, inboundMessages.organisationId),
      eq(contactCommunicationSuppressions.channel, inboundMessages.channel),
      eq(contactCommunicationSuppressions.senderReference, inboundMessages.senderReference)
    ))
    .where(and(
      eq(inboundMessages.organisationId, organisationId),
      eq(inboundMessages.connectedSystemId, connectedSystemId),
      eq(inboundMessages.mailboxUserId, mailboxUserId),
      eq(inboundMessages.channel, "sms"),
      sql`LOWER(TRIM(${inboundMessages.body})) IN ('stop','stop.','stop!','stopall','unsubscribe')`,
      or(
        eq(inboundMessages.needsAction, true),
        sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${inboundMessages.classification}, '$.category')), '') <> 'unsubscribe'`,
        isNull(contactCommunicationSuppressions.id)
      )
    )).orderBy(inboundMessages.id).limit(100)).map(row => row.message);
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
