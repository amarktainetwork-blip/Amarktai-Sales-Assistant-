import {describe,expect,it,vi} from "vitest";
import type {Page} from "playwright-core";
import {
 GENIE_COMPANY_READ_IDENTITY,
 GENIE_COMPANY_SYNC_IDENTITY,
 normalizeGenieBusinessSearch,
 isUnfilteredGenieBusinessSourceUrl,
 readGenieCompanySource,
} from "./genieCompanyScope";
import {GENIE_PROVIDER_PACK} from "../crm/providerPacks";
import {browserProofPolicy,verifyBrowserReadProof} from "./operationContracts";

const locationId="verified-location";
const owner="verified-amelia-owner";
const a={id:"genuine-business-a",locationId,name:"Source A",website:"https://example.org",updatedAt:"2026-10-02T09:00:00Z"};
const b={id:"genuine-business-b",locationId,name:"Source B",updatedAt:"2026-10-02T09:00:00Z"};
function browserFixture(data:unknown, start: "contacts" | "businesses" = "contacts") {
 let current=start === "businesses"
  ?`https://genie.entrepreneurscircle.org/v2/location/${locationId}/businesses/list`
  :`https://genie.entrepreneurscircle.org/v2/location/${locationId}/contacts/smart_list/All`;
 const response={
   url:()=>`https://backend.leadconnectorhq.com/businesses/search?limit=20&skip=0&locationId=${locationId}&count=true`,
   request:()=>({method:()=>"GET",allHeaders:async()=>({accept:"application/json"})}),
   status:()=>200,ok:()=>true,json:async()=>data,
 };
 const get=vi.fn();
 const p={
   url:()=>current,
   locator:(selector:string)=>({
     first:()=>({
       getAttribute:async()=>selector==="#sb_contacts"
         ?`/v2/location/${locationId}/contacts/smart_list/All`
         :null,
       click:async()=>{
         current=selector==="#sb_contacts"
           ?`https://genie.entrepreneurscircle.org/v2/location/${locationId}/contacts/smart_list/All`
           :`https://genie.entrepreneurscircle.org/v2/location/${locationId}/businesses/list`;
       }
     })
   }),
   waitForURL:async(fn:(url:URL)=>boolean)=>{if(!fn(new URL(current)))throw Error("WRONG_ROUTE");},
   reload:vi.fn(async()=>{current=`https://genie.entrepreneurscircle.org/v2/location/${locationId}/businesses/list`;}),
   waitForResponse:async(fn:(r:typeof response)=>boolean)=>{
     if(!fn(response))throw Error("WRONG_SOURCE_RESPONSE");
     return response;
   },
   context:()=>({request:{get}}),
 };
 return {page:p as unknown as Page,get};
}
const scope=()=>vi.fn();
describe("Genie immutable location-scoped Businesses source",()=>{
 it("uses separately versioned read identities, without claiming older sync proof",()=>{
  expect(GENIE_PROVIDER_PACK.operationDefinitions["company.sync"].prerequisites?.nativeRead)
   .toBe(GENIE_COMPANY_SYNC_IDENTITY);
  expect(GENIE_PROVIDER_PACK.operationDefinitions["company.read"].prerequisites?.nativeRead)
   .toBe(GENIE_COMPANY_READ_IDENTITY);
  expect(browserProofPolicy("company.read","read").requiresTargetIdentity).toBe(true);
 });
 it("validates the real source total, immutable IDs, name and location",()=>{
  const value=normalizeGenieBusinessSearch({count:2,businesses:[a,b]},locationId);
  expect(value.sourceTotal).toBe(2);
  expect(value.records.map(x=>x.externalId)).toEqual([a.id,b.id]);
  expect(value.records[0].sourceKind).toBe("genie_location_scoped_businesses_api");
  expect(value.records[0].sourceUpdatedAt).toBe("2026-10-02T09:00:00.000Z");
 });
 it("rejects wrong-location, duplicate, incomplete identity and inconsistent source counts",()=>{
  expect(()=>normalizeGenieBusinessSearch({count:1,businesses:[{...a,locationId:"other"}]},locationId)).toThrow("CRM_COMPANY_LOCATION_SCOPE_VIOLATION");
  expect(()=>normalizeGenieBusinessSearch({count:2,businesses:[a,a]},locationId)).toThrow("GENIE_BUSINESSES_DUPLICATE_SOURCE_ID");
  expect(()=>normalizeGenieBusinessSearch({count:1,businesses:[{...a,id:""}]},locationId)).toThrow("GENIE_COMPANY_IMMUTABLE_ID_AND_NAME_REQUIRED");
  expect(()=>normalizeGenieBusinessSearch({count:0,businesses:[a]},locationId)).toThrow("GENIE_BUSINESSES_SOURCE_COUNT_INVALID");
 });
 it("executes an independent browser navigation and complete location GET",async()=>{
  const {page,get}=browserFixture({count:2,businesses:[a,b]});
  const control=scope();
  const out=await readGenieCompanySource({page,assertControl:control,verifiedViewerOwnerExternalId:owner});
  expect(JSON.parse(out.data.records)).toHaveLength(2);
  expect(out.data.sourceTotal).toBe("2");
  expect(out.data.locationScopeVerified).toBe("true");
  expect(get).not.toHaveBeenCalled();
  expect(control).toHaveBeenCalled();
 });
 it("reloads an already scoped Businesses screen for an independent exact GET",async()=>{
  const {page,get}=browserFixture({count:2,businesses:[a,b]},"businesses");
  const out=await readGenieCompanySource({page,assertControl:scope(),verifiedViewerOwnerExternalId:owner,exactExternalId:b.id});
  expect(JSON.parse(out.data.records)).toHaveLength(1);
  expect(page.reload).toHaveBeenCalledTimes(1);
  expect(get).not.toHaveBeenCalled();
 });
 it("proves one exact genuine company without substituting other records",async()=>{
  const {page}=browserFixture({count:2,businesses:[a,b]});
  const out=await readGenieCompanySource({page,assertControl:scope(),verifiedViewerOwnerExternalId:owner,exactExternalId:b.id});
  expect(out.data.actualExternalId).toBe(b.id);
  expect(JSON.parse(out.data.records)[0].externalId).toBe(b.id);
  expect(verifyBrowserReadProof({operationKey:"company.read",data:out.data,payload:{externalId:b.id}}).ok).toBe(true);
  expect(verifyBrowserReadProof({operationKey:"company.read",data:out.data,payload:{externalId:a.id}}).ok).toBe(false);
 });
 it("does not invent a company for an explicitly empty source",async()=>{
  const {page}=browserFixture({count:0,businesses:[]});
  const out=await readGenieCompanySource({page,assertControl:scope(),verifiedViewerOwnerExternalId:owner});
  expect(out.data.records).toBe("[]");
  expect(verifyBrowserReadProof({operationKey:"company.sync",data:out.data,payload:{}}).ok).toBe(true);
  const fixture=browserFixture({count:0,businesses:[]});
  await expect(readGenieCompanySource({page:fixture.page,assertControl:scope(),verifiedViewerOwnerExternalId:owner,exactExternalId:a.id}))
    .rejects.toThrow("GENIE_EXACT_COMPANY_SOURCE_MATCH_REQUIRED");
 });
 it("rejects generic page text instead of source-backed exact company identity",()=>{
  expect(verifyBrowserReadProof({
   operationKey:"company.read",
   data:{records:JSON.stringify([{name:"Placeholder"}]),actualExternalId:a.id},
   payload:{externalId:a.id}
  }).ok).toBe(false);
 });
});
