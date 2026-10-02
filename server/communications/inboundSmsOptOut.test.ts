import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyInboundMessage } from "./inboundReview";
import { mayPrepareInboundReply, shouldSurfaceInbound } from "./inboundPipeline";

describe("SMS STOP compliance and historical action-queue reconciliation", () => {
  it.each(["STOP", "stop", " STOP ", "STOP.", "Stop!", "<p>STOP</p>", "STOPALL"])(
    "never offers a sales reply for opt-out keyword %s",
    body => {
      const c = classifyInboundMessage({ body });
      expect(c.category).toBe("unsubscribe");
      expect(shouldSurfaceInbound(c)).toBe(false);
      expect(mayPrepareInboundReply(c, false)).toBe(false);
    }
  );
  it("retains legitimate ordinary sales conversation", () => {
    const c = classifyInboundMessage({ body: "Can we stop by at 4 pm tomorrow?" });
    expect(c.category).toBe("reply_needed");
    expect(shouldSurfaceInbound(c)).toBe(true);
  });
  it("does not close unrelated new-lead work when replaying an opt-out", () => {
    // Preserve the existing ingress path, but require a non-opt-out message
    // before it may retire a NEW_LEAD task for a matched contact.
    const ingestor = readFileSync(new URL("./inboundPipeline.ts", import.meta.url), "utf8");
    const guardStart = ingestor.indexOf("// A consent opt-out is not evidence");
    const suppressionStart = ingestor.indexOf('if (classification.category === "unsubscribe")');
    expect(guardStart).toBeGreaterThan(-1);
    expect(suppressionStart).toBeGreaterThan(guardStart);
    const guardedWork = ingestor.slice(guardStart, suppressionStart);
    expect(guardedWork).toContain('classification.category !== "unsubscribe" &&');
    expect(guardedWork).toContain("await completeNewLeadWorkAfterVerifiedContact({");
  });
  it("reprocesses exact previously cached SMS via owner-scoped idempotent local ingestion", () => {
    const cli = readFileSync(new URL("./reconcileCachedSmsOptOutsCli.ts", import.meta.url), "utf8");
    const ingestor = readFileSync(new URL("./inboundPipeline.ts", import.meta.url), "utf8");
    expect(cli).toContain("EXPLICIT_MAILBOX_SOURCE_SCOPE_REQUIRED");
    expect(cli).toContain("eq(inboundMessages.organisationId, organisationId)");
    expect(cli).toContain("eq(inboundMessages.connectedSystemId, connectedSystemId)");
    expect(cli).toContain("eq(inboundMessages.mailboxUserId, mailboxUserId)");
    expect(cli).toContain('eq(inboundMessages.channel, "sms")');
    expect(cli).toContain("eq(inboundMessages.needsAction, true)");
    // Archived/handled historical STOP can still lack suppression. It must be
    // reconciled without being reopened or hidden forever by needsAction=false.
    expect(cli).toContain("isNull(contactCommunicationSuppressions.id)");
    expect(cli).toContain("COALESCE(JSON_UNQUOTE(JSON_EXTRACT");
    expect(cli).toContain("eq(contactCommunicationSuppressions.senderReference, inboundMessages.senderReference)");
    expect(cli).toContain("inboundIdempotencyKey(");
    expect(cli).toContain("ingestInboundMessage({");
    expect(cli).toContain("OPT_OUT_RECLASSIFICATION_DID_NOT_CONVERGE");
    expect(ingestor).toContain('existing?.status === "archived" ? "archived" : "classified"');
    expect(ingestor).toContain('if (classification.category === "unsubscribe")');
    expect(ingestor).toContain(".insert(contactCommunicationSuppressions)");
    expect(ingestor).toContain('!["information", "unsubscribe"].includes(classification.category)');
    expect(cli).not.toContain("sendTemplate");
    expect(cli).not.toContain("executeCrmWrite");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts.build).toContain("server/communications/reconcileCachedSmsOptOutsCli.ts");
    expect(pkg.scripts["reconcile:cached-sms-opt-outs"]).toBe(
      "node dist/reconcileCachedSmsOptOutsCli.js"
    );
  });
});
