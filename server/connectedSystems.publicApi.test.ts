import { describe, expect, it } from "vitest";
import {
  canonicalConnectionIdentity,
  sanitizeConnectedSystemForApi,
  sanitizeVerificationProviderResult,
  selectCanonicalConnectedSystems,
} from "./connectedSystems";

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
    expect(publicValue).toEqual({
      id: 4,
      configuration: {
        shadowMode: true,
        businessMapping: { stages: ["New"] },
        nested: { safeLabel: "CRM" },
      },
    });
    expect(JSON.stringify(publicValue)).not.toContain("private");
  });
});

describe("canonical CRM connection lifecycle", () => {
  it("normalizes the same provider/origin to one stable identity", () => {
    expect(
      canonicalConnectionIdentity({
        provider: "genie",
        baseUrl: "https://GENIE.entrepreneurscircle.org/login",
        connectionMethod: "browser",
      })
    ).toBe("genie|https://genie.entrepreneurscircle.org");
    expect(
      canonicalConnectionIdentity({
        provider: "genie",
        baseUrl: "https://genie.entrepreneurscircle.org/",
        connectionMethod: "browser",
      })
    ).toBe("genie|https://genie.entrepreneurscircle.org");
  });

  it("exposes one best active CRM and hides retired legacy duplicates", () => {
    const base = {
      organisationId: 1,
      provider: "genie" as const,
      displayName: "Genie",
      baseUrl: "https://genie.entrepreneurscircle.org/",
      connectionMethod: "browser" as const,
      allowedReadCapabilities: [],
      allowedWriteCapabilities: [],
      verifiedCapabilities: [],
      accountExternalId: null,
      scopes: [],
      lastHealthCheckAt: null,
      lastHealthSummary: null,
      readyAt: null,
      createdAt: new Date("2026-08-31T08:00:00Z"),
    };
    const selected = selectCanonicalConnectedSystems([
      {
        ...base,
        id: 1,
        status: "disconnected",
        configuration: {},
        updatedAt: new Date("2026-08-31T10:00:00Z"),
      },
      {
        ...base,
        id: 2,
        status: "ready",
        verifiedCapabilities: ["contacts.read"],
        configuration: {},
        readyAt: new Date("2026-08-31T09:00:00Z"),
        updatedAt: new Date("2026-08-31T09:00:00Z"),
      },
      {
        ...base,
        id: 3,
        status: "ready",
        configuration: { retiredAt: "2026-08-31T11:00:00.000Z" },
        updatedAt: new Date("2026-08-31T11:00:00Z"),
      },
    ]);
    expect(selected.map(system => system.id)).toEqual([2]);
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
