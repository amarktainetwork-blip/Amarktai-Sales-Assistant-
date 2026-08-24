import { describe, expect, it } from "vitest";
import { sanitizeConnectedSystemForApi, sanitizeVerificationProviderResult } from "./connectedSystems";

describe("connected-system public API serialization", () => {
  it("removes browser execution state, credentials, cookies and tokens recursively", () => {
    const publicValue = sanitizeConnectedSystemForApi({
      id: 4,
      configuration: {
        shadowMode: true,
        businessMapping: { stages: ["New"] },
        browserProfile: { storageState: { cookies: [{ value: "private" }] } },
        nested: { accessToken: "private", password: "private", safeLabel: "CRM" },
      },
    });
    expect(publicValue).toEqual({ id: 4, configuration: { shadowMode: true, businessMapping: { stages: ["New"] }, nested: { safeLabel: "CRM" } } });
    expect(JSON.stringify(publicValue)).not.toContain("private");
  });
});

describe("connector verification evidence", () => {
  it("retains only explicit secret-free commissioning proof", () => {
    const evidence = sanitizeVerificationProviderResult({
      cdpReachable: true,
      authenticationConfirmed: true,
      authenticatedHostname: "genie.example",
      configuredOperations: ["contact.read", "dialler.launch"],
      password: "private",
      storageState: { cookies: [{ value: "private" }] },
      arbitraryPayload: "private",
    });
    expect(evidence).toEqual({
      cdpReachable: true,
      authenticationConfirmed: true,
      authenticatedHostname: "genie.example",
      configuredOperations: ["contact.read", "dialler.launch"],
    });
    expect(JSON.stringify(evidence)).not.toContain("private");
  });
});
