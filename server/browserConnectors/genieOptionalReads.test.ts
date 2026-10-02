import { describe, expect, it } from "vitest";
import {
  GENIE_EXACT_OPTIONAL_READS,
  isGenieExactOptionalRead,
  executeGenieExactOptionalRead,
} from "./genieOptionalReads";
import { browserProofPolicy } from "./operationContracts";
import { GENIE_PROVIDER_PACK } from "../crm/providerPacks";
import { validateLearnedOperationDefinition } from "./operationContracts";

describe("distinct optional Genie GET read operations", () => {
  it("preserves seven distinct reviewed provider-pack definitions", () => {
    expect(GENIE_EXACT_OPTIONAL_READS).toHaveLength(7);
    for (const key of GENIE_EXACT_OPTIONAL_READS) {
      expect(isGenieExactOptionalRead(key)).toBe(true);
      const packed = GENIE_PROVIDER_PACK.operationDefinitions[key];
      expect(packed?.definition?.mode).toBe("read");
      const source = packed.definition as {executeScript:string; mode:"read"; resultKey:string};
      const script = GENIE_PROVIDER_PACK.scripts[source.executeScript];
      expect(script).toBeDefined();
      expect(validateLearnedOperationDefinition({
        mode: "read",
        execute: script,
        resultKey: "records",
      }).mode).toBe("read");
      expect(browserProofPolicy(key, "read").requiresTargetIdentity).toBe(true);
      expect(browserProofPolicy(key, "read").requiresStructuredResult).toBe(true);
    }
  });
  it("rejects an unbound or missing exact target before any source call", async () => {
    const read = (key:"contact.open"|"history.read") => executeGenieExactOptionalRead({
      page: {} as never, operationKey:key, payload:{externalId:""},
      ownerExternalId:"owner", assertControl:()=>undefined,
    });
    await expect(read("contact.open")).rejects.toThrow("EXACT_TARGET_REQUIRED");
    await expect(read("history.read")).rejects.toThrow("EXACT_TARGET_REQUIRED");
    await expect(executeGenieExactOptionalRead({
      page:{} as never, operationKey:"contact.open", payload:{externalId:"genuine-record"},
      ownerExternalId:"", assertControl:()=>undefined,
    })).rejects.toThrow("CRM_OWNER_SCOPE_REQUIRED");
  });
  it("never treats an unimplemented operation as a native read", () => {
    expect(isGenieExactOptionalRead("company.read")).toBe(false);
    expect(isGenieExactOptionalRead("task.complete")).toBe(false);
    expect(isGenieExactOptionalRead("email.send")).toBe(false);
  });
});
