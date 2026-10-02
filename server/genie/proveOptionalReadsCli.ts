import { and, desc, eq } from "drizzle-orm";
import mysql from "mysql2/promise";
import { connectedSystems, crmCommissioningJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { loadUserConnectionSecret, toAdapterConnection } from "../connectedSystems";
import { installKnownGeniePack } from "../crm/automaticCommissioning";
import { testLearnedBrowserOperation } from "../browserConnectors/browserCrmAdapter";
import { browserOperationReadinessForSystem } from "../browserConnectors/learnedOperations";

/**
 * Deliberate, CLI-invoked source proof. Never starts a full commissioning job,
 * changes provider permissions, or executes a CRM write. The exact person and
 * record IDs are obtained from owner-scoped source-backed local snapshots;
 * only the GET result can publish its own operation LIVE_PROVEN.
 */
async function main() {
  const organisationId = Number(process.env.AMARKTAI_COMMISSION_ORGANISATION_ID);
  const connectedSystemId = Number(process.env.AMARKTAI_COMMISSION_CONNECTED_SYSTEM_ID);
  if (!Number.isSafeInteger(organisationId) || organisationId <= 0 ||
      !Number.isSafeInteger(connectedSystemId) || connectedSystemId <= 0)
    throw Error("EXPLICIT_COMMISSIONING_ORGANISATION_AND_SYSTEM_REQUIRED");
  const db = await getDb();
  if (!db) throw Error("DATABASE_UNAVAILABLE");
  const [system] = await db.select().from(connectedSystems).where(
    and(eq(connectedSystems.organisationId,organisationId),
        eq(connectedSystems.id,connectedSystemId))
  ).limit(1);
  if (!system || system.provider !== "genie" ||
      !["ready","limited_permissions"].includes(system.status) ||
      system.allowedWriteCapabilities.length > 0)
    throw Error("READ_ONLY_GENIE_GATE_FAILED");
  const [job] = await db.select().from(crmCommissioningJobs).where(
    eq(crmCommissioningJobs.connectedSystemId,connectedSystemId)
  ).orderBy(desc(crmCommissioningJobs.id)).limit(1);
  if (!job?.requestedByUserId || job.organisationId !== organisationId)
    throw Error("EXISTING_COMMISSIONING_OWNER_REQUIRED");
  const userId = job.requestedByUserId;
  const secret = await loadUserConnectionSecret({
    userId,organisationId,connectedSystemId,secretKind:"browser"
  });
  if (!secret?.crmUserExternalId ||
      secret.browserUserId !== userId)
    throw Error("EXACT_BROWSER_AND_CRM_OWNER_REQUIRED");
  const c = await mysql.createConnection(process.env.DATABASE_URL!);
  let contactId: string | undefined;
  let opportunityId: string | undefined;
  let taskId: string | undefined;
  let noteContactId: string | undefined;
  try {
    const [contacts] = await c.execute<mysql.RowDataPacket[]>(
      "SELECT externalId FROM crmContacts WHERE organisationId=? AND connectedSystemId=? AND ownerExternalId=? AND externalId<>'' ORDER BY sourceUpdatedAt DESC LIMIT 1",
      [organisationId,connectedSystemId,secret.crmUserExternalId]
    );
    const [opportunities] = await c.execute<mysql.RowDataPacket[]>(
      "SELECT externalId FROM crmOpportunities WHERE organisationId=? AND connectedSystemId=? AND ownerExternalId=? AND externalId<>'' AND stage IS NOT NULL AND stage<>'' ORDER BY sourceUpdatedAt DESC LIMIT 1",
      [organisationId,connectedSystemId,secret.crmUserExternalId]
    );
    const [tasks] = await c.execute<mysql.RowDataPacket[]>(
      "SELECT externalId FROM crmTasks WHERE organisationId=? AND connectedSystemId=? AND ownerExternalId=? AND externalId<>'' AND completedAt IS NULL ORDER BY sourceUpdatedAt DESC LIMIT 1",
      [organisationId,connectedSystemId,secret.crmUserExternalId]
    );
    const [noteTargets] = await c.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT a.contactExternalId FROM crmActivities a INNER JOIN crmContacts c ON a.contactExternalId=c.externalId AND a.organisationId=c.organisationId AND a.connectedSystemId=c.connectedSystemId WHERE a.organisationId=? AND a.connectedSystemId=? AND a.activityType='note' AND c.ownerExternalId=? AND a.contactExternalId<>'' ORDER BY a.contactExternalId LIMIT 1",
      [organisationId,connectedSystemId,secret.crmUserExternalId]
    );
    contactId = contacts[0]?.externalId;
    opportunityId = opportunities[0]?.externalId;
    taskId = tasks[0]?.externalId;
    noteContactId = noteTargets[0]?.contactExternalId;
  } finally { await c.end(); }
  if (!contactId || !opportunityId || !taskId) throw Error("GENUINE_OWNER_TARGETS_REQUIRED");
  // Adds reviewed TEST_READY definitions only where exact latest is not
  // already LIVE_PROVEN. The known core provider pack stays unchanged.
  const installed = await installKnownGeniePack(job,system);
  const supported = [
    "contact.open","history.read","interaction.latest",
    "communication.context","manual_action.sync","task.list","task.read",
    "opportunity.read","stage.read","note.read",
  ];
  const results: Array<{key:string;status:"LIVE_PROVEN"|"NOT_PROVEN";reason?:string}> = [];
  for (const operationKey of supported) {
    try {
      const required = operationKey.includes("opportunity") || operationKey === "stage.read"
        ? "opportunities.read"
        : operationKey.startsWith("task.") || operationKey === "manual_action.sync"
          ? "tasks.read"
          : operationKey === "note.read" ? "notes.read"
          : operationKey === "contact.open" ? "contacts.read" : "activities.read";
      if (!system.allowedReadCapabilities.includes(required as never) ||
          (operationKey !== "note.read" &&
           !system.verifiedCapabilities.includes(required as never)))
        throw Error("READ_CAPABILITY_NOT_GRANTED");
      if (operationKey === "note.read" && !noteContactId)
        throw Error("GENUINE_OWNER_NOTE_SOURCE_RECORD_REQUIRED");
      await testLearnedBrowserOperation({
        connection: toAdapterConnection(system),
        secret, provider: "genie", operationKey,
        payload: operationKey === "task.list" || operationKey === "manual_action.sync" ? {} : {
          externalId: operationKey === "opportunity.read" || operationKey === "stage.read"
            ? opportunityId
            : operationKey === "task.read" ? taskId
              : operationKey === "note.read" ? noteContactId
                : contactId,
        },
        correlationId:`independent-native-get-${operationKey}-20261002`,
        publishByUserId:userId,
      });
      const matrix=await browserOperationReadinessForSystem({organisationId,connectedSystemId});
      if(matrix.operations.find(row=>row.key===operationKey)?.status!=="LIVE_PROVEN")
        throw Error("DURABLE_LATEST_VERSION_NOT_LIVE_PROVEN");
      results.push({key:operationKey,status:"LIVE_PROVEN"});
    } catch(error) {
      results.push({key:operationKey,status:"NOT_PROVEN",reason:String(error instanceof Error?error.message:error).slice(0,160)});
    }
  }
  const matrix = await browserOperationReadinessForSystem({organisationId,connectedSystemId});
  console.log("INDEPENDENT_NATIVE_READ_PROOFS",JSON.stringify({
    installedKeys:installed.installed.filter(key=>supported.includes(key)),
    results,
    finalReadStatuses:matrix.operations.filter(row=>row.mode==="read").map(row=>({key:row.key,status:row.status})),
    externalWrites:0,
  }));
  if(results.some(row=>row.status!=="LIVE_PROVEN"))process.exitCode=2;
}
main().catch(error=>{console.error("OPTIONAL_READ_COMMISSIONING_FAILED",String(error instanceof Error?error.message:error).slice(0,160));process.exitCode=1});
