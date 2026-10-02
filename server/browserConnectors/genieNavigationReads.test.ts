import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import {
  exactGenieSidebarReadTarget,
  openExactGenieSidebarRead,
  readGenieHome,
} from "./genieNavigationReads";
import { GENIE_PROVIDER_PACK } from "../crm/providerPacks";
import { browserProofPolicy, validateLearnedOperationDefinition } from "./operationContracts";
import { readFileSync } from "node:fs";

const origin = "https://genie.entrepreneurscircle.org";
const current = origin + "/v2/location/locA/contacts/smart_list/all";

describe("Native location-scoped Home and next task reads", () => {
  it("requires the observed sidebar target from the same exact location", () => {
    expect(exactGenieSidebarReadTarget(current, "/v2/location/locA/dashboard", "dashboard").locationId).toBe("locA");
    expect(exactGenieSidebarReadTarget(current, "/v2/location/locA/tasks", "tasks").destination.pathname)
      .toBe("/v2/location/locA/tasks");
    for (const wrong of [
      "/v2/location/other/dashboard",
      "https://wrong.invalid/v2/location/locA/dashboard",
      "/v2/location/locA/dashboard?secret=abc",
      "/v2/location/locA/tasks",
    ]) {
      expect(() => exactGenieSidebarReadTarget(current, wrong, "dashboard"))
        .toThrow("GENIE_SIDEBAR_TARGET_SCOPE_MISMATCH");
    }
    expect(() => exactGenieSidebarReadTarget("https://wrong.invalid/v2/location/locA", "/v2/location/locA/dashboard","dashboard"))
      .toThrow("GENIE_SIDEBAR_LOCATION_REQUIRED");
  });
  function mockedPage(route: "dashboard" | "tasks") {
    let url=current;
    const link = {
      getAttribute: vi.fn(async() => "/v2/location/locA/"+route),
      click: vi.fn(async() => {url=origin+"/v2/location/locA/"+route;}),
    };
    const page = {
      url: () => url,
      locator: vi.fn(() => ({first:()=>link})),
      waitForURL: vi.fn(async(predicate:(value:URL)=>boolean)=>{
        if(!predicate(new URL(url)))throw Error("URL_NOT_MATCHED");
      }),
    } as unknown as Page;
    return {page,link};
  }
  it("uses the actual Home link under the browser control lease", async () => {
    const {page,link}=mockedPage("dashboard");
    const assertControl=vi.fn();
    const result=await readGenieHome({page,ownerExternalId:"amelia-owner",assertControl});
    expect(link.click).toHaveBeenCalledOnce();
    expect(assertControl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(result.data.records)[0]).toMatchObject({
      externalId:"locA", ownerExternalId:"amelia-owner",
      sourceKind:"genie_location_scoped_home_navigation",
    });
    expect(result.data.actualPageUrl).toBe("/v2/location/locA/dashboard");
  });
  it("opens only the observed Tasks route", async () => {
    const {page,link}=mockedPage("tasks");
    const result=await openExactGenieSidebarRead({
      page,selector:"#tb_tasks",route:"tasks",assertControl:vi.fn(),
    });
    expect(link.click).toHaveBeenCalledOnce();
    expect(result.pathname).toBe("/v2/location/locA/tasks");
  });
  it("rejects missing owner and does not click", async () => {
    const {page,link}=mockedPage("dashboard");
    await expect(readGenieHome({page,ownerExternalId:"",assertControl:vi.fn()}))
      .rejects.toThrow("CRM_OWNER_SCOPE_REQUIRED");
    expect(link.click).not.toHaveBeenCalled();
  });
  it("persists separate reviewed read scripts and source-identity gates", () => {
    for (const key of ["home.open","prospect.next"] as const) {
      const packed=GENIE_PROVIDER_PACK.operationDefinitions[key];
      expect(packed.definition.mode).toBe("read");
      const source=packed.definition as {executeScript:string;mode:"read";resultKey:string};
      expect(validateLearnedOperationDefinition({
        mode:"read",execute:GENIE_PROVIDER_PACK.scripts[source.executeScript],resultKey:source.resultKey,
      }).mode).toBe("read");
      expect(browserProofPolicy(key,"read").requiresStructuredResult).toBe(true);
      expect(packed.prerequisites?.nativeRead).toBeTruthy();
    }
    const adapter=readFileSync(new URL("./browserCrmAdapter.ts",import.meta.url),"utf8");
    expect(adapter).toContain('"genie_owner_scoped_next_task_read_and_navigation"');
    expect(adapter).toContain('!input.connection.allowedReadCapabilities.includes("tasks.read")');
    expect(adapter).toContain('openExactGenieSidebarRead({');
    expect(adapter).toContain('page.locator("#sb_contacts").first()');
    expect(adapter).toContain("GENIE_NEXT_TASK_CONTACTS_TARGET_SCOPE_MISMATCH");
    const commissioning = readFileSync(new URL("../genie/proveOptionalReadsCli.ts",import.meta.url),"utf8");
    expect(commissioning).toContain('"home.open","prospect.next"');
    expect(commissioning).toContain('"next_prospect.read"');
  });
});
