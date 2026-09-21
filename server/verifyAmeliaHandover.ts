import { effectiveLatestBrowserOperation } from "./browserConnectors/learnedOperations";
import mysql from "mysql2/promise";
import {
  AMELIA_HANDOVER as a,
  exactInboundRecipientProven,
  exactOwnerCounts,
  exactTaskCollectionProven,
  handoverAllPassed,
  handoverCheck,
  reviewDraftProven,
} from "./ameliaHandoverContract";
import { calculateCurrentReadiness } from "./crm/currentReadiness";
const parse = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const checks: Array<{ name: string; ok: boolean }> = [];
  const check = (name: string, ok: unknown) =>
    checks.push(handoverCheck(name, ok));
  const query = async (sql: string, args: Array<string | number> = []) => {
    const [rows] = await connection.execute(sql, args);
    return rows as any[];
  };
  try {
    const [system] = await query(
      "SELECT * FROM connectedSystems WHERE id=? AND organisationId=?",
      [a.connectedSystemId, a.organisationId]
    );
    const [user] = await query("SELECT id,email FROM users WHERE id=?", [
      a.userId,
    ]);
    const [org] = await query(
      "SELECT name,timezone,locale,currency,settings FROM organisations WHERE id=?",
      [a.organisationId]
    );
    const [member] = await query(
      "SELECT * FROM organisationMembers WHERE organisationId=? AND userId=?",
      [a.organisationId, a.userId]
    );
    const mappings = await query(
      "SELECT externalUserId,email,userId FROM externalUserMappings WHERE organisationId=? AND connectedSystemId=? AND isActive=1 AND userId=?",
      [a.organisationId, a.connectedSystemId, a.userId]
    );
    check(
      "EXACT_MAPPING",
      user?.email === a.email &&
        member?.role === "owner" &&
        mappings.length === 1 &&
        mappings[0].externalUserId === a.ownerExternalId &&
        mappings[0].email === a.email &&
        system?.provider === "genie"
    );
    const settings = parse(org?.settings || {});
    const policy = settings.automationPolicy || {};
    check(
      "COURSE2CAREER_CONTEXT",
      org?.name === "Course2Career" &&
        org?.timezone === "Europe/London" &&
        org?.locale === "en-GB" &&
        org?.currency === "GBP" &&
        settings.customerModel === "individual_consumer"
    );
    check(
      "WRITE_CAPABILITIES_EMPTY",
      JSON.stringify(parse(system?.allowedWriteCapabilities || [])) === "[]"
    );
    check(
      "REVIEW_ONLY",
      policy.mode === "review" &&
        policy.preset === "assist_only" &&
        JSON.stringify(policy.safety?.allowedActionKeys) === "[]" &&
        JSON.stringify(policy.safety?.allowedChannels) === "[]"
    );
    const memberState = settings.memberOnboarding?.[String(a.userId)];
    check(
      "ONBOARDING_COMPLETE",
      settings.onboarding?.complete === true &&
        memberState?.complete === true &&
        settings.workspaceMode === "individual"
    );
    check("GENIE_MAILBOX_SOURCE", memberState?.emailSource === "genie");
    const operations = await query(
      "SELECT * FROM browserLearnedOperations WHERE organisationId=? AND connectedSystemId=? ORDER BY version DESC",
      [a.organisationId, a.connectedSystemId]
    );
    const latest = new Map<string, any>();
    for (const op of operations)
      if (!latest.has(op.operationKey))
        latest.set(op.operationKey, effectiveLatestBrowserOperation(op));
    const [job] = await query(
      "SELECT * FROM crmCommissioningJobs WHERE organisationId=? AND connectedSystemId=?",
      [a.organisationId, a.connectedSystemId]
    );
    const cursors = await query(
      "SELECT * FROM crmSyncCursors WHERE connectedSystemId=?",
      [a.connectedSystemId]
    );
    const current = calculateCurrentReadiness({
      operations: new Map(Array.from(latest, ([key, op]) => [key, op.status])),
      allowedReads: parse(system?.allowedReadCapabilities || []),
      allowedWrites: parse(system?.allowedWriteCapabilities || []),
      discovered: parse(job?.discoveredOperationKeys || []),
      cursors,
    });
    const progress = parse(job?.progress || {});
    check(
      "REQUIRED_READS_LIVE_PROVEN",
      current.capabilityAccounting.complete &&
        [
          "contact.sync",
          "contact.search",
          "contact.read",
          "company.sync",
          "task.sync",
          "opportunity.sync",
          "activity.sync",
          "owner.sync",
          "pipeline.list",
        ].every(key => latest.get(key)?.status === "LIVE_PROVEN")
    );
    check(
      "CURRENT_CURSOR_ERRORS_EMPTY",
      current.blockingResources.length === 0 && cursors.every(c => !c.lastError)
    );
    check(
      "CONVERGED_READINESS",
      current.ready &&
        system?.status === "ready" &&
        job?.state === "READY" &&
        job?.status === "ready" &&
        JSON.stringify(parse(system.verifiedCapabilities).sort()) ===
          JSON.stringify(current.verifiedCapabilities.sort()) &&
        progress.capabilityAccounting?.criticalGaps?.length === 0 &&
        JSON.stringify([...(progress.safeReads?.proven || [])].sort()) ===
          JSON.stringify([...current.safeReads.proven].sort())
    );
    for (const table of ["crmContacts", "crmTasks", "crmOpportunities"]) {
      const rows = await query(
        `SELECT ownerExternalId,COUNT(*) AS count FROM ${table} WHERE connectedSystemId=? GROUP BY ownerExternalId`,
        [a.connectedSystemId]
      );
      const counts = exactOwnerCounts(rows, a.ownerExternalId);
      let taskCurrentOpen = counts.total;
      if (table === "crmTasks") {
        const [openTasks] = await query(
          "SELECT COUNT(*) AS count FROM crmTasks WHERE connectedSystemId=? AND ownerExternalId=? AND status IN ('open','pending','incomplete','new','todo','to_do')",
          [a.connectedSystemId, a.ownerExternalId]
        );
        taskCurrentOpen = Number(openTasks?.count || 0);
        console.log(`TASK_CURRENT_OPEN=${taskCurrentOpen}`);
      }
      check(
        table === "crmContacts"
          ? "CONTACT_OWNER_ISOLATION"
          : table === "crmTasks"
            ? "TASK_OWNER_ISOLATION"
            : "OPPORTUNITY_OWNER_ISOLATION",
        counts.nullOwner === 0 &&
          counts.other === 0 &&
          (table !== "crmTasks"
            ? counts.total > 0
            : exactTaskCollectionProven(
                taskCurrentOpen,
                parse(latest.get("task.sync")?.evidence || {})
              ))
      );
      console.log(
        `${table === "crmContacts" ? "CONTACT" : table === "crmTasks" ? "TASK" : "OPPORTUNITY"}_COUNTS=${JSON.stringify(counts)}`
      );
    }
    const [sales] = await query(
      "SELECT COUNT(*) AS invalid FROM salesWorkItems WHERE connectedSystemId=? AND (salespersonUserId IS NULL OR salespersonUserId<>?)",
      [a.connectedSystemId, a.userId]
    );
    check("SALES_WORK_ISOLATION", Number(sales.invalid) === 0);
    const messages = await query(
      "SELECT m.mailboxUserId,m.channel,m.externalMessageId,m.receivedAt,LENGTH(m.body) AS bodyLength,m.classification,c.ownerExternalId AS contactOwnerExternalId FROM inboundMessages m LEFT JOIN crmContacts c ON c.organisationId=m.organisationId AND c.connectedSystemId=m.connectedSystemId AND c.externalId=m.contactExternalId WHERE m.organisationId=? AND m.connectedSystemId=?",
      [a.organisationId, a.connectedSystemId]
    );
    const positiveInbound = messages.some(m => {
      const classification = parse(m.classification) || {};
      return (
        m.externalMessageId &&
        m.receivedAt &&
        m.bodyLength > 0 &&
        exactInboundRecipientProven({
          mailboxUserId: m.mailboxUserId,
          expectedUserId: a.userId,
          channel: m.channel || classification.sourceChannel,
          recipientReference: classification.recipientReference,
          expectedEmail: a.email,
          contactOwnerExternalId: m.contactOwnerExternalId,
          expectedOwnerExternalId: a.ownerExternalId,
        })
      );
    });
    console.log(
      positiveInbound
        ? "PASS INBOUND_POSITIVE_PROOF"
        : "EXTERNAL_INBOUND_TEST_REQUIRED"
    );
    check(
      "INBOUND_OWNERSHIP_ISOLATION",
      messages.every(m => {
        const classification = parse(m.classification) || {};
        return exactInboundRecipientProven({
          mailboxUserId: m.mailboxUserId,
          expectedUserId: a.userId,
          channel: m.channel || classification.sourceChannel,
          recipientReference: classification.recipientReference,
          expectedEmail: a.email,
          contactOwnerExternalId: m.contactOwnerExternalId,
          expectedOwnerExternalId: a.ownerExternalId,
        });
      })
    );
    const mailboxProofs = await query(
      "SELECT metadata FROM auditEntries WHERE organisationId=? AND userId=? AND eventType='personal_genie_mailbox_synced' ORDER BY id DESC LIMIT 1",
      [a.organisationId, a.userId]
    );
    const mailboxProof = parse(mailboxProofs[0]?.metadata || {});
    check(
      "INBOUND_NEGATIVE_PROOF",
      mailboxProof.readOnlySource === true &&
        mailboxProof.exactEmailIsolation === true &&
        mailboxProof.unreadPreserved === true &&
        Number.isFinite(Number(mailboxProof.rejectedForeignRecipientCount)) &&
        Number.isFinite(Number(mailboxProof.rejectedForeignOwnerCount))
    );
    const proposals = await query(
      "SELECT id,state,governanceState,executedAt,payload FROM actionProposals WHERE organisationId=? AND userId=?",
      [a.organisationId, a.userId]
    );
    check(
      "REVIEW_DRAFT_PROOF",
      proposals.some(p =>
        reviewDraftProven({
          ...p,
          payload: parse(p.payload || {}),
        })
      )
    );
    check(
      "NO_EXECUTED_PROPOSALS",
      proposals.every(p => p.executedAt === null && p.state !== "executed")
    );
    const [writes] = await query(
      "SELECT COUNT(*) AS count FROM auditEntries WHERE organisationId=? AND createdAt >= '2026-09-16 00:00:00' AND (eventType='crm_action_executed' OR eventType REGEXP '(email|sms|whatsapp).*sent')",
      [a.organisationId]
    );
    check("NO_EXTERNAL_ACCEPTANCE_WRITES", Number(writes.count) === 0);
    for (const result of checks)
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
    process.exitCode = handoverAllPassed(checks) ? 0 : 1;
  } finally {
    await connection.end();
  }
}
main().catch(() => {
  console.error("FAIL VERIFIER_RUNTIME");
  process.exitCode = 1;
});
