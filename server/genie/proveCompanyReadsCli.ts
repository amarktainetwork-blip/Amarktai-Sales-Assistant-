import {and, desc, eq} from "drizzle-orm";
import {
  browserLearnedOperations,
  connectedSystems,
  crmCommissioningJobs,
  crmCompanies,
  crmSyncCursors,
} from "../../drizzle/schema";
import {getDb} from "../db";
import {
  loadUserConnectionSecret, toAdapterConnection,
} from "../connectedSystems";
import {installKnownGeniePack} from "../crm/automaticCommissioning";
import {testLearnedBrowserOperation} from "../browserConnectors/browserCrmAdapter";
import {
  browserOperationReadinessForSystem,
  latestBrowserOperation,
} from "../browserConnectors/learnedOperations";
import {reconcileCurrentBrowserReadiness} from "../crm/currentReadiness";
import {
  GENIE_COMPANY_READ_IDENTITY,
  GENIE_COMPANY_SYNC_IDENTITY,
  normalizeGenieBusinessSearch,
} from "../browserConnectors/genieCompanyScope";

/** Operator-only controlled proof: two separate live Genie GETs, all company
 * records written solely to the local source-derived cache, never to Genie.
 * Explicit organisation+system env, verified commissioning-owner browser
 * session, empty CRM-write policy, and final durable per-key proof required.
 */
async function main() {
  const organisationId=Number(process.env.AMARKTAI_COMMISSION_ORGANISATION_ID);
  const connectedSystemId=Number(process.env.AMARKTAI_COMMISSION_CONNECTED_SYSTEM_ID);
  if(!Number.isSafeInteger(organisationId)||organisationId<=0||
     !Number.isSafeInteger(connectedSystemId)||connectedSystemId<=0)
    throw Error("EXPLICIT_COMMISSIONING_SCOPE_REQUIRED");
  const db=await getDb();
  if(!db)throw Error("DATABASE_UNAVAILABLE");
  const [system]=await db.select().from(connectedSystems).where(and(
    eq(connectedSystems.organisationId,organisationId),
    eq(connectedSystems.id,connectedSystemId)
  )).limit(1);
  if(!system||system.provider!=="genie"||
     !["ready","limited_permissions"].includes(system.status)||
     system.allowedWriteCapabilities.length!==0||
     !system.allowedReadCapabilities.includes("companies.read"))
    throw Error("EXPLICIT_READ_ONLY_COMPANY_PERMISSION_REQUIRED");
  const [job]=await db.select().from(crmCommissioningJobs).where(and(
    eq(crmCommissioningJobs.organisationId,organisationId),
    eq(crmCommissioningJobs.connectedSystemId,connectedSystemId)
  )).orderBy(desc(crmCommissioningJobs.id)).limit(1);
  if(!job?.requestedByUserId)throw Error("EXISTING_MANAGER_COMMISSIONING_OWNER_REQUIRED");
  const userId=job.requestedByUserId;
  const secret=await loadUserConnectionSecret({
    userId,organisationId,connectedSystemId,secretKind:"browser"
  });
  if(!secret?.crmUserExternalId||secret.browserUserId!==userId)
    throw Error("VERIFIED_PERSONAL_BROWSER_OWNER_REQUIRED");

  // Never trust earlier false-empty company.sync proof for a changed executor.
  await installKnownGeniePack(job,system);
  const pack=[
    ["company.sync",GENIE_COMPANY_SYNC_IDENTITY],
    ["company.read",GENIE_COMPANY_READ_IDENTITY],
  ] as const;
  for(const [key,expectedNative] of pack) {
    const op=await latestBrowserOperation({organisationId,connectedSystemId,operationKey:key});
    if(!op||op.definition.mode!=="read"||op.prerequisites.nativeRead!==expectedNative)
      throw Error("COMPANY_VERSIONED_NATIVE_DEFINITION_REQUIRED:"+key);
  }
  const refreshed=(await db.select().from(connectedSystems).where(eq(
    connectedSystems.id,connectedSystemId)).limit(1))[0];
  if(!refreshed||refreshed.allowedWriteCapabilities.length>0)
    throw Error("CRM_WRITE_POLICY_CHANGED");
  const sync=await testLearnedBrowserOperation({
    connection:toAdapterConnection(refreshed),secret,provider:"genie",
    operationKey:"company.sync",payload:{},
    correlationId:"native-company-full-location-get-20261002",
    publishByUserId:userId,
  });
  const data=sync.providerResult?.data as Record<string,unknown> | undefined;
  const rowsValue=data?.records;
  const sourceTotal=Number(data?.sourceTotal);
  const rows=typeof rowsValue==="string"?JSON.parse(rowsValue) as unknown:null;
  if(!Array.isArray(rows)||!rows.length||
     !Number.isSafeInteger(sourceTotal)||rows.length!==sourceTotal||
     data?.locationScopeVerified!=="true"||
     data?.sourceKind!=="genie_location_scoped_businesses_api")
    throw Error("COMPLETE_GENUINE_COMPANY_SOURCE_PROOF_REQUIRED");
  // An additional local strict check; never infer ownership absent in source.
  const location=(rows[0] as {locationId?:unknown}).locationId;
  const normalized=normalizeGenieBusinessSearch({
    count:sourceTotal,
    businesses:rows.map((r:Record<string,unknown>)=>({
      id:r.externalId, locationId:r.locationId, name:r.name,
      website:r.website, updatedAt:r.sourceUpdatedAt,
    })),
  },String(location||"")).records;
  const target=normalized[0];
  if(!target?.externalId)throw Error("EXACT_SOURCE_COMPANY_TARGET_REQUIRED");

  // Fresh separate source read and proof; a successful company.sync alone is
  // never enough to mark company.read LIVE_PROVEN.
  const exact=await testLearnedBrowserOperation({
    connection:toAdapterConnection(refreshed),secret,provider:"genie",
    operationKey:"company.read",
    payload:{externalId:target.externalId},
    correlationId:"native-company-independent-exact-get-20261002",
    publishByUserId:userId,
  });
  const exactData=exact.providerResult?.data as Record<string,unknown> | undefined;
  const exactRows=typeof exactData?.records==="string"?
    JSON.parse(exactData.records) as Array<{externalId:string;locationId:string}>:[];
  if(exactRows.length!==1||
     exactRows[0].externalId!==target.externalId||
     exactRows[0].locationId!==location||
     exactData?.actualExternalId!==target.externalId||
     exactData?.locationScopeVerified!=="true")
    throw Error("INDEPENDENT_EXACT_COMPANY_IDENTITY_PROOF_REQUIRED");

  const before=await browserOperationReadinessForSystem({organisationId,connectedSystemId});
  if(pack.some(([key])=>before.operations.find(x=>x.key===key)?.status!=="LIVE_PROVEN"))
    throw Error("DURABLE_COMPANY_PROOFS_NOT_LIVE");
  const now=new Date();
  await db.transaction(async tx=>{
    for(const row of normalized) {
      const at=row.sourceUpdatedAt?new Date(row.sourceUpdatedAt):null;
      await tx.insert(crmCompanies).values({
        organisationId,connectedSystemId,externalId:row.externalId,name:row.name,
        website:row.website||null,
        ownerExternalId:null,sourceUpdatedAt:at,
        sourceRevision:row.sourceRevision||null,
        raw:{...row,verifiedSourceTotal:sourceTotal,sourceLocationScope:"exact"},
      }).onDuplicateKeyUpdate({set:{
        name:row.name,website:row.website||null,ownerExternalId:null,
        sourceUpdatedAt:at,sourceRevision:row.sourceRevision||null,
        raw:{...row,verifiedSourceTotal:sourceTotal,sourceLocationScope:"exact"},
      }});
    }
    await tx.insert(crmSyncCursors).values({
      connectedSystemId,resourceType:"companies",cursor:null,
      sourceCheckpoint:null,lastSuccessfulAt:now,lastError:null,
    }).onDuplicateKeyUpdate({set:{
      cursor:null,sourceCheckpoint:null,lastSuccessfulAt:now,lastError:null,
    }});
  });
  await reconcileCurrentBrowserReadiness({organisationId,connectedSystemId});
  const final=await browserOperationReadinessForSystem({organisationId,connectedSystemId});
  if(pack.some(([key])=>final.operations.find(x=>x.key===key)?.status!=="LIVE_PROVEN"))
    throw Error("POST_MATERIALISATION_PROOF_REGRESSION");
  console.log("COMPANY_READS_LIVE_AND_SOURCE_MATERIALISED",JSON.stringify({
    collectionProof:"LIVE_PROVEN",individualProof:"LIVE_PROVEN",
    sourceCount:sourceTotal,localUpserted:normalized.length,
    exactLocation:true,exactIdentity:true,
    writeCapabilities:refreshed.allowedWriteCapabilities,externalCrmWrites:0,
  }));
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error("COMPANY_COMMISSIONING_NOT_PROVEN",String(e.message||e).slice(0,220));
  process.exit(1);
});
